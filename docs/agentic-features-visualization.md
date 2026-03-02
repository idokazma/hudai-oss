# Agentic Features Visualization — Research & Recommendations

> What agentic engineering concepts are most important to expose in Hudai, and how to best visualize them.

---

## 1. The Agentic Feature Landscape

Claude Code (and agentic coding tools in general) have evolved far beyond "send prompt, get code." A modern agentic session involves:

| Feature | What it is | Currently in Hudai? |
|---------|-----------|---------------------|
| **Tool calls** (Read, Edit, Bash, Grep, Glob, Write, WebFetch, WebSearch) | The atomic actions the agent takes | Yes (Timeline, Journey, BuildQueue) |
| **Permission prompts** | Agent pauses for human approval | Yes (AlertsPanel, StatusBar) |
| **Thinking/reasoning** | Extended thinking blocks before acting | Partial (think.start/end events) |
| **Sub-agents** | Spawned child agents (Explore, Plan, Bash, general-purpose, custom) | **No** |
| **Skills / slash commands** | Reusable prompt packs loaded into context | **No** |
| **Allow list / permission rules** | Deny/ask/allow rules per tool (e.g. `Bash(npm run *)`) | **No** |
| **Hooks** | Shell scripts that fire on PreToolUse, PostToolUse, SubagentStart/Stop, etc. | **No** |
| **MCP servers** | External tool integrations (GitHub, Linear, Postgres, filesystem, memory) | **No** |
| **Token usage / cost** | Input/output/cache tokens per message, cumulative cost | **No** |
| **Context window** | 200k token budget shared by system prompt, tools, conversation, memory | **No** |
| **Auto-compaction** | Conversation summarization when context fills up | **No** |
| **Memory files** | CLAUDE.md, agent memory directories, persistent cross-session knowledge | **No** |
| **Plan mode** | Read-only exploration phase before committing to implementation | **No** |
| **Todo/task lists** | Agent's internal task tracking (TaskCreate, TaskUpdate, TaskList) | Partial (plan.update events) |
| **Agent activity state** | Idle, working, waiting for approval, asking question | Yes (just added) |

---

## 2. Priority Ranking — What to Expose Next

Ranked by **impact on understanding agent behavior** and **data availability** (what we can actually extract from JSONL transcripts):

### Tier 1 — High Impact, Data Available Now

#### 2.1 Sub-Agent Tree (Spawning & Delegation)

**Why it matters:** Sub-agents are invisible to the user today. When Claude spawns an Explore agent to search the codebase, or a Plan agent to research architecture, or a general-purpose agent to handle a complex sub-task — the user sees nothing. This is the single biggest blind spot.

**What data is available:**
- JSONL transcripts contain `tool_use` blocks with `name: "Task"` and input fields: `{ subagent_type, description, prompt, model, run_in_background }`
- Each sub-agent gets its own JSONL file: `~/.claude/projects/{slug}/{sessionId}/subagents/agent-{agentId}.jsonl`
- Sub-agent completion returns results to the parent transcript
- `SubagentStart` and `SubagentStop` hook events fire with agent type names

**How to visualize:**

```
Parent Agent (main session)
├── [Explore] "Search for auth middleware" (haiku, 3.2s)
│   ├── Glob(**/*.ts)
│   ├── Read(src/middleware/auth.ts)
│   └── Grep("authenticate")
├── [Plan] "Design permission system" (sonnet, 12.1s)
│   ├── Read(src/models/user.ts)
│   └── Read(src/routes/api.ts)
├── Edit(src/middleware/auth.ts)
└── [general-purpose] "Write unit tests" (sonnet, 45.3s, background)
    ├── Read(src/middleware/auth.ts)
    ├── Write(tests/auth.test.ts)
    └── Bash(npm test)
```

