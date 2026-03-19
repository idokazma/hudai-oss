# Unified Migration Plan — JSONL as Single Source of Truth

## Problem

Hudai uses **three parallel systems** to understand the same session:

1. **JSONL transcript** (`transcript-watcher.ts` → `jsonl-to-avp.ts`) → AVP events for threads, journeys, pipelines, HumanShell prose
2. **tmux screen-scraping** (`pane-analyzer.ts`, `peekPaneStatus`) → activity status (permissions, questions, working/idle)
3. **Claude Code hooks** (`hooks-handler.ts`) → real-time activity updates (when configured)

These overlap and sometimes disagree. The JSONL already contains everything — permissions, questions, tool usage, status — but we only use it for AVP events and separately scrape the terminal for status. The hooks handler exists but is a thin layer that only maps notification matchers to activity states.

**Additionally**, the `claude-code-parser.ts` is mostly disabled (no longer feeds events to handleEvent) but still used for plan detection and permission prompts. The `SwarmRegistry` only knows about tmux panes, not non-tmux sessions (VS Code, Cursor).

## Principle: JSONL for Everything, tmux Only for Display + Input

**tmux keeps exactly two jobs:**
1. **PanePreview** — rendering the raw terminal view (JSONL doesn't have visual layout)
2. **send-keys** — steering the agent (typing, approve/reject, interrupt)

**Everything else moves to JSONL:**
- Activity status (working / idle / permission / question)
- Permission details (which tool, what command)
- Question text + options
- Agent prose for HumanShell
- File activity for threads/journeys
- Token usage, model, turn count
- Session discovery across all projects (not just tmux)
- Thread summarization context

## What Already Exists

Before planning, these pieces are **already built** and should be preserved/reused:

| Module | Status | Notes |
|--------|--------|-------|
| `transcript-watcher.ts` | **Working** | JSONL tailing with byte offsets, dedup via `seenToolIds` |
| `jsonl-to-avp.ts` | **Working** | 30+ tool translations, plan detection, test parsing — **most complex piece** |
| `hooks-handler.ts` | **Working** | Maps notification matchers to `ActivityUpdate`, EventEmitter |
| `thread-summarizer.ts` | **Working** | Phase detection, LLM summaries, SQLite persistence, bootstrap |
| `swarm-registry.ts` | **Working** | tmux-based session listing with DB cross-reference |
| `ThreadSummaryStore` | **Working** | SQLite CRUD for thread summaries |
| `thread-store.ts` (client) | **Working** | Zustand store with upsert/setThreads |
| `ThreadDetailView.tsx` | **Working** | Rich thread visualization (phases, files, timeline) |
| `SwarmOverview.tsx` | **Working** | Basic agent list with status dots, click-to-switch |
| `pane-analyzer.ts` | **Working** | tmux regex status detection — **to be replaced** |
| `claude-code-parser.ts` | **Partially disabled** | Event parsing disabled, still used for plan/permission detection |
| `AgentProcess.peekPaneStatus()` | **Working** | tmux-based status peek — **to be replaced** |

## Current vs Target

```
CURRENT:
┌─────────────────────────────────────────────────────────────┐
│ JSONL transcript ──→ transcript-watcher ──→ AVP events      │
│   (threads, journeys, pipelines, HumanShell prose)          │
│                                                             │
│ tmux capture-pane ──→ pane-analyzer ──→ activity status     │
│   (permissions, questions, working/idle)                    │
│                                                             │
│ Claude hooks ──→ hooks-handler ──→ activity override        │
│   (when configured — bypasses pane-analyzer)                │
│                                                             │
│ tmux capture-pane ──→ PanePreview (terminal view)           │
│ tmux send-keys ──→ steering commands                        │
│                                                             │
│ thread-summarizer ──→ LLM summaries (already uses events)   │
│ swarm-registry ──→ tmux-only session list                   │
└─────────────────────────────────────────────────────────────┘

TARGET:
┌─────────────────────────────────────────────────────────────┐
│ JSONL transcript ──→ SessionMonitor ──→ ALL session state   │
│   activity, permissions, questions, prose, tokens,          │
│   threads, journeys, pipelines, file activity               │
│                                                             │
│ Claude hooks ──→ SessionMonitor (real-time boost)           │
│   feeds same monitor, reduces polling latency               │
│                                                             │
│ tmux capture-pane ──→ PanePreview (terminal view only)      │
│ tmux send-keys ──→ steering commands                        │
│                                                             │
│ SessionScanner ──→ discover ALL sessions (tmux + non-tmux)  │
│ thread-summarizer ──→ fed by SessionMonitor events          │
└─────────────────────────────────────────────────────────────┘
```

## Implementation

### Phase 1: Unified SessionMonitor (Core Engine)

**Goal:** Single JSONL-based engine that replaces both `transcript-watcher.ts` event parsing AND `pane-analyzer.ts` status detection, while integrating with the existing `hooks-handler.ts`.

#### 1.1 — SessionMonitor: Merged Event + Status Engine

**New file: `packages/server/src/swarm/session-monitor.ts`**

Combines what `transcript-watcher.ts` does (AVP events) with what `pane-analyzer.ts` does (status detection) into one JSONL tail. **Reuses `jsonl-to-avp.ts` as-is** — that module is battle-tested and complex (plan detection heuristics, 30+ tool translations, test output parsing).

```ts
class SessionMonitor extends EventEmitter {
  // Events emitted:
  //   'event'    → AVPEvent (same as transcript-watcher)
  //   'status'   → SessionStatus (replaces pane-analyzer)
  //   'usage'    → { inputTokens, outputTokens } (same as transcript-watcher)

  constructor(options: {
    mode: 'full' | 'lightweight';  // full = AVP events + status, lightweight = status only
    hooksHandler?: HooksHandler;   // integrate existing hooks for real-time
  });

  start(jsonlPath: string): void;
  stop(): void;
  getStatus(): SessionStatus;
  getMetrics(): SessionMetrics;

  /** Accept real-time hook notification (bypasses JSONL polling delay) */
  applyHookUpdate(update: ActivityUpdate): void;
}

interface SessionStatus {
  activity: AgentActivity;    // working | waiting_input | waiting_permission | waiting_answer
  detail?: string;            // Tool name, question text, permission command
  options?: string[];         // Answer choices
  currentFile?: string;       // Last file being worked on
  breadcrumb?: string[];      // Subagent trail
  subagentCount?: number;
}

interface SessionMetrics {
  model?: string;
  tokensUsed: number;         // Cumulative
  turnCount: number;
  toolCount: number;
  lastActivity: number;       // Timestamp
}
```

**How status is detected from JSONL (replaces pane-analyzer regex):**

The `StatusDetector` class maintains a state machine fed by raw JSONL entries. It tracks:

- **`pendingTools: Map<toolId, { name, timestamp, input }>`** — tool_use blocks awaiting tool_result
- **`lastEntryType: 'user' | 'assistant' | 'system'`** — type of the most recent JSONL entry
- **`lastEntryTimestamp: number`** — when the last JSONL entry was written
- **`lastToolName: string | null`** — name of the most recently started tool

**State transitions (evaluated on every new JSONL entry):**

```
┌──────────────────────────────────────────────────────────────────────┐
│ Entry: type="user"                                                   │
│ → Clear all pendingTools                                             │
│ → Status: WORKING (agent processing user input)                      │
├──────────────────────────────────────────────────────────────────────┤
│ Entry: type="assistant" with tool_use blocks                         │
│ → Add each tool_use to pendingTools                                  │
│ → If tool is "AskUserQuestion":                                      │
│     → Status: WAITING_ANSWER                                         │
│     → Extract question from input.question, options from input.options│
│ → Else:                                                              │
│     → Status: WORKING (tool executing)                               │
│     → Extract currentFile from Read/Edit/Write input.file_path       │
├──────────────────────────────────────────────────────────────────────┤
│ Entry: type="user" with tool_result blocks                           │
│ → Remove matching tools from pendingTools by tool_use_id             │
│ → If pendingTools still has entries → WORKING                        │
│ → Else → WORKING (more processing expected)                          │
├──────────────────────────────────────────────────────────────────────┤
│ Entry: type="assistant" with ONLY text (no tool_use)                 │
│ → Status: WORKING (agent may send more, or is wrapping up)           │
│ → Mark as "potentially idle" — idle timer starts                     │
├──────────────────────────────────────────────────────────────────────┤
│ Idle timer: no new JSONL entry for 5+ seconds after text-only assist │
│ → Status: WAITING_INPUT (agent finished, waiting for user)           │
├──────────────────────────────────────────────────────────────────────┤
│ Stale timeout: pendingTools has entries for 5+ seconds, no new JSONL │
│ → Heuristic: likely WAITING_PERMISSION                               │
│ → Extract tool name + command from pending tool's input              │
│ → Status: WAITING_PERMISSION (tentative — hooks confirm instantly)   │
├──────────────────────────────────────────────────────────────────────┤
│ Hook override: applyHookUpdate(ActivityUpdate)                       │
│ → Immediately sets status, overrides JSONL-derived state             │
│ → Takes priority over all heuristics above                           │
└──────────────────────────────────────────────────────────────────────┘
```

**Permission detection detail:** Claude Code writes the `tool_use` block to JSONL *before* asking for permission. So if we see a `Bash` tool_use with no `tool_result` following, and the JSONL hasn't grown for 5+ seconds, the agent is likely waiting for permission. The stale timeout is conservative (5s) to avoid false positives during slow tool execution. Hooks provide instant confirmation — when a hook fires with `permission_prompt`, the StatusDetector immediately updates, bypassing the timeout heuristic.

**Permission-likely tools** (tools that may require approval based on config):
`Bash`, `Edit`, `Write`, `WebFetch`, `WebSearch`, `NotebookEdit`

Tools like `Read`, `Grep`, `Glob` are typically auto-approved and won't trigger the permission heuristic even when stale.

**JSONL tailing reuses the same approach as `transcript-watcher.ts`:**
- `fs.watch()` + 2-second poll fallback
- Byte offset tracking for incremental reads
- `seenToolIds` Map for deduplication
- JSON parse error handling for partial lines at EOF

**Integration with HooksHandler:**
```ts
// In SessionMonitor constructor:
if (hooksHandler) {
  hooksHandler.on('activity', (update: ActivityUpdate) => {
    this.applyHookUpdate(update);
  });
}
```

When hooks are active, they provide instant status. When not, JSONL polling detects status within 2 seconds.

#### 1.2 — SessionScanner: Discover All Sessions

**New file: `packages/server/src/swarm/session-scanner.ts`**

Scans `~/.claude/projects/` to find all active sessions — **not just tmux panes**. This is what enables monitoring VS Code / Cursor agents.

```ts
interface DiscoveredSession {
  sessionId: string;
  projectPath: string;        // Decoded from slug
  projectSlug: string;        // Directory name in ~/.claude/projects/
  jsonlPath: string;
  lastModified: number;
  // From sessions-index.json (if available):
  gitBranch?: string;
  firstPrompt?: string;
  summary?: string;
  messageCount?: number;
}
```

**Discovery logic:**
1. List directories in `~/.claude/projects/`
2. For each: read `sessions-index.json` if it exists → get session metadata
3. Else: glob `*.jsonl` + stat for modification time
4. Filter to active: JSONL modified within last 30 minutes
5. Decode project path from slug (read `project.json` breadcrumb if available, else reverse the slug)
6. Cache results, refresh every 10 seconds

**Relationship to SwarmRegistry:**
The existing `SwarmRegistry` queries tmux panes and cross-references with DB sessions. `SessionScanner` replaces the tmux-pane-as-source-of-truth approach. The new flow:

```
SessionScanner (JSONL discovery) → all active sessions
  + AgentProcess.listPanes() → tmux pane list (for "can we switch to this?" flag)
  = SwarmAgent[] with both JSONL status and tmux switchability
```

#### 1.3 — SwarmService: Orchestrator

**New file: `packages/server/src/swarm/swarm-service.ts`**

Replaces `SwarmRegistry` as the central swarm management layer.

```ts
class SwarmService {
  private scanner: SessionScanner;
  private monitors: Map<string, SessionMonitor>;  // sessionId → monitor
  private attachedMonitor: SessionMonitor | null;

  constructor(
    private hooksHandler: HooksHandler,
    private sessionStore: SessionStore,
    private eventStore: EventStore,
  );

  /** Called for the ATTACHED session — full monitor replacing transcript-watcher + pane-analyzer */
  attachSession(jsonlPath: string): SessionMonitor;
  detachSession(): void;

  /** Called for swarm overview — lightweight monitors for all discovered sessions */
  getSwarmStatus(): SwarmAgent[];

  /** Build text summary for CommanderChat context */
  buildSwarmSummary(): string;

  start(): void;
  stop(): void;
}

interface SwarmAgent {
  sessionId: string;
  projectPath: string;
  projectName: string;
  gitBranch?: string;
  firstPrompt?: string;
  summary?: string;
  status: SessionStatus;
  metrics: SessionMetrics;
  tmuxTarget?: string;        // Non-null if switchable via tmux
  isCurrentSession: boolean;
  source: 'tmux' | 'jsonl';   // How this session was discovered
}
```

**Attached vs background monitors:**
- **Attached session** (`mode: 'full'`): Emits AVP events (for threads/journeys/pipelines/HumanShell), status updates, token tracking. Replaces `transcript-watcher.ts` + `pane-analyzer.ts`.
- **Background sessions** (`mode: 'lightweight'`): Only parse status from last few JSONL entries, track metrics. No AVP event emission. Low CPU.

#### 1.4 — Migrate Attached Session to SessionMonitor

**Modify: `packages/server/src/index.ts`**

Replace the current attach flow. Run BOTH old and new in parallel for parity verification:

```
PHASE 1 (parallel):
  attachToPane() →
    swarmService.attachSession(jsonlPath)   // NEW — SessionMonitor
    + new TranscriptWatcher()                // OLD — keep for parity check
    + AgentProcess (still does capture-pane for PanePreview)
    + pane-analyzer (still runs, results compared but not used)
```

The `SessionMonitor` emits the same `'event'` and `'usage'` events as `TranscriptWatcher`, so the wiring is identical:

```ts
const monitor = swarmService.attachSession(jsonlPath);

// Same as transcript-watcher wiring:
monitor.on('event', (event) => handleEvent(event));
monitor.on('usage', (usage) => tokenTracker.recordUsage(usage));

// NEW: status updates replace pane-analyzer
monitor.on('status', (status) => {
  applyActivityUpdate({
    activity: status.activity,
    detail: status.detail,
    options: status.options,
  });
  // Also update session state with new fields:
  updateSessionState({
    agentCurrentFile: status.currentFile,
    agentBreadcrumb: status.breadcrumb,
  });
});
```

**What changes in the event processing pipeline (`handleEvent()`):**
Nothing. `handleEvent()` receives AVPEvents and processes them identically regardless of source. The following all continue working unchanged:
- SQLite persistence
- Graph updates (file activity → codebase map)
- InsightEngine (intent detection, proactive notifications)
- ThreadSummarizer (phase tracking, LLM summaries)
- LoopDetector
- Sub-agent tracking
- Permission stats
- Token tracking
- WebSocket broadcast to clients

**Permission/question flow stays the same for the UI:**
- Client receives `session.state` with `agentActivity: 'waiting_permission'`
- Shows approve/reject buttons
- User clicks → `send-keys` via tmux → JSONL records the result
- SessionMonitor detects the `tool_result` → updates status to `working`

#### 1.5 — Wire Swarm Overview

**Modify: `panes.status` handler in `index.ts`**

Replace `SwarmRegistry` usage with `SwarmService`:

```ts
case 'panes.status': {
  const agents = swarmService.getSwarmStatus();
  const panes = agents.map(a => ({
    id: a.tmuxTarget || a.sessionId,
    title: a.projectName,
    command: '',
    status: mapActivityToPaneStatus(a.status.activity),
    statusLine: a.status.detail || a.firstPrompt || '',
    // New fields:
    projectPath: a.projectPath,
    gitBranch: a.gitBranch,
    model: a.metrics.model,
    tokensUsed: a.metrics.tokensUsed,
    turnCount: a.metrics.turnCount,
    currentFile: a.status.currentFile,
    source: a.source,
  }));
  socket.send(JSON.stringify({ kind: 'panes.list', panes }));
  break;
}
```

Also replace `swarmRegistry.buildSwarmSummary()` calls in `CommanderChat` context building.

#### 1.6 — Update Shared Types

**Modify: `packages/shared/src/ws-messages.ts`**

Extend `TmuxPane` interface with new fields:

```ts
export interface TmuxPane {
  id: string;
  title: string;
  command: string;
  status?: PaneStatus;
  statusLine?: string;
  // New fields from SessionMonitor:
  projectPath?: string;
  gitBranch?: string;
  model?: string;
  tokensUsed?: number;
  turnCount?: number;
  currentFile?: string;
  source?: 'tmux' | 'jsonl';
}
```

### Phase 2: Verify Parity + Remove Old Code

**Goal:** Confirm SessionMonitor produces identical results, then delete old code paths.

#### 2.1 — Parity Verification

Run both systems for at least one full session:
- Compare AVP events emitted (type, timestamp, data) — should be identical
- Compare activity status transitions — SessionMonitor should detect permissions/questions at least as fast
- Log any discrepancies for investigation

#### 2.2 — Remove pane-analyzer.ts

- Delete `packages/server/src/parser/pane-analyzer.ts`
- Remove all `analyzePaneContent()` calls from `index.ts`
- Remove `peekPaneStatus()` and `listPanesWithStatus()` from `agent-process.ts`
- Status now comes exclusively from SessionMonitor (+ hooks for real-time)

#### 2.3 — Simplify AgentProcess

`AgentProcess` becomes a thin tmux wrapper:
- `attach()` → poll for PanePreview content only (300ms interval stays)
- `write()` / `sendEnter()` / `sendInterrupt()` / `sendKeys()` — steering
- `listPanes()` — discovery (still useful for tmux-specific features + switchability flag)
- `spawnAgent()` — creating new tmux sessions
- **Remove**: `peekPaneStatus()`, `listPanesWithStatus()`, anchor-based diffing for event parsing
- **Remove**: The `'data'` event emission (new lines) — only `'pane-content'` survives (for PanePreview)

#### 2.4 — Retire transcript-watcher.ts

The `SessionMonitor` fully subsumes `transcript-watcher.ts`:
- Same JSONL tailing logic (byte offsets, file watching, dedup)
- Same `jsonl-to-avp.ts` translation (imported, not copied)
- Plus status detection on top

Delete: `packages/server/src/transcript/transcript-watcher.ts`
Keep: `packages/server/src/transcript/jsonl-to-avp.ts` (imported by SessionMonitor)

#### 2.5 — Retire claude-code-parser.ts

The parser is already disabled for event parsing. Remaining uses:
- **Plan file detection** → move to SessionMonitor (JSONL has `ExitPlanMode` tool_use with plan file path)
- **Plan title detection** → move to SessionMonitor (JSONL has plan content in assistant messages)
- **Permission extraction** → replaced by JSONL-based detection in SessionMonitor

Delete: `packages/server/src/parser/claude-code-parser.ts`

#### 2.6 — Retire SwarmRegistry

Replaced by `SwarmService`. Delete `packages/server/src/llm/swarm-registry.ts`.

### Phase 3: Thread Cards in HumanShell

**Goal:** Replace the flat HumanShell prose view with structured thread cards.

The server-side `ThreadSummarizer`, `ThreadSummaryStore`, and client-side `thread-store.ts` are already built. What's missing is the **card-based view** in HumanShell.

#### 3.1 — ThreadCards Component

**New file: `packages/client/src/components/Mobile/views/ThreadCards.tsx`**

Uses `useMemo` to merge:
1. Server threads from `useThreadStore` (has LLM summaries, outcomes)
2. Client-side grouping from `useEventStore` events (split at `task.start` — fills gaps when server hasn't summarized yet)

**Each ThreadCard renders:**
```
┌─ [accent bg] User prompt text (bold, truncated)              [time] ─┐
│                                                                       │
│  ●────●────○────○   Investigating → Implementing                      │
│                                                                       │
│  "Found sync calls blocking async loop, added thread pool"    [1-line]│
│                                                                       │
│  [PR #147 merged]                                    [green badge]    │
│                                                                       │
│  ▼ 8 messages                                        [expand toggle]  │
└───────────────────────────────────────────────────────────────────────┘
```

- **Active thread**: expanded, border-left pulsing accent.primary
- **Completed thread**: collapsed, border-left status.success (green) or status.error (red)
- **Phase pipeline**: 4 dots connected by line. Filled = reached. Current = pulsing.
- **Summary**: fonts.mono 11px, text.secondary. Shows "..." skeleton while LLM processing.
- **Outcome badge**: small pill, uppercase, colored by type
- **Expand/collapse**: Click toggles full agent prose (raw.output entries from this thread's time window)
- **Scroll**: Most recent thread at bottom, auto-scroll on new thread

#### 3.2 — Update HumanShell

**Modify: `packages/client/src/components/Mobile/views/HumanShell.tsx`**

Replace flat `entries.map()` with `<ThreadCards />`. Keep the input bar at bottom.

### Phase 4: Rich Swarm Overview UI

**Goal:** Upgrade SwarmOverview to show rich agent cards with JSONL-sourced data.

#### 4.1 — Agent Cards

```
┌─────────────────────────────────────────────────────────────┐
│ ● hudai-public                main       claude-opus-4-6    │
│   "Add swarm monitoring..."                                 │
│   ⟳ Working on MapRenderer.ts         12 turns · 45k tokens│
│                                              [Switch]       │
└─────────────────────────────────────────────────────────────┘
```

Fields: status dot, project name, git branch, model, first prompt/summary, current activity + file, turn count, token usage.

#### 4.2 — Group by Project

```
hudai-public (3 agents)
  ● main — Working · MapRenderer.ts — 45k tokens
  ◦ feat/auth — Idle — 12k tokens
  ⚠ main — Permission: Bash — 8k tokens

where2eat (1 agent)
  ● main — Working · pipeline.ts — 23k tokens
```

#### 4.3 — Non-tmux Session Support

Sessions discovered via JSONL but not in tmux:
- Show in the list with a different icon (no terminal)
- Can't "Switch" (no tmux target) but can see status
- Useful for monitoring VS Code / Cursor agents

### Phase 5: Enhanced Hooks Integration

**Goal:** Make hooks setup easy and leverage them for instant status.

The `HooksHandler` already exists and handles `permission_prompt`, `idle_prompt`, and `elicitation_dialog`. What's needed:

#### 5.1 — Hook Auto-Install

Add a button in ConfigSlideOver: "Enable real-time monitoring"
- Writes hook configuration to `~/.claude/settings.json`:
  ```json
  {
    "hooks": {
      "Notification": [{
        "command": "curl -s -X POST http://localhost:4200/api/hooks/notification -H 'Content-Type: application/json' -d \"$CLAUDE_NOTIFICATION\""
      }]
    }
  }
  ```
- Shows hook status (installed/not installed)
- Note: The `/api/hooks/notification` endpoint already exists in `index.ts`

#### 5.2 — Hook → SessionMonitor Bridge

When hooks fire, feed them into the SessionMonitor:
```ts
hooksHandler.on('activity', (update) => {
  const monitor = swarmService.getAttachedMonitor();
  if (monitor) monitor.applyHookUpdate(update);
});
```

This gives instant status (~50ms) while JSONL provides the authoritative state.

### Phase 6: Token Cost Dashboard

- Accumulate token usage per session from JSONL `usage` fields (already parsed by `extractUsage()` in `jsonl-to-avp.ts`)
- Apply model pricing (opus/sonnet/haiku rates)
- Show running total in SwarmOverview header
- Per-session cost in agent cards
- Historical cost tracking in existing SQLite schema

## Files Changed

| File | Action | Phase |
|------|--------|-------|
| `packages/server/src/swarm/session-monitor.ts` | **Create** — unified JSONL engine | 1 |
| `packages/server/src/swarm/session-scanner.ts` | **Create** — session discovery | 1 |
| `packages/server/src/swarm/swarm-service.ts` | **Create** — orchestrator | 1 |
| `packages/server/src/index.ts` | Modify — wire SwarmService alongside existing code | 1 |
| `packages/shared/src/ws-messages.ts` | Modify — extend TmuxPane with new fields | 1 |
| `packages/server/src/parser/pane-analyzer.ts` | **Delete** | 2 |
| `packages/server/src/transcript/transcript-watcher.ts` | **Delete** (subsumed by SessionMonitor) | 2 |
| `packages/server/src/parser/claude-code-parser.ts` | **Delete** (remaining uses moved to SessionMonitor) | 2 |
| `packages/server/src/llm/swarm-registry.ts` | **Delete** (replaced by SwarmService) | 2 |
| `packages/server/src/pty/agent-process.ts` | Simplify — remove status detection, anchor diffing | 2 |
| `packages/client/src/components/Mobile/views/ThreadCards.tsx` | **Create** — card-based thread view | 3 |
| `packages/client/src/components/Mobile/views/HumanShell.tsx` | Modify — swap to ThreadCards | 3 |
| `packages/client/src/components/WorkMode/SwarmOverview.tsx` | Rewrite — rich agent cards | 4 |
| `packages/client/src/components/ConfigSlideOver/ConfigSlideOver.tsx` | Modify — hook install button | 5 |

## Implementation Order

1. **Phase 1.1-1.2**: SessionMonitor + SessionScanner (new files, no existing code changed)
2. **Phase 1.3**: SwarmService orchestrator
3. **Phase 1.4**: Wire into `index.ts` — run SessionMonitor **in parallel** with existing transcript-watcher + pane-analyzer (verify parity)
4. **Phase 1.5-1.6**: Wire swarm overview + update shared types
5. **Phase 2**: Once parity confirmed → delete pane-analyzer, transcript-watcher, claude-code-parser, swarm-registry, simplify AgentProcess
6. **Phase 3**: ThreadCards component in HumanShell
7. **Phase 4**: Rich swarm UI
8. **Phase 5**: Hook auto-install + bridge
9. **Phase 6**: Token cost tracking

## What Stays Unchanged

- **PanePreview component** — still renders raw tmux terminal via capture-pane (300ms polling)
- **Steering commands** — still tmux send-keys via CommandHandler (approve, reject, prompt, interrupt, etc.)
- **jsonl-to-avp.ts** — reused as-is by SessionMonitor (battle-tested, complex, don't rewrite)
- **handleEvent() pipeline** — receives AVPEvents identically, all downstream processing unchanged
- **InsightEngine + CommanderChat** — fed by handleEvent(), no changes needed
- **ThreadSummarizer** — fed by handleEvent(), no changes needed
- **Thread/journey/pipeline views** — still built from AVP events (same source, different engine)
- **Codebase map** — unchanged
- **Event persistence** — SQLite EventStore stays, events still flow through handleEvent()
- **SubagentWatcher** — still tracks sub-agent lifecycle from events
- **LoopDetector** — still monitors for repeated patterns
- **PlanFileWatcher** — still watches plan markdown files for changes

## Key Design Decisions

1. **Parallel rollout** — Phase 1 runs SessionMonitor alongside transcript-watcher to verify parity before removing old code in Phase 2. No big-bang migration.
2. **Reuse jsonl-to-avp.ts** — The most complex piece (plan detection heuristics, 30+ tool translations, test parsing) is imported into SessionMonitor, not rewritten.
3. **SessionMonitor is EventEmitter** — Same interface as transcript-watcher (`'event'`, `'usage'`, plus new `'status'`) so the rest of the system doesn't care which engine produces events.
4. **Background monitors are lightweight** — Only parse status from last few JSONL entries, don't emit full AVP event streams. O(1) per poll cycle.
5. **Hooks are optional** — JSONL polling at 2s is good enough. Hooks are a latency optimization (<50ms), not a requirement. The HooksHandler already exists.
6. **tmux stays for display + input** — No replacement needed, it does those jobs well. Just stop using it for status/event extraction.
7. **SessionScanner enables non-tmux monitoring** — VS Code, Cursor, and other Claude Code clients write to the same `~/.claude/projects/` JSONL files.

## Verification

1. **Parity test**: Run both transcript-watcher and SessionMonitor on the same session, compare events emitted (type, count, timestamps)
2. **Status parity**: Compare pane-analyzer activity detection with SessionMonitor — should agree or SessionMonitor should be more accurate
3. **Permission test**: Agent hits permission → SessionMonitor detects `waiting_permission` with tool name → UI shows approve/reject → approve → SessionMonitor detects `working`
4. **Question test**: Agent asks question → SessionMonitor detects `waiting_answer` with options → UI shows options
5. **Thread test**: ThreadCards render from SessionMonitor events → phases update live → LLM summary appears
6. **Swarm test**: 3 agents in different projects → all appear in SwarmOverview with correct status, tokens, branches
7. **Non-tmux test**: Start Claude in VS Code terminal → appears in SwarmOverview via JSONL discovery (no switch button)
8. **Hook test**: Install hooks → permission detected in <100ms vs 2s polling
9. **Token test**: Verify token counts match Claude's own reporting
10. **Deletion test**: After Phase 2, full build succeeds with no references to deleted modules
