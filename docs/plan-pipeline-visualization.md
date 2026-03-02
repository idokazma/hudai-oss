# Implementation Plan: Pipeline Visualization

**Feature Branch:** `claude/research-c4-diagrams-oPUuL`
**Depends on:** Research doc (`research-pipeline-visualization.md`) + PRD (`prd-pipeline-visualization.md`)

---

## Phase 1: Shared Types + Demo Data

**Goal:** Data model + hardcoded demo so we can build the UI without needing LLM detection.

### Step 1.1: Pipeline types in `@hudai/shared`

**File:** `packages/shared/src/pipeline-types.ts` (new)

Create all pipeline types:
- `PipelineCategory`, `PipelineBlockType`, `PipelineEdgeType`
- `PipelineBlock`, `PipelineEdge`, `PipelineDefinition`, `PipelineLayer`

**File:** `packages/shared/src/index.ts`
- Export all pipeline types

### Step 1.2: WebSocket messages

**File:** `packages/shared/src/ws-messages.ts`

Add to `ServerMessage` union:
```typescript
| { kind: 'pipeline.full'; pipelines: PipelineLayer }
| { kind: 'pipeline.update'; pipeline: PipelineDefinition }
| { kind: 'pipeline.analyzing'; progress: string }
```

### Step 1.3: Demo pipeline data on server

**File:** `packages/server/src/pipeline/demo-pipelines.ts` (new)

Hardcode the 3 Hudai pipelines from the research doc as demo data. This is temporary — replaced by LLM detection in Phase 4.

**File:** `packages/server/src/index.ts`

In `attachToPane()`, after `broadcast({ kind: 'graph.full', graph })`:
```typescript
// Send demo pipeline data
const demoPipelines = getDemoPipelines();
broadcast({ kind: 'pipeline.full', pipelines: demoPipelines });
```

### Step 1.4: Build shared + verify

```bash
npm run build:shared
npm run build  # verify no type errors
```

**Estimated effort:** ~1 hour

---

## Phase 2: React Flow UI

**Goal:** Working pipeline view with layout, dark theme, toggleable via the map mode buttons.

### Step 2.1: Install dependencies

```bash
cd packages/client
npm install @xyflow/react dagre
npm install -D @types/dagre
```

### Step 2.2: Pipeline layout utility

**File:** `packages/client/src/components/PipelineView/pipeline-layout.ts` (new)

```typescript
export function layoutPipeline(
  pipeline: PipelineDefinition
): { nodes: Node[], edges: Edge[] }
```

- Uses dagre with `rankdir: 'LR'`, `ranksep: 100`, `nodesep: 50`
- Maps `PipelineBlock` → React Flow `Node` with position from dagre
- Maps `PipelineEdge` → React Flow `Edge` with type `'animatedFlow'`
- Node dimensions: `width: 280, height: 120` (adjustable based on content)

### Step 2.3: Pipeline block node component

**File:** `packages/client/src/components/PipelineView/PipelineBlockNode.tsx` (new)

Custom React Flow node showing:
- Block type icon + label (header)
- Technology badge (grey text)
- File list (clickable, truncated if >3 files)
- Heat glow via CSS box-shadow keyed to `data.heat`
- Spotlight indicator when `data.isSpotlight`
- Failing test indicator when `data.isFailing`
- Activity indicator badge (R/E/+/×)

### Step 2.4: Animated flow edge component

**File:** `packages/client/src/components/PipelineView/AnimatedFlowEdge.tsx` (new)

Custom React Flow edge with:
- Base path with dark stroke
- Particle dots traveling along the path (position = `lerp(source, target, t)`)
- Particle spawn rate proportional to `data.heat`
- Particle color based on event category
- Edge label at midpoint (data type)

For v1, can start with React Flow's built-in `animated: true` and add particle animation in Phase 3.

### Step 2.5: PipelineView main component

**File:** `packages/client/src/components/PipelineView/PipelineView.tsx` (new)

