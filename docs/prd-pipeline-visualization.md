# PRD: Pipeline Visualization View

**Author:** Claude (AI-assisted)
**Date:** 2026-02-23
**Status:** Draft
**Feature Branch:** `claude/research-c4-diagrams-oPUuL`

---

## 1. Problem Statement

Hudai's existing map views (Full Map, Session, Journey, C4 Architecture) all visualize **files and directories** — the spatial structure of code. But when an operator watches an agent work, they often need to understand **how data flows through the system** — the processing pipelines.

Today, an operator sees: *"The agent is editing `claude-code-parser.ts`."*
They should see: *"The agent is editing the Terminal Parser — stage 3 of the Event Ingestion Pipeline, between tmux capture and the event router."*

This requires a new view: **Pipeline** — showing the logical processing pipelines of the target project, with real-time activity overlays.

## 2. User Stories

| # | As a... | I want to... | So that... |
|---|---|---|---|
| 1 | Hudai operator | see the processing pipelines of the project the agent is working on | I understand the system's data flow at a glance |
| 2 | Hudai operator | see which pipeline stage the agent is currently in | I know what part of the data flow is being changed |
| 3 | Hudai operator | see data flowing through pipeline edges in real-time | I can visually confirm the system's activity level |
| 4 | Hudai operator | toggle between File Map, C4, and Pipeline views | I can switch between spatial and logical perspectives |
| 5 | Hudai operator | click a pipeline block to jump to its files in the map | I can drill from logical view to spatial view seamlessly |
| 6 | Hudai operator | NOT wait for pipeline analysis every time I attach | caching makes it instant on repeat visits |
| 7 | Hudai operator | see pipelines detected automatically without configuration | it works out of the box on any project |

## 3. Solution Overview

### 3.1 LLM-Assisted Pipeline Detection

When Hudai attaches to a project, the server:
1. Checks for a cached pipeline analysis (`.hudai/pipeline-cache.json`)
2. If no cache (or stale), calls an LLM (Claude Haiku) with the project's file tree, import graph, and key file excerpts
3. The LLM returns structured JSON describing the project's pipelines — blocks, edges, data types
4. Result is cached. Only re-analyzed when source files change.

**Why LLM, not AST:** Static analysis finds imports; LLMs understand that "these 5 files form a request-handling pipeline" and can name it "Auth Flow." This produces human-readable labels and meaningful pipeline groupings without framework-specific parser plugins.

### 3.2 React Flow Visualization

The client renders pipelines using React Flow:
- Each pipeline block is a custom React component with heat glow, status badges, file links
- Edges show animated particles representing data flow
- Dagre layout engine positions blocks in left-to-right flow
- Dark theme consistent with existing HUD

### 3.3 Activity Layer Integration

Pipeline blocks are linked to files via `files[]`. When the agent touches a file:
- The corresponding pipeline block gets heat + indicator badges
- Edges flowing through that block get particle acceleration
- Agent spotlight moves to the active block
- Journey trail shows the traversal path through the pipeline

## 4. Scope

### In Scope (v1)

- [ ] Pipeline data types in `@hudai/shared`
- [ ] Server-side `PipelineAnalyzer` with LLM detection + JSON caching
- [ ] `.hudai/pipeline-cache.json` — read/write/staleness checking
- [ ] `pipeline.full`, `pipeline.update` WebSocket messages
- [ ] React Flow `PipelineView` component
- [ ] Custom block node component (label, tech badge, files, heat, spotlight, indicators)
- [ ] Custom animated edge component (particle dots)
- [ ] Dagre left-to-right layout
- [ ] "Pipeline" toggle in `CodebaseMap.tsx` (alongside Full/Session/Journey/C4)
- [ ] Pipeline selector dropdown (when multiple pipelines)
- [ ] Activity integration: heat, spotlight, indicators, edge animation
- [ ] Pipeline journey trail (ordered block visits)
- [ ] Dark theme styling

### In Scope (v2 — follow-up)

- [ ] Click block → focus file map on block's files
- [ ] Click block → focus C4 on parent container
- [ ] Click file link → open in file preview panel
- [ ] Session-filtered pipelines (only show blocks with touched files)
- [ ] Pipeline minimap inside blocks (sparkline of events/sec)
- [ ] Edge click → inspect last event that flowed through
- [ ] Manual pipeline editing via `.hudai/pipeline-cache.json`

### Out of Scope

- Real-time pipeline topology changes (pipelines are structural, not dynamic)
- Pipeline execution engine (we visualize, not execute)
- Non-JS/TS project support (future consideration)
- Pixi.js renderer for pipelines (React Flow is sufficient for 5-20 blocks)

## 5. Technical Design

### 5.1 Data Types

```typescript
// @hudai/shared — pipeline-types.ts

export type PipelineCategory =
  | 'request-handling' | 'data-processing' | 'state-management'
  | 'event-driven' | 'build-ci' | 'realtime' | 'other';

export type PipelineBlockType = 'source' | 'transform' | 'sink' | 'branch' | 'merge';
export type PipelineEdgeType = 'data' | 'control' | 'error' | 'async';

export interface PipelineBlock {
  id: string;
  label: string;
  description?: string;
  files: string[];
  technology?: string;
  blockType: PipelineBlockType;
}

export interface PipelineEdge {
  source: string;
  target: string;
  label?: string;
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
  analyzing?: boolean;
}
```

### 5.2 Server Architecture

