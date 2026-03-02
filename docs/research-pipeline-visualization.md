# Research: Processing Pipeline Visualization for Hudai

**Date:** 2026-02-23
**Context:** Adding a "Pipeline" view that visualizes the processing pipelines of whatever project the monitored agent is working on — using LLM-assisted detection with JSON caching.

---

## 1. The Vision

The existing views answer *spatial* questions (where are files, which directory is the agent in). The Pipeline view answers **flow questions:**

- What are this project's processing pipelines?
- How does data transform as it moves through the system?
- Which pipeline stage is the agent currently touching?

**This is not Hudai's own pipelines** — it's the pipelines of whatever project the agent is working on. But to make this concrete, we'll use Hudai itself as the example project throughout this doc.

---

## 2. Concrete Example: Hudai Analyzed as a Target Project

Imagine an agent is working on the Hudai codebase and Hudai is monitoring it. Here's exactly what the LLM pipeline analysis would produce, stored as `.hudai/pipeline-cache.json`:

### 2.1 The LLM Analysis Output

```json
{
  "version": 1,
  "generatedAt": 1740307200000,
  "projectRoot": "/home/user/Hudai",
  "fileMtimes": {
    "packages/server/src/pty/agent-process.ts": 1740300000000,
    "packages/server/src/parser/claude-code-parser.ts": 1740300000000,
    "packages/server/src/transcript/transcript-watcher.ts": 1740300000000,
    "packages/server/src/transcript/jsonl-to-avp.ts": 1740300000000,
    "packages/server/src/persistence/event-store.ts": 1740300000000,
    "packages/server/src/index.ts": 1740300000000,
    "packages/client/src/ws/ws-client.ts": 1740300000000,
    "packages/client/src/stores/event-store.ts": 1740300000000,
    "packages/client/src/stores/graph-store.ts": 1740300000000,
    "packages/client/src/stores/session-store.ts": 1740300000000,
    "packages/client/src/components/CodebaseMap/useForceGraph.ts": 1740300000000,
    "packages/client/src/components/CodebaseMap/MapRenderer.ts": 1740300000000
  },
  "pipelines": [
    {
      "id": "event-ingestion",
      "label": "Event Ingestion Pipeline",
      "category": "event-driven",
      "description": "Captures agent activity from two sources (tmux terminal polling and JSONL transcript files), translates raw data into structured AVP events, persists to SQLite, and broadcasts to connected clients via WebSocket.",
      "blocks": [
        {
          "id": "tmux-capture",
          "label": "tmux capture-pane",
          "description": "Polls the agent's terminal pane every 500ms via tmux capture-pane, uses anchor-based diff to detect new output lines",
          "files": ["packages/server/src/pty/agent-process.ts"],
          "technology": "tmux + Node.js child_process",
          "blockType": "source"
        },
        {
          "id": "transcript-watcher",
          "label": "JSONL Transcript Watcher",
          "description": "Watches Claude Code's ~/.claude/projects/ JSONL files via fs.watch + polling fallback. Reads new lines as they're appended.",
          "files": ["packages/server/src/transcript/transcript-watcher.ts"],
          "technology": "Node.js fs.watch",
          "blockType": "source"
        },
        {
          "id": "tmux-parser",
          "label": "Terminal Output Parser",
          "description": "Parses Claude Code's rendered terminal format — detects tool calls (⏺ Read, ⏺ Edit), thinking indicators, permission prompts, and user prompts (❯)",
          "files": ["packages/server/src/parser/claude-code-parser.ts"],
          "technology": "Regex state machine",
          "blockType": "transform"
        },
        {
          "id": "jsonl-translator",
          "label": "JSONL → AVP Translator",
          "description": "Translates Claude Code's internal JSONL entries (tool_use, thinking, tool_result blocks) into typed AVP events with deduplication",
          "files": ["packages/server/src/transcript/jsonl-to-avp.ts"],
          "technology": "JSON parsing + type mapping",
          "blockType": "transform"
        },
        {
          "id": "source-merge",
          "label": "Event Router",
          "description": "Both parsers emit 'event' via EventEmitter. When transcript watcher is active, tmux parser is bypassed (tmux only feeds PanePreview). handleEvent() in index.ts receives from whichever source is active.",
          "files": ["packages/server/src/index.ts"],
          "technology": "Node.js EventEmitter",
          "blockType": "merge"
        },
        {
          "id": "event-enrichment",
          "label": "Event Enrichment",
          "description": "Enriches events with: graph heat updates (file.read/edit), permission tracking, loop detection, memory file detection, sub-agent lifecycle tracking, token usage tracking, test result parsing",
          "files": [
            "packages/server/src/index.ts",
            "packages/server/src/parser/loop-detector.ts",
            "packages/server/src/config/permission-stats.ts",
            "packages/server/src/transcript/token-tracker.ts"
          ],
          "technology": "Fastify server",
          "blockType": "transform"
        },
        {
          "id": "sqlite-persist",
          "label": "SQLite Persistence",
          "description": "Every event is inserted into the events table. Sessions are tracked in a sessions table. Supports replay queries by time range.",
          "files": [
            "packages/server/src/persistence/event-store.ts",
            "packages/server/src/persistence/db.ts"
          ],
          "technology": "better-sqlite3",
          "blockType": "sink"
        },
        {
          "id": "ws-broadcast",
          "label": "WebSocket Broadcast",
          "description": "broadcast() serializes the event as JSON and sends to all connected client WebSocket connections",
          "files": ["packages/server/src/index.ts"],
          "technology": "@fastify/websocket",
          "blockType": "sink"
        }
      ],
      "edges": [
        { "source": "tmux-capture", "target": "tmux-parser", "label": "raw terminal lines (string)", "dataType": "string", "edgeType": "data" },
        { "source": "transcript-watcher", "target": "jsonl-translator", "label": "JSONL entries", "dataType": "JsonlEntry", "edgeType": "data" },
        { "source": "tmux-parser", "target": "source-merge", "label": "AVPEvent (tmux source)", "dataType": "AVPEvent", "edgeType": "data" },
        { "source": "jsonl-translator", "target": "source-merge", "label": "AVPEvent (transcript source)", "dataType": "AVPEvent", "edgeType": "data" },
        { "source": "source-merge", "target": "event-enrichment", "label": "AVPEvent", "dataType": "AVPEvent", "edgeType": "data" },
        { "source": "event-enrichment", "target": "sqlite-persist", "label": "enriched AVPEvent", "dataType": "AVPEvent", "edgeType": "data" },
        { "source": "event-enrichment", "target": "ws-broadcast", "label": "enriched AVPEvent + side-effect messages", "dataType": "ServerMessage", "edgeType": "data" }
      ]
    },
    {
      "id": "client-rendering",
      "label": "Client Rendering Pipeline",
      "category": "state-management",
      "description": "Receives server messages via WebSocket, dispatches to Zustand stores, and drives the Pixi.js/Canvas codebase map visualization with real-time heat, activity overlays, and force-directed layout.",
      "blocks": [
        {
          "id": "ws-client",
          "label": "WebSocket Client",
          "description": "Singleton WsClient connects to the Vite proxy at /ws. Auto-reconnects on disconnect. Dispatches parsed ServerMessage to registered handlers.",
          "files": ["packages/client/src/ws/ws-client.ts"],
          "technology": "Browser WebSocket",
          "blockType": "source"
        },
        {
          "id": "store-dispatch",
          "label": "Store Dispatcher",
          "description": "WsProvider's onMessage handler routes messages by kind: 'event' → eventStore + graphStore, 'graph.full' → graphStore, 'session.state' → sessionStore, etc.",
          "files": ["packages/client/src/ws/WsProvider.tsx"],
          "technology": "React context + Zustand",
          "blockType": "branch"
        },
        {
          "id": "event-store",
          "label": "Event Store",
          "description": "Append-only ring buffer (max 10K events). Feeds the Timeline component and BuildQueue.",
          "files": ["packages/client/src/stores/event-store.ts"],
          "technology": "Zustand",
          "blockType": "transform"
        },
        {
          "id": "graph-store",
          "label": "Graph Store",
          "description": "Holds CodebaseGraph (nodes + edges + architecture), manages heat decay, activity nodes, file indicators, session tracking, semantic zoom state. The central nervous system of the map.",
          "files": ["packages/client/src/stores/graph-store.ts"],
          "technology": "Zustand",
          "blockType": "transform"
        },
        {
          "id": "session-store",
          "label": "Session Store",
          "description": "Tracks session state: status, current file, breadcrumb, activity type. Drives the ResourceBar header.",
          "files": ["packages/client/src/stores/session-store.ts"],
          "technology": "Zustand",
          "blockType": "transform"
        },
        {
          "id": "force-layout",
          "label": "Force Layout Engine",
          "description": "D3-force simulation builds display graph from expanded/collapsed groups. Computes node positions with position caching for stability. Runs on requestAnimationFrame.",
          "files": [
            "packages/client/src/components/CodebaseMap/ForceLayout.ts",
            "packages/client/src/components/CodebaseMap/useForceGraph.ts"
          ],
          "technology": "D3-force simulation",
          "blockType": "transform"
        },
        {
          "id": "map-renderer",
          "label": "Canvas Map Renderer",
          "description": "Renders nodes (files, groups, containers), edges, heat glow, spotlight, activity rings, file indicators, trail, and relationship arrows on a Canvas2D element. Handles pan/zoom/click interaction.",
          "files": ["packages/client/src/components/CodebaseMap/MapRenderer.ts"],
          "technology": "Canvas2D",
          "blockType": "sink"
        },
        {
          "id": "timeline-render",
          "label": "Timeline Component",
          "description": "Horizontal timeline rendering events as color-coded dots. Shows event density over time.",
          "files": ["packages/client/src/components/Timeline/Timeline.tsx"],
          "technology": "React + Canvas",
          "blockType": "sink"
        }
      ],
      "edges": [
        { "source": "ws-client", "target": "store-dispatch", "label": "ServerMessage", "dataType": "ServerMessage", "edgeType": "data" },
        { "source": "store-dispatch", "target": "event-store", "label": "AVPEvent", "dataType": "AVPEvent", "edgeType": "data" },
        { "source": "store-dispatch", "target": "graph-store", "label": "graph.full / graph.update / event", "dataType": "ServerMessage", "edgeType": "data" },
        { "source": "store-dispatch", "target": "session-store", "label": "session.state", "dataType": "SessionState", "edgeType": "data" },
        { "source": "graph-store", "target": "force-layout", "label": "nodes, edges, expandedGroups, architecture", "dataType": "CodebaseGraph", "edgeType": "data" },
        { "source": "force-layout", "target": "map-renderer", "label": "positioned SimNode[], edges", "dataType": "SimNode[]", "edgeType": "data" },
        { "source": "event-store", "target": "timeline-render", "label": "AVPEvent[]", "dataType": "AVPEvent[]", "edgeType": "data" }
      ]
    },
    {
      "id": "steering-flow",
      "label": "Steering Command Flow",
      "category": "request-handling",
      "description": "User interactions in the frontend (clicking files, typing prompts, approving permissions) are translated into steering commands sent via WebSocket to the server, which forwards them as tmux send-keys to the agent's terminal.",
      "blocks": [
        {
          "id": "user-interaction",
          "label": "User Interaction",
          "description": "Map clicks (focus_file), prompt input (prompt), button clicks (approve/reject/pause/resume)",
          "files": [
            "packages/client/src/components/CodebaseMap/CodebaseMap.tsx",
            "packages/client/src/components/Steering/SteeringBar.tsx"
          ],
          "technology": "React event handlers",
          "blockType": "source"
        },
        {
          "id": "ws-send",
          "label": "WebSocket Send",
          "description": "wsClient.send() serializes SteeringCommand and sends to server",
          "files": ["packages/client/src/ws/ws-client.ts"],
          "technology": "Browser WebSocket",
          "blockType": "transform"
        },
        {
          "id": "command-handler",
          "label": "Command Handler",
          "description": "Routes SteeringCommand by type: focus_file → write file prompt, approve → write 'y', pause → Ctrl+C, etc.",
          "files": ["packages/server/src/ws/command-handler.ts"],
          "technology": "Fastify WebSocket",
          "blockType": "transform"
        },
        {
          "id": "tmux-send",
          "label": "tmux send-keys",
          "description": "AgentProcess.write() + sendEnter() forwards text to the agent's tmux pane via tmux send-keys",
          "files": ["packages/server/src/pty/agent-process.ts"],
          "technology": "tmux send-keys",
          "blockType": "sink"
        }
      ],
      "edges": [
        { "source": "user-interaction", "target": "ws-send", "label": "SteeringCommand", "dataType": "SteeringCommand", "edgeType": "data" },
        { "source": "ws-send", "target": "command-handler", "label": "ClientMessage { kind: 'command' }", "dataType": "ClientMessage", "edgeType": "data" },
        { "source": "command-handler", "target": "tmux-send", "label": "text + keystrokes", "dataType": "string", "edgeType": "data" }
      ]
    }
  ]
}
```

