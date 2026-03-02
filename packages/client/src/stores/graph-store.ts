import { create } from 'zustand';
import type { CodebaseGraph, FileNode, AVPEvent, ArchitectureLayer, PipelineLayer, PipelineBlock } from '@hudai/shared';

export type NodeSizeMode = 'filesize' | 'connectivity';
export type MapMode = 'full' | 'session' | 'journey' | 'architecture' | 'pipeline' | 'library';
export type SemanticZoomTier = 'container' | 'module' | 'file';

export type ActivityKind = 'shell' | 'web' | 'thinking' | 'testing' | 'search' | 'error' | 'prompt';

/** Cumulative per-file activity counts for the current session */
export interface FileActivityCounts {
  reads: number;
  edits: number;
  shells: number;
  searches: number;
}

export interface ActivityNode {
  id: string;
  kind: ActivityKind;
  label: string;
  detail?: string;
  /** Related file path, if any — activity will appear near this node */
  relatedFile?: string;
  heat: number;
  createdAt: number;
}

/** Indicator on a file node showing recent action */
export interface FileIndicator {
  kind: 'read' | 'edit' | 'create' | 'delete' | 'search';
  label: string;
  timestamp: number;
  additions?: number;
  deletions?: number;
}

const ACTIVITY_TTL = 8000; // 8 seconds before fully faded
const FILE_INDICATOR_TTL = 4000; // 4 seconds for file indicators

interface GraphStoreState {
  graph: CodebaseGraph | null;
  nodeMap: Map<string, FileNode>;
  /** Reverse lookup: absolute path → relative node ID */
  pathToId: Map<string, string>;
  expandedGroups: Set<string>;
  nodeSizeMode: NodeSizeMode;
  mapMode: MapMode;
  activityNodes: ActivityNode[];
  /** Per-file indicators for recent actions (file path → indicator) */
  fileIndicators: Map<string, FileIndicator>;
  /** File paths with failing tests — highlighted in red on the map */
  failingFiles: Set<string>;
  /** Files the agent has touched this session (for session minimap) */
  sessionTouchedFiles: Set<string>;
  /** Cumulative activity counts per file (for activity rings) */
  fileActivityCounts: Map<string, FileActivityCounts>;
  /** Increments on heat-only updates (no structural change) */
  heatTick: number;
  /** Cached hottest file by heat — updated on heat decay to avoid selector loops */
  hottestFile: string | null;
  /** Architecture overlay (auto-detected containers) */
  architecture: ArchitectureLayer | null;
  /** Current zoom level from MapRenderer */
  zoomLevel: number;
  /** Derived semantic zoom tier */
  semanticZoom: SemanticZoomTier;
  /** Pipeline overlay data */
  pipelineLayer: PipelineLayer | null;
  /** Whether pipeline analysis is currently running */
  pipelineAnalyzing: boolean;
  setPipelineLayer: (layer: PipelineLayer) => void;
  setPipelineAnalyzing: (analyzing: boolean) => void;
  clearPipeline: () => void;
  updatePipeline: (updates: { blockId: string; patch: Partial<PipelineBlock> }[]) => void;
  setGraph: (graph: CodebaseGraph) => void;
  applyUpdates: (updates: Partial<FileNode>[]) => void;
  decayHeat: () => void;
  toggleGroup: (group: string) => void;
  setNodeSizeMode: (mode: NodeSizeMode) => void;
  setMapMode: (mode: MapMode) => void;
  setZoomLevel: (zoom: number) => void;
  setSemanticZoom: (tier: SemanticZoomTier) => void;
  addActivity: (event: AVPEvent) => void;
}

