# Research: C4-Inspired Semantic Zoom for Hudai Code Map

**Date:** 2026-02-22
**Context:** Merging the C4 model's hierarchical zoom philosophy with Hudai's existing real-time activity systems (heat, spatial consistency, agent tracking, activity overlays).

---

## 1. The C4 Model — What We're Taking From It

The [C4 model](https://c4model.com/) (by Simon Brown) structures software visualization into four zoom levels:

| Level | Name | What It Shows |
|-------|------|---------------|
| **C1** | System Context | Your system as a box, surrounded by users & external systems |
| **C2** | Container | High-level building blocks (apps, databases, queues) |
| **C3** | Component | Internals of one container (modules, services) |
| **C4** | Code | File/class level detail |

The core insight: **Google Maps for code** — each zoom level tells a complete story at that abstraction level. You never see "tiny dots" — you see meaningful shapes with labels.

**What we're borrowing:**
- Semantic zoom — different rendering at each zoom level, not just scaling
- Named containers with technology badges — "API Server [Fastify]" not just "packages/server"
- Typed relationships between containers — "WebSocket events," "imports types" not just lines
- Progressive disclosure — only show what's meaningful at the current zoom level

**What C4 doesn't have (but we already do):**
- Real-time heat & activity overlays
- Agent spotlight & movement trails
- Spatial consistency / position caching
- Force-directed organic layout
- Interactive expand/collapse
- Session-scoped filtering

These are **not limitations to overcome** — they're Hudai's unique contributions that we layer on top of C4's structure. Every C4 tool out there is static documentation. We're making it live.

---

## 2. What We Already Have (And How It Maps to C4)

Looking at the actual code, we're closer to C4 than it might seem:

### Existing Code → C4 Concept Mapping

| What We Have | Where | C4 Equivalent | Gap |
|---|---|---|---|
| `__group__` synthetic nodes | `ForceLayout.ts:140-159` | **C3 Components** — named module clusters | Need better labels + technology tags |
| `expandedGroups` + expand/collapse | `ForceLayout.ts:61-81` | **C4→C3 zoom** — drill into a component to see files | Already works; need to add C2→C3 level above it |
| Heat aggregation to parent groups | `useForceGraph.ts:188-206` | **Metric bubbling** — activity visible at every zoom level | Already works for heat, indicators, activity counts |
| `resolveToVisibleNode()` | `useForceGraph.ts:11-29` | **Visibility resolution** — collapsed items bubble to parent | Works perfectly, extends naturally to container level |
| Position caching across rebuilds | `useForceGraph.ts:53, 137-145` | **Spatial consistency** — things don't jump when you zoom | Already stable; containers inherit this |
| `DependencyEdge.type: 'import' \| 'directory'` | `graph-types.ts:17` | **Typed edges** | Need to add `'container'`, `'api'`, `'websocket'` etc. |
| `this.scale` in MapRenderer | `MapRenderer.ts:97` | **Zoom level tracking** | Tracked but not used for semantic rendering decisions |
| Group circle rendering | `MapRenderer.ts:470-478` | **Container rendering** | Currently circles; need rounded rectangles + labels at low zoom |

### The Key Insight

The expand/collapse system in `buildDisplayGraph()` is already a two-level semantic zoom:
- **Collapsed** = group node absorbs children (like a C2 container)
- **Expanded** = children visible, mother stays (like C3 components)

We just need to:
1. Add **one level above** (C2 containers that group directories)
2. Make the zoom level **drive** expand/collapse automatically (semantic zoom)
3. Change **rendering style** based on zoom (rectangles vs. circles vs. file dots)

---

## 3. The Integration: C4 Structure + Hudai Activity Layer

### 3.1 How Each Hudai Feature Works At Every Zoom Level

This is the core design: **every existing feature continues to work at every zoom level**, just rendered appropriately.

#### Heat

| Zoom Level | Heat Rendering |
|---|---|
| **C2 — Containers** (zoom < 0.3) | Container border glow: aggregate heat from all files inside. Brighter = more active. Uses existing `maxHeat` aggregation from `useForceGraph.ts:192-198` |
| **C3 — Modules** (zoom 0.3–0.7) | Group node glow: same as current behavior, heat bubbles up from collapsed children |
| **C4 — Files** (zoom > 0.7) | Per-file heat glow: current behavior unchanged (`MapRenderer.ts:398-406`) |

No new code needed for heat aggregation — `useForceGraph.ts` already walks descendants and takes `maxHeat`. We just render it differently on the container shape.

#### Agent Spotlight

| Zoom Level | Spotlight Rendering |
|---|---|
| **C2 — Containers** | Pulsing glow on the container the agent is inside. "Agent is in the Server." |
| **C3 — Modules** | Pulsing glow on the group node. "Agent is in the parser module." |
| **C4 — Files** | Current behavior: pulsing glow + agent dot above file node (`MapRenderer.ts:536-557`) |

`resolveToVisibleNode()` already handles this — it walks up the hierarchy to find the deepest visible ancestor. We just add containers as another level in that hierarchy.

#### Movement Trail

| Zoom Level | Trail Rendering |
|---|---|
| **C2 — Containers** | Trail connects containers the agent has visited. "Agent went Server → Client → Shared → Server" |
| **C3 — Modules** | Trail connects group nodes. Current behavior. |
| **C4 — Files** | Trail connects individual files. Current behavior. |

The trail resolution in `useForceGraph.ts:302-314` already resolves to visible nodes. Containers become another resolution target.

#### Activity Rings

| Zoom Level | Ring Rendering |
|---|---|
| **C2 — Containers** | Large segmented ring on container: aggregate reads/edits/shells/searches across all files |
| **C3 — Modules** | Current behavior on group nodes (already aggregated in `useForceGraph.ts:246-262`) |
| **C4 — Files** | Current behavior per file |

#### File Indicators (R/E/+/×/?)

| Zoom Level | Indicator Rendering |
|---|---|
| **C2 — Containers** | Badge on container showing the most recent action inside it |
| **C3 — Modules** | Current behavior — bubble to visible group |
| **C4 — Files** | Current behavior — badge on individual file |

Already implemented in `useForceGraph.ts:211-240`. Container level is just one more hop up.

#### Failing Files

| Zoom Level | Failure Rendering |
|---|---|
| **C2 — Containers** | Red glow/ring on container = "tests failing inside this container" |
| **C3 — Modules** | Red ring on group node (current behavior) |
| **C4 — Files** | Red pulsing ring on specific file (current behavior) |

Already resolved to visible nodes in `useForceGraph.ts:317-335`.

### 3.2 Spatial Consistency Across Zoom Levels

This is critical — things should not jump around when you zoom.

**Current position caching** (`useForceGraph.ts:53`): Already saves `{x, y}` per node ID across layout rebuilds.

**How containers stay stable:**
- Container position = centroid of its child group nodes' cached positions
- When you zoom in and a container "opens," its children are already positioned around it (because they were the force-layout nodes that determined the centroid)
- When you zoom out and children collapse into a container, the container appears at the centroid — no jump
- The D3-Force `groupCenters` map (`ForceLayout.ts:336-347`) already distributes groups in a circle. Containers naturally sit at the center of their group cluster.

**Smooth transitions:** Instead of snapping between zoom levels, cross-fade:
- Container rectangle alpha fades from 1.0 → 0.0 as zoom increases past threshold
- Child nodes alpha fade from 0.0 → 1.0 as they appear
- 0.1 zoom-unit transition window (e.g., 0.25–0.35 for C2→C3)

### 3.3 Typed Relationships Between Containers

Currently `DependencyEdge.type` is `'import' | 'directory'`. Extend to:

```typescript
type EdgeType = 'import' | 'directory' | 'container' | 'api' | 'websocket' | 'event' | 'types';
```

At C2 zoom level, draw relationship arrows between containers:
- Arrow with label: "WebSocket events" / "imports @hudai/shared" / "HTTP API"
- Arrow style varies by type (dashed for async/events, solid for sync/imports)
- Auto-detected from cross-package import analysis (already have import edges)

At C3/C4 zoom levels, these become the current edge lines.

---

## 4. Data Model Changes

### 4.1 Shared Types — `graph-types.ts`

```typescript
// --- NEW: Container layer ---

interface Container {
  id: string;                    // e.g., "server", "client", "shared"
  label: string;                 // "API Server", "React Frontend"
  description?: string;          // "Fastify + WebSocket backend"
  technology?: string;           // "Node.js / Fastify 5"
  groups: string[];              // directory paths this container owns
  color?: number;                // override group palette color
}

interface ContainerRelationship {
  source: string;                // container id
  target: string;                // container id
  label: string;                 // "WebSocket events"
  type: EdgeType;                // 'websocket', 'import', 'api', etc.
}

interface ArchitectureLayer {
  containers: Container[];
  relationships: ContainerRelationship[];
}

// --- MODIFIED: Add to CodebaseGraph ---

interface CodebaseGraph {
  nodes: FileNode[];
  edges: DependencyEdge[];
  architecture?: ArchitectureLayer;   // NEW: optional container overlay
}

// --- MODIFIED: Extend DependencyEdge ---

interface DependencyEdge {
  source: string;
  target: string;
  type: 'import' | 'directory' | 'container' | 'api' | 'websocket' | 'event' | 'types';
}
```

### 4.2 Graph Store — New State

```typescript
// In graph-store.ts, add to GraphStoreState:

/** Current zoom level from MapRenderer (0.1–5.0) */
zoomLevel: number;

/** Which semantic zoom tier we're at */
semanticZoom: 'container' | 'module' | 'file';

/** Architecture overlay */
architecture: ArchitectureLayer | null;
```

The `semanticZoom` tier is derived from `zoomLevel`:
- `< 0.3` → `'container'` (C2)
- `0.3 – 0.7` → `'module'` (C3)
- `> 0.7` → `'file'` (C4)

### 4.3 Auto-Detection (Server Side — `graph-builder.ts`)

For zero-config, auto-detect containers from project structure:

```
packages/*/      → one container per package (label from package.json name)
src/             → single "Source" container for non-monorepo projects
apps/*/          → one container per app (Nx/Turborepo convention)
services/*/      → one container per service (microservice convention)
```

Read technology from `package.json` dependencies:
- Has `react` → "React Frontend"
- Has `fastify` or `express` → "API Server"
- Has `better-sqlite3` or `pg` → "Database Layer"
- Pure types, no runtime deps → "Shared Types"

Allow manual override via `.hudai/architecture.json` for custom layouts.

---

## 5. Rendering Changes — `MapRenderer.ts`

### 5.1 Zoom-Aware `render()` Method

The main `render()` method (`MapRenderer.ts:347`) currently draws everything the same way regardless of zoom. Add zoom-tier branching:

```typescript
private render() {
  const zoomTier = this.getSemanticZoomTier(); // uses this.scale

  // Always draw edges (style varies by tier)
  this.renderEdges(zoomTier);

  for (const node of this.currentNodes) {
    if (node.isContainerNode) {
      this.renderContainer(node, zoomTier);
    } else if (node.isGroupNode) {
      this.renderGroup(node, zoomTier);
    } else {
      this.renderFile(node, zoomTier);
    }
  }
}
```

### 5.2 Container Rendering at C2 Zoom

At low zoom, containers render as C4-style rounded rectangles:

```
┌─────────────────────────────┐
│  🖥 API Server              │    ← label + icon
│  [Node.js / Fastify 5]     │    ← technology badge
│                             │
│  ████░░░░  23 files         │    ← aggregate heat bar + file count
│  3 modified, 12 visited     │    ← aggregate stats
│                             │
│  ● Agent is here            │    ← spotlight (if agent is in this container)
└─────────────────────────────┘
```

Visual properties on the container:
- **Border color** = heat-based (same glow logic as current node heat)
- **Border width** = scales with aggregate activity
- **Background** = very dark fill (#0a0e17 base + slight color tint)
- **Activity ring** = drawn around the rectangle perimeter (same segmented arc logic)
- **Spotlight** = pulsing glow on the container border

### 5.3 Transition Animation (C2 → C3)

When zooming from container level to module level:

```
zoom 0.25:  Full container rectangle, children invisible
zoom 0.28:  Container rectangle starts fading (alpha 0.8)
zoom 0.30:  Container fades to dashed outline, child group nodes start appearing (alpha 0.3)
zoom 0.35:  Container is just a subtle boundary region, children fully visible
zoom 0.40+: Container outline barely visible, full module view
```

This uses the existing Pixi.js alpha system — no new animation framework needed.

---

## 6. Force Layout Changes — `ForceLayout.ts`

### 6.1 Container Nodes in the Simulation

Add container synthetic nodes alongside group synthetic nodes:

```typescript
// In buildDisplayGraph(), add container-level nodes:

for (const container of architecture.containers) {
  const containerId = `__container__${container.id}`;
  displayNodes.push({
    id: containerId,
    label: container.label,
    group: '.',                    // top-level
    isContainerNode: true,
    childGroups: container.groups, // which groups belong to this container
    // ... aggregate stats
  });
}
```

### 6.2 Zoom-Driven Expand/Collapse

Currently expand/collapse is driven by double-click (`toggleGroup`). Add zoom-driven auto-expand:

```typescript
// In useForceGraph.ts, react to zoomLevel changes:

useEffect(() => {
  const tier = getSemanticZoomTier(zoomLevel);

  if (tier === 'container') {
    // Collapse everything into containers
    setExpandedGroups(new Set());
  } else if (tier === 'module') {
    // Expand containers to show top-level groups
    const topGroups = new Set(architecture.containers.flatMap(c => c.groups));
    setExpandedGroups(topGroups);
  } else {
    // Keep user's manual expand/collapse choices
    // (don't auto-expand everything — let them explore)
  }
}, [zoomLevel]);
```

This means the existing `buildDisplayGraph()` and its collapse/expand logic continues to work — we're just automating the trigger.

### 6.3 Position Stability

Container position = centroid of its child groups' cached positions:

```typescript
// When building container node initial position:
const childPositions = container.groups
  .map(g => positionCache.get(`__group__${g}`))
  .filter(Boolean);

const containerX = childPositions.reduce((sum, p) => sum + p.x, 0) / childPositions.length;
const containerY = childPositions.reduce((sum, p) => sum + p.y, 0) / childPositions.length;
```

When children appear (zoom in), they start at the container's position and spread out — the container's position was their centroid, so they don't fly in from offscreen.

---

## 7. What This Gets Us

### Before vs. After

| Scenario | Before | After |
|---|---|---|
| **Zoomed all the way out** | Tiny dots, incomprehensible | 3-4 labeled containers: "Server [Fastify]" ← WebSocket → "Client [React]" ← imports → "Shared [Types]" |
| **"Where is the agent?"** | Find the small pulsing dot somewhere in the graph | Container glows: "Agent is in the Server." Zoom in → module level → file level |
| **"What's active?"** | Scan for heat glows across dozens of nodes | Container heat bars: "Server is hot, Client is cold, Shared was touched briefly" |
| **"What talks to what?"** | Follow import edge lines through a tangle | Labeled arrows: "WebSocket events," "imports @hudai/shared" |
| **New user sees the map** | "What are all these dots?" | "Oh, it's a server, a client, and shared types. I get it." |

### Glance-to-Understanding Time

- **C2 level:** < 1 second — see 3-4 containers, know where activity is
- **C3 level:** < 3 seconds — see module clusters, know what the agent is working on
- **C4 level:** 3-5 seconds — full file-level detail (current behavior)

This meets the design north star ("< 3 seconds") for the first time at the zoomed-out view.

---

## 8. Implementation Phases

### Phase 1: Data Model + Auto-Detection (shared + server)
- Add `Container`, `ContainerRelationship`, `ArchitectureLayer` to `graph-types.ts`
- Add auto-detection logic to `graph-builder.ts` (scan package.json files)
- Add `architecture` field to `CodebaseGraph`
- **No rendering changes yet** — just the data flowing through

### Phase 2: Zoom-Level Awareness (client — MapRenderer)
- Track `this.scale` changes and expose current semantic zoom tier
- Add `getSemanticZoomTier()` to MapRenderer
- Wire zoom tier into graph store so other components can react to it
- **Rendering still unchanged** — just the infrastructure

### Phase 3: Container Rendering (client — MapRenderer)
- Add `renderContainer()` method: rounded rectangles with labels, tech badges, aggregate stats
- Add container nodes to `buildDisplayGraph()` and the force simulation
- Implement zoom-tier branching in `render()`
- Add cross-fade transitions between tiers

### Phase 4: Activity Layer on Containers
- Extend heat glow rendering to container rectangles
- Extend spotlight to container level
- Extend trail resolution to container level
- Extend activity rings to container perimeter
- Extend failing-file markers to container level
- All using existing aggregation code — just different rendering targets

### Phase 5: Typed Relationships
- Extend `DependencyEdge.type` with new types
- Parse cross-package imports to detect relationship types
- Render labeled arrows between containers at C2 zoom
- Fade to simple edge lines at C3/C4 zoom

---

## 9. References

| Resource | Relevance |
|---|---|
| [C4 Model](https://c4model.com/) | Structural philosophy — zoom levels, containers, relationships |
| [IcePanel — Zoomable Architecture Diagrams](https://icepanel.medium.com/how-to-create-interactive-zoomable-software-architecture-diagrams-6724f1d087ac) | UX reference for smooth zoom transitions between C4 levels |
| [Structurizr](https://structurizr.com/) | Reference for container visual style and relationship notation |
| [ExplorViz — Semantic Zoom Research](https://arxiv.org/html/2510.00003v1) | Academic validation: semantic zoom + mini-map improves readability (user study) |
| [GraphAware D3+Pixi LOD](https://graphaware.com/blog/scale-up-your-d3-graph-visualisation-webgl-canvas-with-pixi-js/) | Technical reference for implementing LOD in Pixi.js (culling, bitmap text, texture reuse) |
| [LikeC4](https://likec4.dev/) | Visual style reference for container shapes (not for runtime use) |
| [pixi-graph](https://github.com/zakjan/pixi-graph) | Code patterns for Pixi.js graph rendering with Graphology |