```typescript
export function PipelineView() {
  const pipelineLayer = useGraphStore(s => s.pipelineLayer);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Select first pipeline by default
  const pipeline = pipelineLayer?.pipelines.find(p => p.id === selectedId)
    ?? pipelineLayer?.pipelines[0] ?? null;

  const { nodes, edges } = useMemo(
    () => pipeline ? layoutPipeline(pipeline) : { nodes: [], edges: [] },
    [pipeline]
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {/* Pipeline selector */}
      {pipelineLayer && pipelineLayer.pipelines.length > 1 && (
        <select ...>{...}</select>
      )}
      {/* Analyzing indicator */}
      {pipelineLayer?.analyzing && <div>Analyzing pipelines...</div>}
      {/* React Flow */}
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
                 edgeTypes={edgeTypes} fitView>
        <Background color="#1a2035" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

### Step 2.6: Graph store extension

**File:** `packages/client/src/stores/graph-store.ts`

Add to `GraphStoreState`:
```typescript
pipelineLayer: PipelineLayer | null;
setPipelineLayer: (layer: PipelineLayer) => void;
updatePipeline: (pipeline: PipelineDefinition) => void;
```

Extend `MapMode`:
```typescript
export type MapMode = 'full' | 'session' | 'journey' | 'architecture' | 'pipeline';
```

### Step 2.7: WsProvider message handling

**File:** `packages/client/src/ws/WsProvider.tsx`

Add handler for `pipeline.full` and `pipeline.update` messages:
```typescript
case 'pipeline.full':
  graphStore.setPipelineLayer(msg.pipelines);
  break;
case 'pipeline.update':
  graphStore.updatePipeline(msg.pipeline);
  break;
```

### Step 2.8: CodebaseMap toggle

**File:** `packages/client/src/components/CodebaseMap/CodebaseMap.tsx`

Add "Pipeline" button alongside Full/Session/Journey/C4:
```typescript
<button onClick={() => setMapMode('pipeline')}
        style={toggleBtnStyle(mapMode === 'pipeline')}>
  Pipeline
</button>
```

Conditionally render PipelineView vs canvas:
```typescript
{mapMode === 'pipeline' ? (
  <PipelineView />
) : (
  <canvas ref={canvasRef} ... />
)}
```

### Step 2.9: Dark theme CSS

**File:** `packages/client/src/components/PipelineView/pipeline-styles.css` (new)

React Flow dark theme overrides + block styling:
- Background: `#0a0e17`
- Block backgrounds: `#0c1220`
- Block borders: color-coded by blockType
- Font: JetBrains Mono / system monospace
- File links: subtle blue, underline on hover

### Step 2.10: Build + verify

```bash
npm run build
```

**Estimated effort:** ~3-4 hours

---

## Phase 3: Activity Integration

**Goal:** Pipeline blocks respond to agent activity in real-time — heat, spotlight, indicators, edge animation.

### Step 3.1: File-to-block lookup hook

**File:** `packages/client/src/hooks/usePipelineActivity.ts` (new)

```typescript
export function usePipelineActivity(pipeline: PipelineDefinition | null) {
  // Build file→blockId map from pipeline.blocks[].files
  // Subscribe to graph store: fileIndicators, sessionTouchedFiles, failingFiles
  // Return enriched block data: { [blockId]: { heat, isSpotlight, indicator, isFailing } }
}
```

This maps each graph store change to the corresponding pipeline blocks, so `PipelineBlockNode` can display real-time overlays.

### Step 3.2: Heat aggregation on blocks

In `usePipelineActivity`:
- For each block, compute `heat = max(heat of all block.files in nodeMap)`
- Use existing `graph.nodes` heat values (already maintained by `decayHeat`)

### Step 3.3: Spotlight resolution

```typescript
const agentCurrentFile = useSessionStore(s => s.session.agentCurrentFile);
// Find which block owns the current file
const spotlightBlockId = pipeline.blocks.find(b =>
  b.files.some(f => agentCurrentFile?.endsWith(f))
)?.id;
```

### Step 3.4: File indicators on blocks

Map `fileIndicators` (from graph-store) to blocks:
```typescript
for (const [filePath, indicator] of fileIndicators) {
  const block = fileToBlock.get(filePath);
  if (block) blockIndicators.set(block.id, indicator);
}
```

### Step 3.5: Failing test markers

Map `failingFiles` to blocks:
```typescript
for (const file of failingFiles) {
  const block = fileToBlock.get(file);
  if (block) failingBlocks.add(block.id);
}
```