function eventToActivity(event: AVPEvent): ActivityNode | null {
  const base = {
    id: `__activity__${event.id}`,
    heat: 1,
    createdAt: Date.now(),
  };

  switch (event.type) {
    case 'shell.run': {
      const cmd = (event as any).data.command ?? '';
      const isWeb = /\b(curl|wget|fetch|http|api|web.?search|mcp)\b/i.test(cmd);
      return {
        ...base,
        kind: isWeb ? 'web' : 'shell',
        label: isWeb ? 'Web Request' : 'Shell',
        detail: cmd.length > 50 ? cmd.slice(0, 50) + '...' : cmd,
      };
    }
    case 'think.start':
      return {
        ...base,
        kind: 'thinking',
        label: 'Thinking',
        detail: (event as any).data.summary,
      };
    case 'test.run':
      return {
        ...base,
        kind: 'testing',
        label: 'Running Tests',
        detail: (event as any).data.command,
      };
    case 'test.result': {
      const d = (event as any).data;
      return {
        ...base,
        kind: 'testing',
        label: d.failed > 0 ? `Tests: ${d.failed} failed` : `Tests: ${d.passed} passed`,
        detail: `${d.passed}/${d.total} passed`,
      };
    }
    case 'search.grep':
      return {
        ...base,
        kind: 'search',
        label: 'Grep',
        detail: (event as any).data.pattern,
        relatedFile: (event as any).data.files?.[0],
      };
    case 'search.glob':
      return {
        ...base,
        kind: 'search',
        label: 'Glob',
        detail: (event as any).data.pattern,
        relatedFile: (event as any).data.files?.[0],
      };
    case 'shell.output': {
      const so = (event as any).data;
      if (so.exitCode !== 0) {
        return {
          ...base,
          kind: 'error',
          label: `EXIT ${so.exitCode}`,
          detail: so.durationMs ? `${Math.round(so.durationMs / 1000)}s` : undefined,
        };
      }
      return null;
    }
    case 'agent.error':
      return {
        ...base,
        kind: 'error',
        label: 'Error',
        detail: (event as any).data.message,
      };
    case 'permission.prompt':
      return {
        ...base,
        kind: 'prompt',
        label: 'Permission',
        detail: (event as any).data.tool + ': ' + (event as any).data.command,
      };
    default:
      return null;
  }
}