**Recommended visualization:**
- **Nested tree in Timeline/BuildQueue** — indented events with agent type badge (color-coded per agent type)
- **Agent spans on StatusBar** — show "Main > Explore" breadcrumb when sub-agent is active
- **Codemap overlay** — draw agent "territory" on the map (which files each sub-agent touched)
- **Collapsible sub-agent sections** — expand to see internal tool calls, collapse to see just summary

**Implementation:** Parse `Task` tool_use blocks from JSONL, follow sub-agent JSONL files for their internal events, emit `subagent.start` / `subagent.end` AVP events.

---

#### 2.2 Token Usage & Cost Dashboard

**Why it matters:** The #1 practical concern for teams. Claude Code costs ~$6-12/day per developer. Users have no visibility into where tokens go, which prompts are expensive, or when they're about to hit limits.

**What data is available:**
- Every JSONL message includes `usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }`
- Token counts are per-message, so we can build cumulative curves
- Model info is available per message (opus vs sonnet vs haiku = different costs)

**How to visualize:**

**Option A: Token burn gauge (recommended for StatusBar)**
```
Tokens: ████████░░ 156k/200k (78%)   Cost: $2.34   Burn: ~1.2k tok/min
```

**Option B: Cost breakdown panel (recommended for a new "Metrics" tab)**
- Stacked area chart: input tokens (blue), output tokens (green), cache reads (gray) over time
- Per-tool cost breakdown: "Bash: $0.82, Read: $0.41, Edit: $0.31, Thinking: $0.80"
- Per-sub-agent cost: "Explore agents: $0.12, Plan agents: $0.45, Main: $1.77"
- Burn rate trend line with "estimated time to context limit"

**Option C: Context pressure indicator (recommended for Codemap)**
- Ring around the map that fills as context is consumed
- Color shifts from blue → yellow → red as it approaches 200k
- Compaction events shown as "reset" markers on the ring

**Implementation:** Parse `usage` fields from JSONL messages, aggregate by message/tool/agent, compute costs using model pricing (opus: $15/$75 per 1M tokens, sonnet: $3/$15, haiku: $0.80/$4).

---

#### 2.3 Context Window Health

**Why it matters:** When context fills up, auto-compaction fires and the agent loses conversation history. This directly affects agent quality. Users need to see it coming.

**What data is available:**
- Token usage per message (cumulative = context size estimate)
- Compaction events in JSONL: `{ type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "auto", preTokens: 167189 } }`
- System prompt size, tool definitions, memory files — all consume context

**How to visualize:**
- **Context meter** in StatusBar: segmented bar showing system prompt | tools | memory | conversation | remaining
- **Compaction markers** on Timeline: vertical line with "Context compacted at 167k tokens" label
- **Warning alert** when context exceeds 80%: "Context pressure: 82% — agent may compact soon"

---

### Tier 2 — High Impact, Moderate Effort

#### 2.4 Permission & Allow List Visibility

**Why it matters:** Users configure complex allow/deny rules but have no visibility into which rules fired, which tools were auto-approved vs prompted, and whether their rules are actually working.

**What data is available:**
- Permission prompts visible in pane content (already detected)
- Allow list rules stored in `settings.json` and `.claude/settings.json`
- Hook results (PreToolUse exit codes) determine approval/denial

**How to visualize:**
- **Permission shield icon** on each tool call event: green (auto-allowed), yellow (prompted), red (denied)
- **Permission rules panel** — list active rules with hit counts: `Bash(npm run *): 12 auto-approvals`
- **Permission timeline** — show when the agent was blocked vs flowing freely
- **Rule suggestion** — "This tool was prompted 8 times. Consider adding to allow list: `Bash(npx tsc *)`"

---

#### 2.5 MCP Server & External Tool Integration

**Why it matters:** MCP servers extend the agent's capabilities (GitHub, Linear, databases, etc.). Users need to know which external tools are connected, when they're called, and if they're failing.

**What data is available:**
- MCP tool calls appear as `tool_use` blocks with names like `mcp__github__create_issue`
- MCP server config in settings.json
- Tool results include success/failure