### Step 3.6: Edge heat for particle animation

In `PipelineView`, compute edge heat:
- An edge is "hot" if its source block is active
- Pass `data.heat` to `AnimatedFlowEdge`

### Step 3.7: Pipeline journey trail

Track ordered block visits in graph store:
```typescript
pipelineJourney: string[];  // block IDs in visit order
```

In `addActivity`, when a file is touched that maps to a pipeline block, append to journey. Render as highlighted edges in `PipelineView`.

### Step 3.8: Upgrade AnimatedFlowEdge

Replace basic `animated: true` with custom particle animation:
- Small SVG circles traveling along edge path
- Spawn rate proportional to `data.heat`
- Color based on most recent event category on the edge's source block

**Estimated effort:** ~2-3 hours

---

## Phase 4: LLM Pipeline Detection

**Goal:** Replace demo data with automatic detection via Claude Haiku.

### Step 4.1: Install Anthropic SDK

```bash
cd packages/server
npm install @anthropic-ai/sdk
```

### Step 4.2: Pipeline context gatherer

**File:** `packages/server/src/pipeline/pipeline-context.ts` (new)

```typescript
export async function gatherPipelineContext(
  rootDir: string,
  nodes: FileNode[],
  edges: DependencyEdge[],
  architecture: ArchitectureLayer,
): Promise<string>
```

Builds the LLM prompt context:
- Abbreviated file tree (~200 lines max)
- Import graph summary (cross-container edges)
- Architecture containers with technologies
- Key file excerpts (~50 lines each): entry points, routers, middleware files, store files
- Identifies entry points: files matching `index.ts`, `main.ts`, `app.ts`, `server.ts`, `App.tsx`

### Step 4.3: Pipeline cache manager

**File:** `packages/server/src/pipeline/pipeline-cache.ts` (new)

```typescript
export class PipelineCache {
  async load(rootDir: string): Promise<PipelineCacheData | null>
  async save(rootDir: string, cache: PipelineCacheData): Promise<void>
  async findStaleFiles(cache: PipelineCacheData, rootDir: string): Promise<string[]>
  findAffectedPipelines(cache: PipelineCacheData, staleFiles: string[]): PipelineDefinition[]
}
```

Reads/writes `.hudai/pipeline-cache.json`. Creates `.hudai/` directory if needed (already in `.gitignore`).

### Step 4.4: Pipeline analyzer

**File:** `packages/server/src/pipeline/pipeline-analyzer.ts` (new)

```typescript
export class PipelineAnalyzer extends EventEmitter {
  constructor(rootDir: string)

  async analyze(
    nodes: FileNode[],
    edges: DependencyEdge[],
    architecture: ArchitectureLayer,
  ): Promise<PipelineLayer>
  // Returns cached if fresh, triggers background re-analysis if stale

  private async fullAnalysis(...): Promise<PipelineDefinition[]>
  // Gather context → call LLM → validate JSON → save cache

  private async incrementalAnalysis(...): Promise<void>
  // Re-analyze only stale pipelines → merge into cache → emit 'update'
}
```

LLM call:
```typescript
const anthropic = new Anthropic();
const response = await anthropic.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 4096,
  messages: [{ role: 'user', content: prompt }],
});
```

### Step 4.5: API key configuration

Resolution order:
1. `process.env.ANTHROPIC_API_KEY`
2. `.hudai/config.json` → `{ "anthropicApiKey": "..." }`
3. If neither: `PipelineAnalyzer.analyze()` returns `{ pipelines: [], analyzing: false }` and logs a message

### Step 4.6: Wire into index.ts

Replace demo pipeline code:

```typescript
// In attachToPane(), after graphBuilder.build():
const pipelineAnalyzer = new PipelineAnalyzer(paneCwd);
pipelineAnalyzer.on('update', (pipeline) => {
  broadcast({ kind: 'pipeline.update', pipeline });
});

const pipelineLayer = await pipelineAnalyzer.analyze(
  graphBuilder.getGraph().nodes,
  graphBuilder.getGraph().edges,
  graphBuilder.getGraph().architecture!,
);
broadcast({ kind: 'pipeline.full', pipelines: pipelineLayer });
```

### Step 4.7: Remove demo data

