import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore } from '../stores/graph-store.js';
import type { CodebaseGraph, FileNode, AVPEvent } from '@hudai/shared';

function makeNode(id: string, opts: Partial<FileNode> = {}): FileNode {
  return {
    id,
    path: opts.path ?? id,
    name: id.split('/').pop() ?? id,
    group: opts.group ?? '.',
    size: opts.size ?? 100,
    heat: opts.heat ?? 0,
    visited: opts.visited ?? false,
    modified: opts.modified ?? false,
    connections: opts.connections ?? 0,
    ...opts,
  } as FileNode;
}

function makeGraph(nodes: FileNode[]): CodebaseGraph {
  return { nodes, edges: [] } as any;
}

function makeEvent(type: string, data: any): AVPEvent {
  return {
    id: `e-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: 's1',
    timestamp: Date.now(),
    category: 'navigation',
    type,
    data,
  } as AVPEvent;
}

describe('useGraphStore', () => {
  beforeEach(() => {
    useGraphStore.setState({
      graph: null,
      nodeMap: new Map(),
      pathToId: new Map(),
      expandedGroups: new Set(),
      activityNodes: [],
      fileIndicators: new Map(),
      failingFiles: new Set(),
      sessionTouchedFiles: new Set(),
      fileActivityCounts: new Map(),
      heatTick: 0,
      hottestFile: null,
      architecture: null,
      zoomLevel: 1,
      semanticZoom: 'file',
      pipelineLayer: null,
      pipelineAnalyzing: false,
    });
  });

  // --- setGraph ---

  it('setGraph builds nodeMap and pathToId', () => {
    const nodes = [
      makeNode('src/a.ts', { path: '/project/src/a.ts' }),
      makeNode('src/b.ts', { path: '/project/src/b.ts' }),
    ];
    useGraphStore.getState().setGraph(makeGraph(nodes));
    const s = useGraphStore.getState();
    expect(s.nodeMap.size).toBe(2);
    expect(s.nodeMap.get('src/a.ts')).toBe(nodes[0]);
    expect(s.pathToId.get('/project/src/a.ts')).toBe('src/a.ts');
  });

  it('setGraph sets expandedGroups to root only', () => {
    useGraphStore.getState().setGraph(makeGraph([makeNode('a.ts')]));
    expect(useGraphStore.getState().expandedGroups).toEqual(new Set(['.']));
  });

  it('setGraph resets session tracking', () => {
    useGraphStore.setState({ sessionTouchedFiles: new Set(['old.ts']), fileActivityCounts: new Map([['old.ts', { reads: 1, edits: 0, shells: 0, searches: 0 }]]) });
    useGraphStore.getState().setGraph(makeGraph([makeNode('a.ts')]));
    expect(useGraphStore.getState().sessionTouchedFiles.size).toBe(0);
    expect(useGraphStore.getState().fileActivityCounts.size).toBe(0);
  });

  it('setGraph preserves architecture from graph', () => {
    const graph = { nodes: [], edges: [], architecture: { containers: [] } } as any;
    useGraphStore.getState().setGraph(graph);
    expect(useGraphStore.getState().architecture).toEqual({ containers: [] });
  });

  // --- toggleGroup ---

  it('toggleGroup adds group to expanded set', () => {
    useGraphStore.getState().setGraph(makeGraph([]));
    useGraphStore.getState().toggleGroup('src');
    expect(useGraphStore.getState().expandedGroups.has('src')).toBe(true);
  });

  it('toggleGroup removes group and children', () => {
    useGraphStore.setState({ expandedGroups: new Set(['.', 'src', 'src/components', 'src/components/ui']) });
    useGraphStore.getState().toggleGroup('src');
    const groups = useGraphStore.getState().expandedGroups;
    expect(groups.has('src')).toBe(false);
    expect(groups.has('src/components')).toBe(false);
    expect(groups.has('src/components/ui')).toBe(false);
    expect(groups.has('.')).toBe(true);
  });

  // --- setZoomLevel ---

  it('setZoomLevel < 0.3 → container tier', () => {
    useGraphStore.getState().setZoomLevel(0.2);
    expect(useGraphStore.getState().semanticZoom).toBe('container');
  });

  it('setZoomLevel 0.3-0.7 → module tier', () => {
    useGraphStore.getState().setZoomLevel(0.5);
    expect(useGraphStore.getState().semanticZoom).toBe('module');
  });

  it('setZoomLevel >= 0.7 → file tier', () => {
    useGraphStore.getState().setZoomLevel(0.85);
    expect(useGraphStore.getState().semanticZoom).toBe('file');
  });

  // --- setSemanticZoom ---

  it('setSemanticZoom container sets zoom to 0.15', () => {
    useGraphStore.getState().setSemanticZoom('container');
    expect(useGraphStore.getState().zoomLevel).toBe(0.15);
  });

  it('setSemanticZoom module sets zoom to 0.5', () => {
    useGraphStore.getState().setSemanticZoom('module');
    expect(useGraphStore.getState().zoomLevel).toBe(0.5);
  });

  it('setSemanticZoom file sets zoom to 0.85', () => {
    useGraphStore.getState().setSemanticZoom('file');
    expect(useGraphStore.getState().zoomLevel).toBe(0.85);
  });

  // --- addActivity with file events ---

  it('addActivity file.read boosts heat and sets indicator', () => {
    const node = makeNode('src/a.ts');
    useGraphStore.getState().setGraph(makeGraph([node]));
    useGraphStore.getState().addActivity(makeEvent('file.read', { path: 'src/a.ts' }));
    expect(node.heat).toBeGreaterThan(0);
    expect(node.visited).toBe(true);
    expect(useGraphStore.getState().fileIndicators.get('src/a.ts')?.kind).toBe('read');
  });

  it('addActivity file.edit sets modified flag', () => {
    const node = makeNode('src/a.ts');
    useGraphStore.getState().setGraph(makeGraph([node]));
    useGraphStore.getState().addActivity(makeEvent('file.edit', { path: 'src/a.ts', additions: 5, deletions: 2 }));
    expect(node.modified).toBe(true);
    const ind = useGraphStore.getState().fileIndicators.get('src/a.ts');
    expect(ind?.kind).toBe('edit');
    expect(ind?.additions).toBe(5);
    expect(ind?.deletions).toBe(2);
  });

  it('addActivity resolves absolute path via pathToId', () => {
    const node = makeNode('src/a.ts', { path: '/abs/src/a.ts' });
    useGraphStore.getState().setGraph(makeGraph([node]));
    useGraphStore.getState().addActivity(makeEvent('file.read', { path: '/abs/src/a.ts' }));
    expect(node.heat).toBeGreaterThan(0);
    expect(useGraphStore.getState().sessionTouchedFiles.has('src/a.ts')).toBe(true);
  });

  it('addActivity tracks fileActivityCounts', () => {
    const node = makeNode('src/a.ts');
    useGraphStore.getState().setGraph(makeGraph([node]));
    useGraphStore.getState().addActivity(makeEvent('file.read', { path: 'src/a.ts' }));
    useGraphStore.getState().addActivity(makeEvent('file.read', { path: 'src/a.ts' }));
    useGraphStore.getState().addActivity(makeEvent('file.edit', { path: 'src/a.ts' }));
    const counts = useGraphStore.getState().fileActivityCounts.get('src/a.ts');
    expect(counts?.reads).toBe(2);
    expect(counts?.edits).toBe(1);
  });

  // --- search events boost multiple files ---

  it('addActivity search.grep boosts result files', () => {
    const n1 = makeNode('a.ts');
    const n2 = makeNode('b.ts');
    useGraphStore.getState().setGraph(makeGraph([n1, n2]));
    useGraphStore.getState().addActivity(makeEvent('search.grep', {
      pattern: 'foo',
      files: ['a.ts', 'b.ts'],
    }));
    expect(n1.heat).toBeGreaterThan(0);
    expect(n2.heat).toBeGreaterThan(0);
    expect(useGraphStore.getState().sessionTouchedFiles.has('a.ts')).toBe(true);
    expect(useGraphStore.getState().sessionTouchedFiles.has('b.ts')).toBe(true);
  });

  it('addActivity search limits to 5 result files', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => makeNode(`f${i}.ts`));
    useGraphStore.getState().setGraph(makeGraph(nodes));
    useGraphStore.getState().addActivity(makeEvent('search.grep', {
      pattern: 'bar',
      files: nodes.map(n => n.id),
    }));
    // Only first 5 should get heat boost via search loop
    // (first file gets double-boosted via primary path + search loop)
    const boosted = nodes.filter(n => n.heat > 0);
    expect(boosted.length).toBeLessThanOrEqual(6); // 5 from search + 1 from primary
  });

  // --- failing test files ---

  it('addActivity test.result with failures populates failingFiles', () => {
    useGraphStore.getState().setGraph(makeGraph([makeNode('a.ts')]));
    useGraphStore.getState().addActivity(makeEvent('test.result', {
      passed: 5,
      failed: 2,
      total: 7,
      failures: [{ file: 'a.ts', name: 'test1' }],
    }));
    expect(useGraphStore.getState().failingFiles.has('a.ts')).toBe(true);
  });

  it('addActivity test.result with all passing clears failingFiles', () => {
    useGraphStore.setState({ failingFiles: new Set(['old.ts']) });
    useGraphStore.getState().setGraph(makeGraph([]));
    useGraphStore.getState().addActivity(makeEvent('test.result', {
      passed: 10, failed: 0, total: 10,
    }));
    expect(useGraphStore.getState().failingFiles.size).toBe(0);
  });

  // --- activity nodes ---

  it('addActivity shell.run creates activity node', () => {
    useGraphStore.getState().setGraph(makeGraph([]));
    useGraphStore.getState().addActivity(makeEvent('shell.run', { command: 'npm test' }));
    expect(useGraphStore.getState().activityNodes).toHaveLength(1);
    expect(useGraphStore.getState().activityNodes[0].kind).toBe('shell');
  });

  it('addActivity shell.run with web-like command creates web activity', () => {
    useGraphStore.getState().setGraph(makeGraph([]));
    useGraphStore.getState().addActivity(makeEvent('shell.run', { command: 'curl http://api.com' }));
    expect(useGraphStore.getState().activityNodes[0].kind).toBe('web');
  });

  it('addActivity think.start creates thinking activity', () => {
    useGraphStore.getState().setGraph(makeGraph([]));
    useGraphStore.getState().addActivity(makeEvent('think.start', { summary: 'Planning' }));
    expect(useGraphStore.getState().activityNodes[0].kind).toBe('thinking');
  });

  it('addActivity permission.prompt creates prompt activity', () => {
    useGraphStore.getState().setGraph(makeGraph([]));
    useGraphStore.getState().addActivity(makeEvent('permission.prompt', { tool: 'Bash', command: 'rm -rf' }));
    expect(useGraphStore.getState().activityNodes[0].kind).toBe('prompt');
  });

  it('addActivity shell.output with non-zero exit creates error activity', () => {
    useGraphStore.getState().setGraph(makeGraph([]));
    useGraphStore.getState().addActivity(makeEvent('shell.output', { exitCode: 1, durationMs: 5000 }));
    expect(useGraphStore.getState().activityNodes[0].kind).toBe('error');
    expect(useGraphStore.getState().activityNodes[0].label).toBe('EXIT 1');
  });

  it('addActivity shell.output with exit 0 does not create activity', () => {
    useGraphStore.getState().setGraph(makeGraph([]));
    useGraphStore.getState().addActivity(makeEvent('shell.output', { exitCode: 0 }));
    expect(useGraphStore.getState().activityNodes).toHaveLength(0);
  });

  // --- decayHeat ---

  it('decayHeat reduces node heat', () => {
    const node = makeNode('a.ts', { heat: 1 });
    useGraphStore.getState().setGraph(makeGraph([node]));
    useGraphStore.getState().decayHeat();
    expect(node.heat).toBe(0.98);
  });

  it('decayHeat does not go below 0', () => {
    const node = makeNode('a.ts', { heat: 0.01 });
    useGraphStore.getState().setGraph(makeGraph([node]));
    useGraphStore.getState().decayHeat();
    expect(node.heat).toBe(0);
  });

  it('decayHeat increments heatTick', () => {
    const node = makeNode('a.ts', { heat: 0.5 });
    useGraphStore.getState().setGraph(makeGraph([node]));
    useGraphStore.getState().decayHeat();
    expect(useGraphStore.getState().heatTick).toBe(1);
  });

  // --- applyUpdates ---

  it('applyUpdates merges partial updates into nodes', () => {
    const node = makeNode('a.ts', { heat: 0, size: 100 });
    useGraphStore.getState().setGraph(makeGraph([node]));
    useGraphStore.getState().applyUpdates([{ id: 'a.ts', heat: 0.5, size: 200 } as any]);
    expect(node.heat).toBe(0.5);
    expect(node.size).toBe(200);
  });

  it('applyUpdates ignores updates for unknown ids', () => {
    useGraphStore.getState().setGraph(makeGraph([makeNode('a.ts')]));
    // Should not throw
    useGraphStore.getState().applyUpdates([{ id: 'nonexistent', heat: 1 } as any]);
  });

  // --- pipeline ---

  it('setPipelineLayer stores pipeline and clears analyzing', () => {
    useGraphStore.setState({ pipelineAnalyzing: true });
    useGraphStore.getState().setPipelineLayer({ pipelines: [] } as any);
    expect(useGraphStore.getState().pipelineLayer).toEqual({ pipelines: [] });
    expect(useGraphStore.getState().pipelineAnalyzing).toBe(false);
  });

  it('clearPipeline resets pipeline state', () => {
    useGraphStore.getState().setPipelineLayer({ pipelines: [] } as any);
    useGraphStore.getState().clearPipeline();
    expect(useGraphStore.getState().pipelineLayer).toBeNull();
    expect(useGraphStore.getState().pipelineAnalyzing).toBe(false);
  });

  // --- mode setters ---

  it('setNodeSizeMode updates mode', () => {
    useGraphStore.getState().setNodeSizeMode('connectivity');
    expect(useGraphStore.getState().nodeSizeMode).toBe('connectivity');
  });

  it('setMapMode updates mode', () => {
    useGraphStore.getState().setMapMode('session');
    expect(useGraphStore.getState().mapMode).toBe('session');
  });
});