### 2.2 How This Gets Visualized

Here's what the user sees when they click the "Pipeline" toggle:

**Pipeline 1: Event Ingestion Pipeline** (selected by default — it's the longest)

```
┌──────────────────────┐    ┌──────────────────────┐
│ ● tmux capture-pane  │    │ ● JSONL Transcript    │
│   [tmux + Node.js]   │    │   Watcher             │
│   agent-process.ts   │    │   [Node.js fs.watch]  │
│                      │    │   transcript-watcher.ts│
└──────────┬───────────┘    └──────────┬────────────┘
           │ raw terminal               │ JsonlEntry
           │ lines                      │
           ▼                            ▼
┌──────────────────────┐    ┌──────────────────────┐
│ ◆ Terminal Output    │    │ ◆ JSONL → AVP        │
│   Parser             │    │   Translator          │
│   [Regex state       │    │   [JSON parsing]      │
│    machine]          │    │   jsonl-to-avp.ts     │
│   claude-code-       │    │                       │
│   parser.ts          │    │                       │
└──────────┬───────────┘    └──────────┬────────────┘
           │ AVPEvent                   │ AVPEvent
           │ (tmux)                     │ (transcript)
           └─────────┐    ┌────────────┘
                     ▼    ▼
              ┌──────────────────────┐
              │ ⊕ Event Router       │
              │   [EventEmitter]     │
              │   index.ts           │
              │   ⚡ Agent is here   │  ← spotlight
              └──────────┬───────────┘
                         │ AVPEvent
                         ▼
              ┌──────────────────────┐
              │ ◆ Event Enrichment   │
              │   [Fastify server]   │
              │   index.ts +         │
              │   loop-detector.ts + │
              │   permission-stats.ts│
              │   ▓▓▓▓▓░░░  12 ev/s │  ← heat bar
              └─────────┬──┬─────────┘
                        │  │
           ┌────────────┘  └────────────┐
           ▼                            ▼
┌──────────────────────┐    ┌──────────────────────┐
│ ▪ SQLite Persistence │    │ ▪ WebSocket Broadcast │
│   [better-sqlite3]   │    │   [@fastify/websocket]│
│   event-store.ts     │    │   index.ts            │
│   db.ts              │    │                       │
└──────────────────────┘    └──────────────────────┘
```

**Visual features active on this diagram:**

- **Block `event-enrichment` has a bright heat glow** — the agent just edited `index.ts`
- **Animated dots flow** from `tmux-capture` → `tmux-parser` → `source-merge` → `event-enrichment` → `ws-broadcast`
- **Spotlight pulse** on `source-merge` — agent's current file (`index.ts`) belongs to this block
- **Edge labels** show the data types: "raw terminal lines", "AVPEvent", "ServerMessage"
- **"R" indicator** on `tmux-parser` — agent just read `claude-code-parser.ts`

**Pipeline selector dropdown** (top-left of the pipeline view):
```
▾ Event Ingestion Pipeline
  Client Rendering Pipeline
  Steering Command Flow
```

---

## 3. LLM-Assisted Pipeline Detection

### 3.1 Why LLMs, Not Just Static Analysis

Pure static analysis (AST, regex, dependency-cruiser) detects **imports and call graphs** but can't understand **semantic pipeline structure:**

| What You Need | Static Analysis | LLM |
|---|---|---|
| Import edges (A imports B) | Easy (es-module-lexer — already in Hudai) | Overkill |
| "This is a middleware chain" | Brittle pattern matching | Natural |
| "Data flows X→Y via events" | No call edge to detect | Reasons about EventEmitter patterns |
| "These 5 files form an ETL pipeline" | No concept of "pipeline" | Groups by purpose |
| Naming a pipeline ("Auth Flow") | Impossible | Natural |

### 3.2 Detection Flow

```
Project Attached (server gets rootDir)
    │
    ├─ Check: .hudai/pipeline-cache.json exists?
    │   ├─ YES → Load, check file mtimes
    │   │   ├─ All fresh → Use cached pipelines (< 1ms)
    │   │   └─ Some stale → Incremental update (re-analyze affected pipelines only)
    │   └─ NO → Full analysis
    │
    ├─ Gather context for LLM:
    │   ├─ File tree (from directory-scanner.ts — already exists)
    │   ├─ Import graph (from import-parser.ts — already exists)
    │   ├─ Package.json deps (from detectTechnology — already exists)
    │   ├─ Key file excerpts (~50 lines each of entry points, routers, stores)
    │   └─ Architecture containers (from graph-builder.ts — already exists)
    │
    ├─ LLM call: "Identify processing pipelines..." → structured JSON
    │
    ├─ Validate + save → .hudai/pipeline-cache.json
    │
    └─ Broadcast: { kind: 'pipeline.full', pipelines }
```

### 3.3 LLM Prompt Design

```
You are analyzing a codebase to identify its processing pipelines —
sequences of steps where data transforms as it flows through the system.

## Project Context
- Root: {rootDir}
- Containers: {containers with technologies from graph-builder}
- File tree: {abbreviated, ~200 lines max}
- Import graph summary: {top cross-container import edges}
- Entry points: {files matching index.ts, main.ts, app.ts, server.ts}

## Key File Excerpts
{First ~50 lines of each entry point and key files}

## Task
Identify the major processing pipelines. For each pipeline:
1. Descriptive name
2. Stages (blocks) in order, with source file(s)
3. What data/type flows between stages
4. Branch points (one→many) and merge points (many→one)
5. Category: request-handling | data-processing | state-management |
             event-driven | build-ci | realtime | other

Return ONLY valid JSON matching this schema: { pipelines: PipelineDefinition[] }
```

### 3.4 Caching Strategy

**Goal:** Never re-analyze unless structure changes.

```typescript
interface PipelineCache {
  version: 1;
  generatedAt: number;
  projectRoot: string;
  fileMtimes: Record<string, number>;  // relativePath → mtime
  pipelines: PipelineDefinition[];
}
```

| Scenario | Action |
|---|---|
| First attach | Full LLM analysis → write cache |
| Re-attach, no changes | Load cache (< 1ms) |
| Re-attach, some files changed | Check if changed files appear in any block's `files[]`. Re-analyze only those pipelines. |
| Agent creates new file | Queue for next incremental. Show existing pipelines immediately. |
| User manually edits cache JSON | Respect it (manual override) |

**Staleness check — no LLM needed:**
```typescript
async function findStaleFiles(cache: PipelineCache, rootDir: string): Promise<string[]> {
  const stale: string[] = [];
  for (const [file, mtime] of Object.entries(cache.fileMtimes)) {
    try {
      const s = await stat(path.join(rootDir, file));
      if (s.mtimeMs > mtime) stale.push(file);
    } catch { stale.push(file); }
  }
  return stale;
}
```

### 3.5 Cost & Performance

Using Claude Haiku for analysis:
- **Full analysis:** ~$0.002 per project (~5K input tokens + ~2K output)
- **Incremental:** ~$0.001 (only affected pipeline + its file excerpts)
- **Latency:** ~2-4 seconds for full analysis (happens once, then cached)
- **Cache hit:** < 1ms

---

## 4. Visualization Approach

### 4.1 Library Choice: React Flow

**Primary reasons:**

1. **Hudai is React 19 + Vite.** React Flow integrates natively: `npm install @xyflow/react`
2. **Each pipeline block = custom React component.** Can embed heat glow, indicators, sparklines from Zustand stores.
3. **Animated edges built-in.** `animated: true` + custom SVG edge components for particle dots.
4. **Dagre layout** gives automatic left-to-right flow: `rankdir: 'LR'`
5. **1.15M weekly npm downloads**, MIT, actively maintained.
6. **Pipeline view is a separate component** — toggled alongside Full Map / Session / Journey / C4. Doesn't need to share canvas with force graph.

**Why not Pixi.js for this:**
- Pipeline diagrams have 5-20 blocks. DOM performance is fine.
- React components give rich content (text, badges, metrics) for free.
- The pipeline *data model* is renderer-agnostic — can swap to Pixi.js later.

### 4.2 Visual Design

**Block types and colors** (consistent with Hudai's dark theme):

| Block Type | Border Color | Icon | Meaning |
|---|---|---|---|
| `source` | `#3a7ca5` (blue) | `●` | Data enters |
| `transform` | `#47b881` (green) | `◆` | Data processed |
| `sink` | `#ec4c47` (red) | `▪` | Data exits / side effect |
| `branch` | `#f5a623` (amber) | `◇` | One input → many outputs |
| `merge` | `#7b61ff` (purple) | `⊕` | Many inputs → one output |

**Block anatomy:**
```
┌────────────────────────────────────┐
│ ● Block Label                      │  ← icon + name
│   [Technology Badge]               │  ← grey, smaller
│   source-file.ts                   │  ← clickable file link
│   other-file.ts                    │
│   ▓▓▓▓▓▓░░░░  42 events/s        │  ← live throughput (optional)
│   ⚡ Agent is here                 │  ← spotlight (when active)
└────────────────────────────────────┘
```

**Edge animation** (inspired by Netflix Vizceral):
- Small dots travel along edges from source to target
- Dot count proportional to event throughput
- Dot color = event category (blue=navigation, orange=mutation, green=execution, purple=reasoning)
- When idle: slow, sparse dots. When active: fast, dense dots.

### 4.3 Activity Layer on Pipeline Blocks

Every Hudai activity feature maps to pipeline blocks:

| Feature | On Pipeline Blocks |
|---|---|
| **Heat glow** | Block border brightens based on aggregate file heat |
| **Agent spotlight** | Pulsing glow on block containing agent's current file |
| **Indicator badges** | R/E/+/× when agent reads/edits/creates/deletes a block's file |
| **Failing tests** | Red glow on blocks whose files have failing tests |
| **Edge animation** | Particle flow speed/density reflects activity level |
| **Session filter** | Only show pipelines with session-touched files |

**How it works:** Pipeline blocks have a `files[]` array. When the agent touches a file:
```
Agent edits packages/server/src/index.ts
  → Find blocks where files[] includes "packages/server/src/index.ts"
  → Blocks "Event Router", "Event Enrichment", "WebSocket Broadcast" get heat + "E" indicator
  → Edges flowing through those blocks get particle bursts
  → Spotlight moves to "Event Router" (first matching block)
```

---

## 5. Concrete Walkthrough: Agent Debugging a Parser Bug

Here's a play-by-play of what the Pipeline view shows as an agent works on Hudai:

**Setup:** Agent is tasked with "Fix the permission prompt detection in the parser"

### Step 1: Agent reads claude-code-parser.ts

```
Pipeline: Event Ingestion Pipeline

Block "Terminal Output Parser" lights up:
  - Heat glow appears (orange border)
  - "R" badge appears (Read indicator)
  - Spotlight pulse: "⚡ Agent is here"

Edge from "tmux capture-pane" → "Terminal Output Parser":
  - Particles briefly accelerate (file was just accessed)
```

### Step 2: Agent reads index.ts to understand how events flow

```
Block "Event Router" lights up:
  - Heat glow + "R" badge
  - Spotlight moves from "Terminal Output Parser" to "Event Router"

Journey trail now shows:
  Terminal Output Parser → Event Router
  (highlighted edge between these blocks)
```

### Step 3: Agent edits claude-code-parser.ts (fixes the regex)

```
Block "Terminal Output Parser" flares bright:
  - Heat goes to max (orange→red border glow)
  - "E" badge replaces "R" (Edit indicator)
  - Spotlight returns here

All downstream edges pulse:
  Parser → Router → Enrichment → Broadcast
  (cascade of particles showing the fix will affect everything downstream)
```

### Step 4: Agent runs tests

```
No pipeline block lights up (tests aren't in any pipeline block).
But the floating activity nodes from the existing system appear:
  🧪 "Running Tests" activity bubble

If tests fail with a file in the pipeline:
  Block "Terminal Output Parser" gets red glow (failing test indicator)

If tests pass:
  All red glows clear
```

### Step 5: Agent switches to Pipeline 2 (client-side) to verify

```
User clicks pipeline selector → "Client Rendering Pipeline"

New diagram appears:
  WebSocket Client → Store Dispatcher → [Graph Store, Event Store, Session Store] → ...

Block "Graph Store" has residual heat from earlier (agent read graph-store.ts)
```

---

## 6. Data Model

### 6.1 New Types in `@hudai/shared`

```typescript
// packages/shared/src/pipeline-types.ts

export type PipelineCategory =
  | 'request-handling' | 'data-processing' | 'state-management'
  | 'event-driven' | 'build-ci' | 'realtime' | 'other';

export type PipelineBlockType = 'source' | 'transform' | 'sink' | 'branch' | 'merge';
export type PipelineEdgeType = 'data' | 'control' | 'error' | 'async';

export interface PipelineBlock {
  id: string;
  label: string;
  description?: string;
  files: string[];              // relative paths — links blocks to file nodes
  technology?: string;
  blockType: PipelineBlockType;
}

export interface PipelineEdge {
  source: string;               // block id
  target: string;               // block id
  label?: string;               // data type flowing through
  dataType?: string;
  edgeType: PipelineEdgeType;
}

export interface PipelineDefinition {
  id: string;
  label: string;
  category: PipelineCategory;
  description: string;
  blocks: PipelineBlock[];
  edges: PipelineEdge[];
}

export interface PipelineLayer {
  pipelines: PipelineDefinition[];
  generatedAt: number;
  analyzing?: boolean;          // show skeleton UI while LLM works
}
```

### 6.2 WebSocket Messages

```typescript
// Add to ServerMessage:
| { kind: 'pipeline.full'; pipelines: PipelineLayer }
| { kind: 'pipeline.update'; pipeline: PipelineDefinition }
| { kind: 'pipeline.analyzing'; progress: string }
```

### 6.3 MapMode Extension

```typescript
export type MapMode = 'full' | 'session' | 'journey' | 'architecture' | 'pipeline';
```

---

## 7. Implementation Phases

### Phase 1: Types + Demo Data (shared + server)
- Add pipeline types to `@hudai/shared`
- Add pipeline WS messages to `ServerMessage`
- Hardcode the Hudai example pipelines above as demo data in `graph-builder.ts`
- Wire into `index.ts` — send `pipeline.full` on attach
- **No LLM yet** — proves the visualization before adding detection

### Phase 2: React Flow UI (client)
- `npm install @xyflow/react dagre @types/dagre`
- New `PipelineView` component with custom block nodes + animated edges
- Add "Pipeline" toggle in `CodebaseMap.tsx`
- Add `pipelineLayer` to graph store
- Dark-theme styling
- Test with hardcoded demo

### Phase 3: Activity Integration (client)
- Connect `addActivity` to pipeline blocks via file→block lookup
- Heat glow, spotlight, indicators on blocks
- Particle animation on edges
- Pipeline journey trail
- Session filtering

### Phase 4: LLM Detection (server)
- Add `@anthropic-ai/sdk`
- New `PipelineAnalyzer` class with cache read/write/staleness
- Full analysis + incremental update
- API key from env or `.hudai/config.json`

### Phase 5: Cross-View Navigation
- Click block → focus file map on those files
- Click block → focus C4 on parent container
- Click file link → open in preview panel

---

## 8. Design Inspirations

| Source | What We Take |
|---|---|
| **Unreal Blueprints** | Execution flow (thin, white) vs data flow (colored). Active node highlights. |
| **Node-RED** | Click edge to see last message. Status badges on nodes. |
| **Netflix Vizceral** | Particle density = throughput. Color = health. |
| **GoJS SCADA** | Animated strokeDashOffset for "always flowing" pipes. |
| **Apache Airflow** | DAG view with running/success/failed states. |