**How to visualize:**
- **MCP badge on tool calls** — distinguish internal tools (Read, Edit) from external MCP tools
- **Connected services indicator** in StatusBar: icons for GitHub, Linear, etc.
- **MCP health** — show if servers are connected/disconnected/erroring
- **External action log** — separate feed for actions that affect external systems (created issue, posted comment, etc.)

---

#### 2.6 Skills & Slash Commands

**Why it matters:** Skills are reusable prompt packs that load specialized knowledge. Users need to see which skills are loaded, when they activate, and how much context they consume.

**What data is available:**
- Skill invocations visible in JSONL (tool_use with Skill tool)
- Skill files in `.claude/skills/` and `~/.claude/skills/`
- Skills loaded into sub-agents via `skills` frontmatter field

**How to visualize:**
- **Skill activation events** in Timeline: "Loaded skill: frontend-design (2.3k tokens)"
- **Active skills list** in a config/info panel
- **Skill context cost** — show how much context each skill consumes

---

### Tier 3 — Medium Impact, Good to Have

#### 2.7 Hooks Execution Log

**Why it matters:** Hooks run silently. When a PreToolUse hook blocks a command or a PostToolUse hook runs a linter, the user doesn't see it unless they check terminal output.

**How to visualize:**
- **Hook badge on tool calls** — small icon showing "hook ran" with result (approved/denied/modified)
- **Hook execution log** — expandable section showing hook command, exit code, stderr output
- Hooks that deny should generate alerts

---

#### 2.8 Reasoning Trace / Decision Tree

**Why it matters:** Understanding *why* the agent chose a particular approach. Extended thinking blocks contain the reasoning, but they're hidden.

**What data is available:**
- `thinking` content blocks in JSONL (when extended thinking is enabled)
- Agent text responses explain reasoning
- Tool call sequences reveal the implicit decision tree

**How to visualize:**
- **Thinking duration bars** on Timeline — show how long the agent thought before each action
- **Reasoning summary** — collapsible thinking block content (first ~200 chars)
- **Decision flow** — when agent considers multiple approaches, show the branch points
- **Waterfall view** — like LangSmith/AgentPrism, show nested spans with timing

---

#### 2.9 Memory File Awareness

**Why it matters:** CLAUDE.md and agent memory directories are the agent's "institutional knowledge." Changes to these files affect all future sessions.

**How to visualize:**
- **Memory file indicator** — show which memory files are loaded and their token cost
- **Memory edit alerts** — when the agent modifies CLAUDE.md or memory files, highlight it prominently
- **Memory diff** — show what changed in memory files during the session

---

## 3. Visualization Patterns from Industry

Based on research into LangSmith, AgentOps, AgentPrism, Datadog LLM Observability, and others:

### 3.1 Trace Tree (LangSmith, AgentPrism)
**Best for:** Understanding nested execution structure
- Hierarchical tree where each node is a span (LLM call, tool use, sub-agent)
- Expandable/collapsible with timing bars
- Color-coded by span type (LLM=blue, tool=green, error=red)
- Click to inspect input/output

**Hudai application:** Sub-agent tree in BuildQueue/Timeline

### 3.2 Waterfall Timeline (AgentOps, Datadog)
**Best for:** Understanding temporal flow and parallelism
- Horizontal bars showing duration of each operation
- Parallel operations shown as overlapping bars
- Token cost overlaid as bar height or color intensity
- Errors highlighted in red

**Hudai application:** Enhanced Timeline with duration bars

### 3.3 Session Replay (AgentOps)
**Best for:** Post-hoc debugging
- Time-travel through agent decisions
- Replay tool calls with their inputs/outputs
- See what the agent "saw" at each decision point

**Hudai application:** Replay scrubber (already planned for Phase 1E)

### 3.4 Cost Dashboard (LangSmith, ccusage)
**Best for:** Budget management and optimization
- Daily/weekly cost trends
- Per-model, per-tool, per-session breakdowns
- Anomaly detection (sessions that cost 10x average)

**Hudai application:** Metrics tab with cost charts

