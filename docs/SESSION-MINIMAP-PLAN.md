# Session Minimap & Action Heatmap Plan

## Context

Analysis of 13 Claude Code sessions from the apexChatbot project reveals clear patterns:

**Tool frequency (ranked):**
1. **Bash** (~50-160/session) — git ops, testing, process management
2. **Read** (~30-214/session) — file inspection before edits
3. **Edit** (~5-71/session) — iterative modifications
4. **Write** (~2-66/session) — new files, bulk rewrites
5. **Grep/Glob** (~5-13/session) — code search, file discovery
6. **Task tools** (~15-30/session) — orchestration

**File hotspots:** A few core files get touched repeatedly (`pipeline.py`, `settings.py`, `hybrid_search.py`, `graph.py`). Sessions cluster into types: exploration-heavy (200+ reads), refactoring (60+ writes), debugging (160+ bash).

**Action sequences:**
- Explore: `Bash → Read → Grep → Glob → Bash`
- Refactor: `Read → Edit/Write → Grep → Bash(test) → Bash(git)`
- Feature: `TaskCreate → Read → Write → Edit → Bash(test) → TaskUpdate`

## Goal

Two features:
1. **Live session map** — a filtered view of the codemap showing only nodes the agent has touched this session
2. **Richer action indicators** — show tool type and frequency on nodes, not just read/edit badges

---

## Feature 1: Session Minimap Toggle

### Current State
- `graph-store.ts` tracks `visited` and `modified` flags per file node
- `event-store.ts` has full event history (max 10,000)
- `buildDisplayGraph()` in `ForceLayout.ts` already handles node filtering via `expandedGroups`
- Map toggle UI pattern exists (size mode buttons in `CodebaseMap.tsx`)

### Design

Add a `mapMode: 'full' | 'session'` toggle. In session mode, only show nodes the agent has interacted with + their ancestor groups.

**graph-store.ts changes:**
```
+ mapMode: 'full' | 'session'
+ sessionTouchedFiles: Set<string>   // populated from events
+ setMapMode: (mode) => void
```

- On every `addActivity(event)`, add the file path to `sessionTouchedFiles`
- On session reset (`setGraph`), clear `sessionTouchedFiles`
- Include search result files (`search.grep`, `search.glob` → `data.files[]`)
- Include bash-related files when detectable (e.g., test file paths from `test.result`)

**ForceLayout.ts changes:**

Add an optional `nodeFilter` predicate to `buildDisplayGraph()`:
```typescript
export function buildDisplayGraph(
  allNodes: FileNode[],
  allEdges: DependencyEdge[],
  expandedGroups: Set<string>,
  nodeFilter?: (node: FileNode) => boolean,  // NEW
)
```

When `nodeFilter` is provided:
1. Pre-filter `allNodes` to only those passing the filter
2. Auto-expand groups that contain filtered nodes (so they're visible)
3. Prune edges to only connect visible nodes
4. Keep group nodes that have ANY descendant in the filtered set

**useForceGraph.ts changes:**

In the `displayGraph` memo:
- Read `mapMode` and `sessionTouchedFiles` from graph store
- When `mapMode === 'session'`, pass a filter: `(node) => sessionTouchedFiles.has(node.id)`
- Include in `structureKey` so layout rebuilds on mode change

**CodebaseMap.tsx changes:**

Add toggle buttons next to the existing size mode toggle:
```
[Full Map] [Session Map]
```
- Session map button shows count: `Session (14 files)`
- Disabled when `sessionTouchedFiles.size === 0`

### Layout Behavior in Session Mode

- Fewer nodes → force layout uses more space per node
- Auto-expand all groups containing session files (user doesn't need to manually drill down)
- Edges only between session-touched nodes (clearer dependency view)
- Group nodes appear only if they contain 2+ touched files (skip single-file groups)

---

## Feature 2: Richer Action Indicators on Nodes

### Current State

File indicators show a single badge (R/E/+/×/?) that fades after 4 seconds. This misses:
- **Cumulative activity** — how many times was this file touched?
- **Tool diversity** — was it just read, or read+edited+tested?
- **Bash/git activity** — non-file actions near relevant nodes

### Design

Replace the single-badge system with a **heat ring** that encodes cumulative session activity.

**graph-store.ts — new per-file tracking:**
```
+ fileActivityCounts: Map<string, { reads: number, edits: number, shells: number, searches: number }>
```

Incremented on each event (not decayed). Reset on session change.

**MapRenderer.ts — activity ring rendering:**

Instead of a single indicator dot, draw a thin segmented ring around active nodes:
- **Blue segment** — reads (proportional to read count)
- **Orange segment** — edits
- **Yellow segment** — bash/shell (when file is in a test or build command)
- **Teal segment** — searches

Ring thickness proportional to total activity count (min 1px, max 4px).

For the **current indicator** (most recent action), keep the existing badge but make it pulse rather than fade.

**Node glow intensity:**

Instead of binary visited/not-visited, use cumulative touch count:
- 1 touch: dim glow
- 3-5 touches: medium glow
- 10+ touches: bright glow with outer ring

This makes hotspot files immediately visible — the `pipeline.py` that was read 11 times across sessions glows much brighter than a file read once.

---

## Build Order

### Step 1: Session touched files tracking
- **File:** `packages/client/src/stores/graph-store.ts`
- Add `sessionTouchedFiles: Set<string>`, `fileActivityCounts: Map`, `mapMode`
- Populate in `addActivity()` from event file paths

### Step 2: Display graph filtering
- **File:** `packages/client/src/components/CodebaseMap/ForceLayout.ts`
- Add `nodeFilter` param to `buildDisplayGraph()`
- Auto-expand ancestors of filtered nodes

### Step 3: Wire filter into force graph hook
- **File:** `packages/client/src/components/CodebaseMap/useForceGraph.ts`
- Read `mapMode` + `sessionTouchedFiles`, pass filter when session mode

### Step 4: UI toggle
- **File:** `packages/client/src/components/CodebaseMap/CodebaseMap.tsx`
- Add [Full Map] / [Session Map] toggle buttons

### Step 5: Activity ring rendering
- **File:** `packages/client/src/components/CodebaseMap/MapRenderer.ts`
- Replace single badge with segmented activity ring
- Scale glow by cumulative touch count

### Step 6: Update heat sync
- **File:** `packages/client/src/components/CodebaseMap/useForceGraph.ts`
- Pass `fileActivityCounts` to renderer for ring segments

---

## Files Summary

| File | Change |
|------|--------|
| `graph-store.ts` | Add `sessionTouchedFiles`, `fileActivityCounts`, `mapMode` |
| `ForceLayout.ts` | Add `nodeFilter` param to `buildDisplayGraph` |
| `useForceGraph.ts` | Wire session filter + activity counts to renderer |
| `CodebaseMap.tsx` | Add map mode toggle UI |
| `MapRenderer.ts` | Activity ring rendering, cumulative glow |

No server changes needed — all data already flows through events.