Delete `packages/server/src/pipeline/demo-pipelines.ts`.

### Step 4.8: Test with real projects

Test on:
1. Hudai itself (should produce ~3 pipelines)
2. A simple Express app (should produce request-handling pipeline)
3. A React + Redux app (should produce state-management pipeline)

**Estimated effort:** ~3-4 hours

---

## Phase 5: Cross-View Navigation

**Goal:** Pipeline blocks link to file map and C4 views.

### Step 5.1: Block click → file map

In `PipelineBlockNode`, on click:
```typescript
onClick={() => {
  // Switch to full map mode
  setMapMode('full');
  // Expand the groups containing the block's files
  for (const file of block.files) {
    expandGroup(dirname(file));
  }
  // Set spotlight on first file
  setSpotlight(block.files[0]);
}
```

### Step 5.2: File link click → file preview

In `PipelineBlockNode`, clicking a file name:
```typescript
onFileClick={(file) => {
  // Request file content via WS
  wsClient.send({ kind: 'file.read', path: file });
  // Open file preview panel (existing RightPanel functionality)
}
```

### Step 5.3: Block click → C4 container

```typescript
// Find which architecture container owns this block's files
const container = architecture.containers.find(c =>
  block.files.some(f => c.groups.some(g => f.startsWith(g)))
);
if (container) {
  setMapMode('architecture');
  // Focus on container (set zoom to container level)
}
```

**Estimated effort:** ~1-2 hours

---

## File Summary

### New Files

| File | Package | Phase | Purpose |
|---|---|---|---|
| `shared/src/pipeline-types.ts` | shared | 1 | Pipeline data types |
| `server/src/pipeline/demo-pipelines.ts` | server | 1 | Temp demo data (deleted in Phase 4) |
| `server/src/pipeline/pipeline-analyzer.ts` | server | 4 | LLM analysis orchestrator |
| `server/src/pipeline/pipeline-context.ts` | server | 4 | LLM prompt context builder |
| `server/src/pipeline/pipeline-cache.ts` | server | 4 | Cache read/write/staleness |
| `client/src/components/PipelineView/PipelineView.tsx` | client | 2 | Main pipeline component |
| `client/src/components/PipelineView/PipelineBlockNode.tsx` | client | 2 | Custom block node |
| `client/src/components/PipelineView/AnimatedFlowEdge.tsx` | client | 2 | Animated edge |
| `client/src/components/PipelineView/pipeline-layout.ts` | client | 2 | Dagre layout wrapper |
| `client/src/components/PipelineView/pipeline-styles.css` | client | 2 | Dark theme CSS |
| `client/src/hooks/usePipelineActivity.ts` | client | 3 | Activity→block mapping |

### Modified Files

| File | Package | Phase | Changes |
|---|---|---|---|
| `shared/src/index.ts` | shared | 1 | Export pipeline types |
| `shared/src/ws-messages.ts` | shared | 1 | Add pipeline WS messages |
| `server/src/index.ts` | server | 1, 4 | Wire pipeline analysis into attach flow |
| `client/src/stores/graph-store.ts` | client | 2 | Add pipelineLayer, extend MapMode |
| `client/src/ws/WsProvider.tsx` | client | 2 | Handle pipeline.full/update messages |
| `client/src/components/CodebaseMap/CodebaseMap.tsx` | client | 2 | Add Pipeline toggle |

### Dependencies Added

| Package | Where | Phase |
|---|---|---|
| `@xyflow/react` | client | 2 |
| `dagre` + `@types/dagre` | client | 2 |
| `@anthropic-ai/sdk` | server | 4 |

---

## Total Estimated Effort

| Phase | Effort | Depends On |
|---|---|---|
| Phase 1: Types + Demo | ~1 hour | — |
| Phase 2: React Flow UI | ~3-4 hours | Phase 1 |
| Phase 3: Activity Integration | ~2-3 hours | Phase 2 |
| Phase 4: LLM Detection | ~3-4 hours | Phase 1 (independent of 2-3) |
| Phase 5: Cross-View Nav | ~1-2 hours | Phase 2-3 |
| **Total** | **~10-14 hours** | |

Phases 2-3 and Phase 4 can be developed in parallel (Phase 2-3 uses demo data; Phase 4 replaces it).