export const useGraphStore = create<GraphStoreState>((set, get) => ({
  graph: null,
  nodeMap: new Map(),
  pathToId: new Map(),
  expandedGroups: new Set(),
  nodeSizeMode: 'filesize' as NodeSizeMode,
  mapMode: 'pipeline' as MapMode,
  activityNodes: [],
  fileIndicators: new Map(),
  failingFiles: new Set(),
  sessionTouchedFiles: new Set(),
  fileActivityCounts: new Map(),
  heatTick: 0,
  hottestFile: null,
  architecture: null,
  zoomLevel: 1,
  semanticZoom: 'file' as SemanticZoomTier,
  pipelineLayer: null,
  pipelineAnalyzing: false,

  setPipelineLayer: (layer) => set({ pipelineLayer: layer, pipelineAnalyzing: false }),
  setPipelineAnalyzing: (analyzing) => set({ pipelineAnalyzing: analyzing }),
  clearPipeline: () => set({ pipelineLayer: null, pipelineAnalyzing: false }),

  updatePipeline: (updates) => {
    const { pipelineLayer } = get();
    if (!pipelineLayer) return;
    const newLayer = { ...pipelineLayer, pipelines: [...pipelineLayer.pipelines] };
    for (const { blockId, patch } of updates) {
      for (const pipeline of newLayer.pipelines) {
        const block = pipeline.blocks.find((b) => b.id === blockId);
        if (block) Object.assign(block, patch);
      }
    }
    set({ pipelineLayer: newLayer });
  },

  setGraph: (graph) => {
    const nodeMap = new Map<string, FileNode>();
    const pathToId = new Map<string, string>();
    for (const n of graph.nodes) {
      nodeMap.set(n.id, n);
      // Build reverse lookup: absolute path → relative id
      if (n.path && n.path !== n.id) {
        pathToId.set(n.path, n.id);
      }
    }
    const expanded = new Set<string>();
    expanded.add('.');
    set({
      graph, nodeMap, pathToId, expandedGroups: expanded,
      sessionTouchedFiles: new Set(),
      fileActivityCounts: new Map(),
      architecture: graph.architecture ?? null,
    });
  },

  applyUpdates: (updates) => {
    const { graph, nodeMap } = get();
    if (!graph) return;
    for (const u of updates) {
      if (!u.id) continue;
      const node = nodeMap.get(u.id);
      if (node) Object.assign(node, u);
    }
    set({ graph: { ...graph, nodes: [...graph.nodes] } });
  },

  decayHeat: () => {
    const { graph, activityNodes, fileIndicators, heatTick } = get();
    let changed = false;

    // Decay file heat — mutate in place, do NOT create new graph reference
    if (graph) {
      for (const node of graph.nodes) {
        if (node.heat > 0) {
          node.heat = Math.max(0, node.heat - 0.02);
          changed = true;
        }
      }
    }

    // Decay activity nodes and remove expired ones
    const now = Date.now();
    const alive: ActivityNode[] = [];
    for (const a of activityNodes) {
      const age = now - a.createdAt;
      if (age < ACTIVITY_TTL) {
        a.heat = Math.max(0, 1 - age / ACTIVITY_TTL);
        alive.push(a);
        changed = true;
      } else {
        changed = true;
      }
    }

    // Prune expired file indicators
    let indicatorsChanged = false;
    for (const [path, ind] of fileIndicators) {
      if (now - ind.timestamp > FILE_INDICATOR_TTL) {
        fileIndicators.delete(path);
        indicatorsChanged = true;
      }
    }

    if (changed || indicatorsChanged) {
      // Compute hottest file for stable selector access
      let hottestFile: string | null = null;
      let maxHeat = 0;
      if (graph) {
        for (const node of graph.nodes) {
          if (node.heat > maxHeat) {
            maxHeat = node.heat;
            hottestFile = node.id;
          }
        }
      }
      // Only update heatTick and activityNodes — NOT graph reference
      set({
        heatTick: heatTick + 1,
        activityNodes: alive,
        hottestFile,
        ...(indicatorsChanged ? { fileIndicators: new Map(fileIndicators) } : {}),
      });
    }
  },

  toggleGroup: (group) => {
    const { expandedGroups } = get();
    const next = new Set(expandedGroups);
    if (next.has(group)) {
      for (const g of next) {
        if (g === group || g.startsWith(group + '/')) {
          next.delete(g);
        }
      }
    } else {
      next.add(group);
    }
    set({ expandedGroups: next });
  },

  setNodeSizeMode: (mode) => set({ nodeSizeMode: mode }),
  setMapMode: (mode) => set({ mapMode: mode }),
  setZoomLevel: (zoom) => {
    const tier: SemanticZoomTier = zoom < 0.3 ? 'container' : zoom < 0.7 ? 'module' : 'file';
    set({ zoomLevel: zoom, semanticZoom: tier });
  },
  setSemanticZoom: (tier) => {
    const zoom = tier === 'container' ? 0.15 : tier === 'module' ? 0.5 : 0.85;
    set({ zoomLevel: zoom, semanticZoom: tier });
  },

  addActivity: (event) => {
    const { activityNodes, nodeMap, pathToId, fileIndicators, sessionTouchedFiles, fileActivityCounts } = get();

    // Boost heat on the file node directly + add file indicator
    // Resolve absolute paths to relative node IDs using the pathToId reverse map
    const rawPath = getEventFilePath(event);
    const filePath = rawPath ? (nodeMap.has(rawPath) ? rawPath : pathToId.get(rawPath) ?? null) : null;
    let touchedChanged = false;
    const newCounts = new Map(fileActivityCounts);

    if (filePath) {
      const fileNode = nodeMap.get(filePath);
      if (fileNode) {
        fileNode.heat = Math.min(1, fileNode.heat + 0.5);
        fileNode.visited = true;
        if (event.type === 'file.edit' || event.type === 'file.create' || event.type === 'file.delete') {
          fileNode.modified = true;
        }
      }

      // Track session touched files + cumulative counts
      if (!sessionTouchedFiles.has(filePath)) {
        sessionTouchedFiles.add(filePath);
        touchedChanged = true;
      }
      const counts = newCounts.get(filePath) ?? { reads: 0, edits: 0, shells: 0, searches: 0 };
      const actCategory = getActivityCategory(event);
      if (actCategory) {
        counts[actCategory]++;
        newCounts.set(filePath, { ...counts });
      }

      // Set file indicator
      const kind = getFileIndicatorKind(event);
      if (kind) {
        const newIndicators = new Map(fileIndicators);
        const indicator: FileIndicator = {
          kind,
          label: filePath.split('/').pop() ?? filePath,
          timestamp: Date.now(),
        };
        // Add diff data for edit events
        if (event.type === 'file.edit') {
          indicator.additions = (event as any).data.additions;
          indicator.deletions = (event as any).data.deletions;
        }
        newIndicators.set(filePath, indicator);
        set({ fileIndicators: newIndicators });
      }
    }

    // Also boost heat on search result files
    if (event.type === 'search.grep' || event.type === 'search.glob') {
      const files = (event as any).data.files ?? [];
      for (const rawF of files.slice(0, 5)) {
        const f = nodeMap.has(rawF) ? rawF : pathToId.get(rawF) ?? rawF;
        const node = nodeMap.get(f);
        if (node) {
          node.heat = Math.min(1, node.heat + 0.3);
          node.visited = true;
        }
        if (!sessionTouchedFiles.has(f)) {
          sessionTouchedFiles.add(f);
          touchedChanged = true;
        }
        const c = newCounts.get(f) ?? { reads: 0, edits: 0, shells: 0, searches: 0 };
        c.searches++;
        newCounts.set(f, { ...c });
      }
    }

    // Update session tracking state
    if (touchedChanged || newCounts.size > fileActivityCounts.size) {
      set({
        sessionTouchedFiles: new Set(sessionTouchedFiles),
        fileActivityCounts: newCounts,
      });
    } else {
      set({ fileActivityCounts: newCounts });
    }

    // Track failing test files
    if (event.type === 'test.result') {
      const d = (event as any).data;
      if (d.failed > 0 && d.failures) {
        const files = new Set<string>();
        for (const f of d.failures) {
          if (f.file) files.add(f.file);
        }
        if (files.size > 0) {
          set({ failingFiles: files });
        }
      } else {
        // Tests passed — clear failing files
        set({ failingFiles: new Set() });
      }
    }

    // Create floating activity node for non-file events
    const activity = eventToActivity(event);
    if (activity) {
      set({ activityNodes: [...activityNodes, activity] });
    }
  },
}));

function getEventFilePath(event: AVPEvent): string | null {
  switch (event.type) {
    case 'file.read': return event.data.path;
    case 'file.edit': return event.data.path;
    case 'file.create': return event.data.path;
    case 'file.delete': return event.data.path;
    case 'search.grep': return event.data.files?.[0] ?? null;
    case 'search.glob': return event.data.files?.[0] ?? null;
    default: return null;
  }
}

function getFileIndicatorKind(event: AVPEvent): FileIndicator['kind'] | null {
  switch (event.type) {
    case 'file.read': return 'read';
    case 'file.edit': return 'edit';
    case 'file.create': return 'create';
    case 'file.delete': return 'delete';
    case 'search.grep': case 'search.glob': return 'search';
    default: return null;
  }
}

function getActivityCategory(event: AVPEvent): keyof FileActivityCounts | null {
  switch (event.type) {
    case 'file.read': return 'reads';
    case 'file.edit': case 'file.create': case 'file.delete': return 'edits';
    case 'shell.run': case 'shell.output': return 'shells';
    case 'search.grep': case 'search.glob': return 'searches';
    default: return null;
  }
}