```
index.ts (attachToPane)
  ├─ graphBuilder.build()        ← already exists
  ├─ pipelineAnalyzer.analyze()  ← NEW
  │   ├─ loadCache()
  │   ├─ checkStaleness()
  │   ├─ [fullAnalysis() | reanalyzeStale()]
  │   │   ├─ gatherContext()     ← uses graphBuilder data
  │   │   ├─ callLLM()           ← Anthropic SDK
  │   │   └─ saveCache()
  │   └─ return PipelineLayer
  └─ broadcast({ kind: 'pipeline.full', pipelines })
```

New files:
- `packages/server/src/pipeline/pipeline-analyzer.ts` — orchestrator
- `packages/server/src/pipeline/pipeline-context.ts` — context gathering for LLM prompt
- `packages/server/src/pipeline/pipeline-cache.ts` — cache read/write/staleness

### 5.3 Client Architecture

```
CodebaseMap.tsx
  ├─ mapMode === 'pipeline'
  │   └─ <PipelineView />
  │       ├─ useGraphStore(s => s.pipelineLayer)
  │       ├─ useGraphStore(s => s.fileIndicators)
  │       ├─ usePipelineActivity()          ← maps file activity to blocks
  │       ├─ layoutPipeline() via dagre
  │       └─ <ReactFlow>
  │           ├─ nodeTypes: { pipelineBlock: PipelineBlockNode }
  │           ├─ edgeTypes: { animatedFlow: AnimatedFlowEdge }
  │           └─ <Background />, <Controls />
  └─ mapMode !== 'pipeline'
      └─ <canvas ref={canvasRef} />         ← existing force graph
```

New files:
- `packages/client/src/components/PipelineView/PipelineView.tsx`
- `packages/client/src/components/PipelineView/PipelineBlockNode.tsx`
- `packages/client/src/components/PipelineView/AnimatedFlowEdge.tsx`
- `packages/client/src/components/PipelineView/pipeline-layout.ts`
- `packages/client/src/hooks/usePipelineActivity.ts`

### 5.4 WebSocket Protocol

New messages added to `ServerMessage`:

```typescript
| { kind: 'pipeline.full'; pipelines: PipelineLayer }
| { kind: 'pipeline.update'; pipeline: PipelineDefinition }
| { kind: 'pipeline.analyzing'; progress: string }
```

No new `ClientMessage` needed — pipelines are server-initiated.

### 5.5 Caching

Location: `{projectRoot}/.hudai/pipeline-cache.json`

```typescript
interface PipelineCache {
  version: 1;
  generatedAt: number;
  projectRoot: string;
  fileMtimes: Record<string, number>;
  pipelines: PipelineDefinition[];
}
```

Staleness: compare stored `fileMtimes` against current `stat()` results. Only re-analyze pipelines whose blocks reference changed files.

### 5.6 LLM Configuration

API key resolution (in order):
1. `ANTHROPIC_API_KEY` environment variable
2. `.hudai/config.json` → `{ "anthropicApiKey": "sk-..." }`
3. If neither: skip LLM analysis, show "Pipeline detection requires an API key" message

Model: **Claude Haiku** (claude-haiku-4-5-20251001) — fast, cheap, sufficient for structured code analysis.

## 6. Dependencies

### New npm Packages

| Package | Version | Purpose | Size |
|---|---|---|---|
| `@xyflow/react` | ^12 | React Flow pipeline rendering | ~200KB |
| `dagre` | ^0.8 | Hierarchical graph layout | ~30KB |
| `@types/dagre` | ^0.7 | TypeScript types for dagre | dev only |
| `@anthropic-ai/sdk` | ^0.39 | LLM calls for pipeline detection | ~50KB |

### Existing Infrastructure Used

- `directory-scanner.ts` → file tree for LLM context
- `import-parser.ts` → import graph for LLM context
- `graph-builder.ts` → architecture containers for LLM context
- `graph-store.ts` → heat, indicators, session tracking → activity on blocks
- `ws-messages.ts` → extended with pipeline messages
- `CodebaseMap.tsx` → toggle button integration

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM produces incorrect pipeline structure | Medium | Low | Cache is editable; user can manually fix. Show "AI-detected" label. |
| LLM analysis is slow (>5s) | Low | Medium | Show skeleton UI immediately. Cache aggressively. Use Haiku (fastest). |
| No API key configured | Medium | Medium | Graceful degradation: show message. Allow manual `pipeline-cache.json`. |
| React Flow conflicts with existing styles | Low | Low | Scoped CSS. React Flow supports full dark theme customization. |
| Too many pipelines overwhelm the UI | Low | Low | Pipeline selector dropdown. Default to largest pipeline. |

## 8. Success Metrics

| Metric | Target |
|---|---|
| Pipeline detection time (cold) | < 5 seconds |
| Pipeline detection time (cached) | < 100ms |
| Pipeline view render time | < 500ms |
| Glance-to-understanding (which stage is active) | < 2 seconds |
| Block heat update latency after file event | < 100ms |

## 9. Open Questions

1. **Should we support non-JS/TS projects?** The LLM can analyze any language, but import-parser only handles JS/TS. File tree alone may suffice for other languages.
2. **Should users be able to create pipelines manually?** Writing `pipeline-cache.json` by hand works, but a UI editor would be nicer (v2+).
3. **Should pipeline analysis happen on first attach or be opt-in?** First attach means potential delay; opt-in means the user has to know about it. Recommendation: auto-analyze but don't block — show file map immediately, pipeline appears when ready.