### 3.5 Span Cards (AgentPrism)
**Best for:** Quick inspection of individual operations
- Compact cards with: tool name, duration, token count, status
- Inline detection badges for anomalies
- Accessible, keyboard-navigable

**Hudai application:** Enhanced Timeline event cards

---

## 4. Community Patterns — What People Are Actually Building

Analysis of [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) (400+ stars, 100+ projects) reveals what the community cares about most. These are the features people build tools around — and therefore what Hudai should surface.

### 4.1 Most-Built-For Features (by category count)

| Category | # Projects | What it tells us |
|----------|-----------|------------------|
| **Orchestrators** (Claude Squad, Claude Swarm, Auto-Claude, TSK, Happy Coder) | 9+ | Multi-agent is the #1 power-user pattern. People run 2-10 Claude instances in parallel. **Hudai must show multi-agent state.** |
| **Usage Monitors** (ccusage, ccflare, better-ccflare, Claudex, Claude Code Usage Monitor, viberank) | 6+ | Cost/token tracking is the #1 operational concern. 6 separate tools exist just for this. **Hudai must show token burn.** |
| **Skills & Agent Systems** (AgentSys, Superpowers, Everything Claude Code, Claude Code Agents, Context Engineering Kit) | 15+ | Skills are the new "plugins." People build specialized agent configurations for security auditing, DevOps, data science, book writing. **Hudai should show which skills are active.** |
| **Hooks** (cc-tools, cchooks, TDD Guard, Claudio, TypeScript Quality Hooks, Claude Code Hook Comms) | 9+ | Hooks are the control plane. People use them for TDD enforcement, quality gates, sound effects, inter-agent communication. **Hudai should show hook execution.** |
| **Session Management** (cc-sessions, Claude Session Restore, recall, cchistory) | 4+ | Context loss across sessions is painful. People build tools to restore context. **Hudai should show compaction + session continuity.** |
| **Alternative Clients** (crystal, Claudable, Claude Code Chat) | 3+ | People want better UIs for Claude Code. **Hudai IS this — we're in the right space.** |

### 4.2 Key Community Tools and What They Visualize

#### Multi-Agent Orchestrators — Our Direct Competition

| Tool | What it shows | What Hudai should learn |
|------|-------------|----------------------|
| **[Claude Squad](https://github.com/smtg-ai/claude-squad)** | Terminal UI managing multiple Claude Code instances in separate workspaces. Shows agent status, git worktree isolation. | Show per-agent workspace boundaries, parallel agent status grid |
| **[Auto-Claude](https://github.com/AndyMik90/Auto-Claude)** | Kanban-style UI for autonomous SDLC. Plans, builds, validates. | Task board / kanban view for agent work items |
| **[Claude Swarm](https://github.com/parruda/claude-swarm)** | Swarm of connected Claude Code sessions. | Agent topology / connection graph |
| **[Happy Coder](https://github.com/slopus/happy)** | Mobile-friendly — push notifications when Claude needs input. | Mobile/notification support is a differentiator |
| **[TSK](https://github.com/dtormoen/tsk)** | Rust CLI, sandboxed Docker agents, returns git branches. | Git branch tracking per agent |
| **[crystal](https://github.com/stravu/crystal)** | Full desktop app for orchestrating + monitoring Claude Code agents. | Most direct competitor — study its UX |

**Implication for Hudai:** We need a multi-agent dashboard. Not just "one agent's timeline" but a grid/topology showing all running agents, their states, which files they own, and their token burn.

#### Usage Dashboards — Features People Pay Attention To

| Tool | Key Metrics Shown |
|------|------------------|
| **[ccflare](https://github.com/snipeship/ccflare)** / **[better-ccflare](https://github.com/tombii/better-ccflare/)** | Web UI with: cost per session, token breakdown (input/output/cache), per-model costs, daily trends, provider support |
| **[ccusage](https://github.com/ryoppippi/ccusage)** | CLI: daily/monthly/session aggregation, cache token tracking, burn rate |
| **[Claude Code Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor)** | Real-time terminal: live burn rate, visual progress bars, ML-based depletion prediction, subscription plan awareness |
| **[Vibe-Log](https://github.com/vibe-log/vibe-log-cli)** | Session analysis, strategic guidance, HTML reports, statusline integration |

**Consensus metrics everyone tracks:**
1. Total cost ($) per session/day
2. Token breakdown: input vs output vs cache-read vs cache-create
3. Burn rate (tokens/minute)
4. Context usage % (of 200k)
5. Model distribution (opus vs sonnet vs haiku)
6. Cost per tool type

**Hudai should show ALL of these.** They're clearly the most-demanded data points.

#### Hooks — The Silent Control Plane

Community hook patterns reveal what people want to automate:

| Hook Pattern | Tools | Hudai Visualization |
|-------------|-------|-------------------|
| **Quality gates** (lint, format, typecheck after edits) | TDD Guard, TypeScript Quality Hooks, cc-tools | Show pass/fail badge on each tool call |
| **Permission validation** (block dangerous commands) | PreToolUse hooks, validate-readonly-query | Show "hook blocked" / "hook allowed" on Timeline |
| **Notifications** (alert when agent needs input) | CC Notify, Happy Coder | Already doing this with activity detection |
| **Sound effects** (audio feedback) | Claudio | N/A for web UI |
| **Inter-agent communication** (HCOM) | Claude Hook Comms | Show message flow between agents |
| **Auto-formatting** (Britfix, Prettier) | Britfix, PostToolUse hooks | Show "auto-formatted" badge after file edits |

**Hudai should:** Show hook execution as small inline badges on tool call events. Green = passed, red = blocked, yellow = modified. Expandable to see hook details.

#### Skills & Workflows — What People Configure

Most popular skill categories from the awesome list:

1. **Security auditing** (Trail of Bits, cc-devops-skills) — agent acts as security reviewer
2. **Full SDLC** (Superpowers, Claude Code Agents, AgentSys) — plan/build/test/deploy
3. **Code review** (Compound Engineering, ContextKit) — automated review patterns
4. **Project management** (Claude Code PM, Simone, scopecraft) — PRDs, task tracking
5. **Domain-specific** (data science, DevOps, mountaineering research)

**Hudai should:** Show active skills/plugins as "loaded modules" indicator. When a skill activates, show it in Timeline: "Skill loaded: security-auditor (3.2k tokens)". Track which skills are consuming context.

#### Ralph Wiggum / Autonomous Loops — Emerging Pattern

5+ projects implement "Ralph loops" — running Claude Code in autonomous loops until a task is complete. Key concerns:
- **Loop iteration count** (how many cycles until convergence)
- **Rate limiting / circuit breakers** (prevent runaway costs)
- **Exit condition detection** (did it actually finish?)
- **Cost per loop iteration**

**Hudai should:** Detect loop patterns (repeated similar prompts), show iteration count, warn on potential runaway loops, track cost-per-iteration.

### 4.3 Configuration Awareness — What Settings Matter

From the CLAUDE.md and config manager categories, people actively manage:

| Config | Location | Why it matters for Hudai |
|--------|----------|------------------------|
| **Permission rules** | `settings.json`, `.claude/settings.json`, managed-settings.json | Show active rules, hit counts, suggestions |
| **MCP servers** | `settings.json` `mcpServers` | Show connected external tools |
| **Hooks** | `settings.json` `hooks` | Show hook execution inline |
| **Skills** | `.claude/skills/`, `~/.claude/skills/` | Show loaded skills + context cost |
| **Sub-agents** | `.claude/agents/`, `~/.claude/agents/` | Show available + active agents |
| **Memory** | `CLAUDE.md`, `.claude/agent-memory/` | Show memory file changes |
| **Rules** | `.claude/rules/` | Path-scoped instructions |
| **Context config** | `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` env | Compaction threshold |

**Hudai should have a "Config" panel** showing all loaded configurations at a glance — a "control panel" view of the agent's current setup.

### 4.4 Features the Community Wants But Nobody Has Built Yet

Gaps in the awesome list — things people discuss but no tool addresses:

1. **Real-time sub-agent visualization** — orchestrators manage agents but don't show their internal state live
2. **Cross-session context tracking** — what knowledge survived compaction? What was lost?
3. **Permission rule effectiveness** — are your allow rules actually being used?
4. **Agent decision replay** — why did the agent choose approach A over B?
5. **Cost attribution to outcomes** — this feature cost $2.34, was it worth it?
6. **Spatial code understanding** — which parts of the codebase has the agent explored vs ignored?

**Hudai already has #6 (codemap).** Building #1-5 would make us unique.

---

## 5. Recommended Implementation Roadmap

Prioritized for **agentic engineering visibility** — understanding what the agent is equipped with, how it delegates, and whether quality gates are passing.

### Phase A: Skills & Agent Configuration Visibility
_The agent's "loadout" — what capabilities does it have right now?_

1. **Skills discovery** — scan `.claude/skills/`, `~/.claude/skills/`, plugin skills directories
   - List all available skills with name, description, trigger pattern
   - Show which skills are currently loaded into context
   - Show skill activation events in Timeline: "Skill invoked: frontend-design"
2. **Skills marketplace awareness** — detect installed plugins from `.claude/plugins/`
   - Show plugin origin (npm, git, local)
   - Show which agents/skills each plugin provides
3. **Sub-agent inventory** — scan `.claude/agents/`, `~/.claude/agents/`, CLI-defined agents
   - List all available sub-agents: name, description, model, tool restrictions
   - Show built-in agents (Explore, Plan, Bash, general-purpose) + custom
   - Badge each with its permission mode and model
4. **MCP server status** — read `mcpServers` from settings.json
   - Show connected services (GitHub, Linear, Postgres, etc.)
   - Detect MCP tool calls (`mcp__*` prefix) in JSONL — show as external actions
5. **Config panel UI** — new tab or panel showing the agent's full "loadout":
   ```
   ┌─ AGENT LOADOUT ─────────────────────────┐
   │ Skills (4 loaded)                        │
   │  ● frontend-design    ● security-audit   │
   │  ● tdd-workflow       ● api-conventions  │
   │                                          │
   │ Sub-Agents (6 available)                 │
   │  ● Explore (haiku)  ● Plan (inherit)     │
   │  ● Bash (inherit)   ● code-reviewer      │
   │  ● debugger          ● data-scientist    │
   │                                          │
   │ MCP Servers (2 connected)                │
   │  ● github ✓  ● linear ✓                  │
   │                                          │
   │ Hooks (3 active)                         │
   │  PreToolUse: validate-cmd.sh             │
   │  PostToolUse: run-linter.sh              │
   │  Stop: cleanup.sh                        │
   └──────────────────────────────────────────┘
   ```

### Phase B: Sub-Agent Visualization (Live Delegation)
_See the agent's delegation hierarchy in real time._

1. Parse `Task` tool_use from JSONL → emit `subagent.start` / `subagent.end` events
2. Watch sub-agent JSONL files (`subagents/agent-{id}.jsonl`) for internal events
3. **Nested Timeline** — sub-agent events indented under parent, collapsible
   - Agent type badge (Explore=cyan, Plan=purple, Bash=green, custom=user-defined color)
   - Duration bar showing how long each sub-agent ran
   - Model badge (haiku/sonnet/opus) — shows cost tier at a glance
4. **StatusBar breadcrumb:** "Main > Explore > Glob(**/*.ts)" when sub-agent is active
5. **Codemap territories** — color-code which files each sub-agent touched
   - Different hue per agent type overlaid on the spatial map
   - Shows delegation boundaries visually
6. **Background agent indicator** — distinguish foreground (blocking) from background (concurrent) agents
7. **Agent result summary** — when sub-agent completes, show compact result card

### Phase C: Permissions & Quality Gates
_See what the agent is allowed to do, what it's blocked from, and whether quality checks pass._

1. **Permission rules panel** — read from `settings.json`, `.claude/settings.json`, managed-settings
   - List all allow/deny/ask rules with match counts
   - Highlight frequently-prompted tools → suggest adding to allow list
   - Show effective permission mode (default, acceptEdits, dontAsk, bypassPermissions)
2. **Permission badges on Timeline** — each tool call shows:
   - Green shield = auto-allowed by rule
   - Yellow shield = prompted user
   - Red shield = denied by rule or hook
3. **Hook execution inline** — show hook results on tool call events:
   - PreToolUse: "validate-cmd.sh → PASS" or "→ BLOCKED: write operations not allowed"
   - PostToolUse: "run-linter.sh → 2 warnings"
   - Expandable to see hook stderr output
4. **Rule suggestion engine** — "Bash(npm test) was prompted 8 times. Add to allow list?"

### Phase D: Live TDD & Test Health
_Real-time view of test status as the agent works._

1. **Test status dashboard** — persistent widget showing:
   ```
   Tests: 47 passed  2 failed  3 skipped
   Last run: 12s ago  Duration: 4.2s
   Coverage: 78% (estimated from test events)
   ```
2. **Test failure alerts** — prominent alert when tests break, with:
   - Failed test names and first line of error
   - File path of failing test (clickable to highlight on codemap)
   - "Agent is fixing..." indicator when agent responds to failure
3. **TDD cycle detection** — detect red→green→refactor pattern:
   - Show cycle count and current phase
   - "Cycle 3: RED — test written, implementation pending"
   - Detect when agent writes test before implementation (good) vs after (not TDD)
4. **Test-file heatmap on Codemap** — show test files with pass/fail coloring
   - Green = all tests passing
   - Red = failures in this test file
   - Pulsing = currently running
5. **Quality gate summary** — aggregate hook results + test results into health score:
   - Lint: PASS, Types: PASS, Tests: 2 FAIL, Format: PASS
   - Red/green indicator per gate

### Phase E: Token, Cost & Context (Lower Priority)
_Important for cost control but not for understanding agent behavior._

1. Parse `usage` fields from JSONL — token counters in StatusBar
2. Context pressure meter (% of 200k used)
3. Compaction event markers on Timeline
4. Per-session cost estimate
5. Burn rate indicator

### Phase F: Advanced Observability
_Differentiators — features nobody else has._

1. **Thinking block summaries** — collapsible reasoning trace per action
2. **Waterfall timing view** — horizontal duration bars, parallel agent spans
3. **Memory file tracking** — detect CLAUDE.md / agent-memory changes, show diffs
4. **Loop detection** — identify Ralph-style autonomous loops, show iteration count
5. **Cross-session context tracker** — what survived compaction? What was lost?
6. **Decision replay** — step through agent decisions with "what it saw" at each point

---

## 5. Data Sources Summary

| Data | Source | Availability |
|------|--------|-------------|
| Tool calls | JSONL `tool_use` blocks | Available now (transcript watcher) |
| Sub-agent spawning | JSONL `Task` tool_use + sub-agent JSONL files | Available (need to parse) |
| Token usage | JSONL `usage` field per message | Available (need to parse) |
| Compaction events | JSONL `system` type with `compact_boundary` subtype | Available (need to parse) |
| Thinking blocks | JSONL `thinking` content blocks | Available (need to parse) |
| Permission rules | `settings.json`, `.claude/settings.json` | Available (need to read) |
| MCP config | `settings.json` `mcpServers` field | Available (need to read) |
| Skills | `.claude/skills/`, `~/.claude/skills/` | Available (need to scan) |
| Hooks | `settings.json` `hooks` field | Available (need to read) |
| Pane visual state | tmux capture-pane (already wired) | Available |

---

## 6. Key Insight

The JSONL transcript is dramatically richer than what we currently extract. Each message contains:

```jsonc
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      { "type": "thinking", "thinking": "..." },           // Reasoning trace
      { "type": "text", "text": "..." },                    // Agent response
      { "type": "tool_use", "name": "Task", "input": {     // Sub-agent spawn
        "subagent_type": "Explore",
        "description": "Search for auth code",
        "prompt": "Find all authentication...",
        "model": "haiku"
      }},
      { "type": "tool_use", "name": "Edit", "input": {...}} // Tool call
    ],
    "usage": {                                               // Token costs
      "input_tokens": 45230,
      "output_tokens": 1847,
      "cache_creation_input_tokens": 12000,
      "cache_read_input_tokens": 33000
    },
    "model": "claude-sonnet-4-6-20250514"
  },
  "parentUuid": "abc-123",                                   // Conversation threading
  "sessionId": "session-456"
}
```

**We're currently only extracting tool_use blocks.** The thinking, text, usage, model, and threading data are all sitting there unused. Unlocking these fields is the single highest-leverage improvement we can make.

---

## References

### Official Documentation
- [Claude Code Sub-Agents Documentation](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Permissions Documentation](https://code.claude.com/docs/en/permissions)
- [Claude Code Cost Management](https://code.claude.com/docs/en/costs)
- [Claude Code MCP Integration](https://code.claude.com/docs/en/mcp)

### Community Resources
- [Awesome Claude Code](https://github.com/hesreallyhim/awesome-claude-code) — Curated list of 100+ Claude Code tools, skills, hooks, and workflows
- [Claude Code System Prompts](https://github.com/Piebald-AI/claude-code-system-prompts) — Full system prompt internals
- [ccusage](https://ccusage.com/guide/) — Token usage analysis from JSONL
- [ccflare](https://github.com/snipeship/ccflare) / [better-ccflare](https://github.com/tombii/better-ccflare/) — Web-based usage dashboards
- [Claude Squad](https://github.com/smtg-ai/claude-squad) — Multi-agent terminal manager
- [Auto-Claude](https://github.com/AndyMik90/Auto-Claude) — Autonomous multi-agent SDLC framework
- [crystal](https://github.com/stravu/crystal) — Desktop app for Claude Code orchestration (closest competitor)
- [AgentSys](https://github.com/avifenesh/agentsys) — Workflow automation with plugins, agents, skills
- [Claude Code Agents](https://github.com/undeadlist/claude-code-agents) — E2E dev workflow with sub-agent prompts
- [Ralph for Claude Code](https://github.com/frankbria/ralph-claude-code) — Autonomous loop framework
- [Claude Code Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) — Real-time token monitoring with ML predictions

### Observability Platforms
- [AgentPrism](https://github.com/evilmartians/agent-prism) — Open source React trace visualization
- [LangSmith Observability](https://www.langchain.com/langsmith/observability) — Hierarchical trace + cost tracking
- [AgentOps Dashboard](https://docs.agentops.ai/v1/usage/dashboard-info) — Multi-agent session waterfall
- [Datadog LLM Observability](https://www.datadoghq.com/blog/monitor-ai-agents/) — Unified agent monitoring

### Guides & Analysis
- [Mastering Agentic Coding in Claude](https://medium.com/@lmpo/mastering-agentic-coding-in-claude-a-guide-to-skills-sub-agents-slash-commands-and-mcp-servers-5c58e03d4a35)
- [Claude Code Multiple Agent Systems Guide](https://www.eesel.ai/blog/claude-code-multiple-agent-systems-complete-2026-guide)
- [AI Agent Observability Tools 2026](https://research.aimultiple.com/agentic-monitoring/)
- [Inside Claude Code: Session File Format](https://databunny.medium.com/inside-claude-code-the-session-file-format-and-how-to-inspect-it-b9998e66d56b)
- [Tracing Claude Code's LLM Traffic](https://medium.com/@georgesung/tracing-claude-codes-llm-traffic-agentic-loop-sub-agents-tool-use-prompts-7796941806f5)
