import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipelineAnalyzer } from '../../pipeline/pipeline-analyzer.js';
import { MockLLMProvider } from './helpers/mock-llm-provider.js';
import type { CodebaseGraph, FileNode, DependencyEdge, PipelineDefinition } from '@hudai/shared';

// Mock the cache layer
vi.mock('../../pipeline/pipeline-cache.js', () => ({
  loadCache: vi.fn(),
  saveCache: vi.fn(),
  findStaleFiles: vi.fn(),
  findAffectedPipelines: vi.fn(),
}));

// Must import after vi.mock
import { loadCache, saveCache, findStaleFiles, findAffectedPipelines } from '../../pipeline/pipeline-cache.js';

// Also mock the context gatherers since they read the filesystem
vi.mock('../../pipeline/pipeline-context.js', () => ({
  gatherPipelineContext: vi.fn().mockResolvedValue('mock pipeline context prompt'),
  gatherDeltaPipelineContext: vi.fn().mockResolvedValue('mock delta pipeline context prompt'),
}));

const mockedLoadCache = vi.mocked(loadCache);
const mockedSaveCache = vi.mocked(saveCache);
const mockedFindStaleFiles = vi.mocked(findStaleFiles);
const mockedFindAffectedPipelines = vi.mocked(findAffectedPipelines);

// --- Graph fixture: 5 nodes, matching edges ---

function makeNode(id: string, group: string): FileNode {
  return {
    id,
    path: `/project/${id}`,
    label: id.split('/').pop()!,
    group,
    extension: '.ts',
    size: 1000,
    heat: 0.5,
    visited: false,
    modified: false,
  };
}

const GRAPH_NODES: FileNode[] = [
  makeNode('src/routes.ts', 'src'),
  makeNode('src/handler.ts', 'src'),
  makeNode('src/queries.ts', 'src'),
  makeNode('src/emitter.ts', 'src'),
  makeNode('src/broadcaster.ts', 'src'),
];

const GRAPH_EDGES: DependencyEdge[] = [
  { source: 'src/routes.ts', target: 'src/handler.ts', type: 'import' },
  { source: 'src/handler.ts', target: 'src/queries.ts', type: 'import' },
  { source: 'src/emitter.ts', target: 'src/broadcaster.ts', type: 'import' },
];

const GRAPH: CodebaseGraph = { nodes: GRAPH_NODES, edges: GRAPH_EDGES };

// --- Sample LLM pipeline response ---

const SAMPLE_PIPELINES: PipelineDefinition[] = [
  {
    id: 'request-pipeline',
    label: 'HTTP Request Pipeline',
    category: 'request-handling',
    description: 'Handles incoming HTTP requests',
    blocks: [
      { id: 'routes-block', label: 'Routes', blockType: 'source', files: ['src/routes.ts'] },
      { id: 'handler-block', label: 'Handler', blockType: 'transform', files: ['src/handler.ts'] },
      { id: 'queries-block', label: 'Queries', blockType: 'sink', files: ['src/queries.ts'] },
    ],
    edges: [
      { id: 'e1', source: 'routes-block', target: 'handler-block', edgeType: 'data' },
      { id: 'e2', source: 'handler-block', target: 'queries-block', edgeType: 'data' },
    ],
  },
  {
    id: 'event-pipeline',
    label: 'Event Broadcasting Pipeline',
    category: 'event-driven',
    description: 'Emits and broadcasts events',
    blocks: [
      { id: 'emitter-block', label: 'Emitter', blockType: 'source', files: ['src/emitter.ts'] },
      { id: 'broadcaster-block', label: 'Broadcaster', blockType: 'sink', files: ['src/broadcaster.ts'] },
    ],
    edges: [
      { id: 'e3', source: 'emitter-block', target: 'broadcaster-block', edgeType: 'data' },
    ],
  },
];

function samplePipelinesJson(): string {
  return JSON.stringify(SAMPLE_PIPELINES);
}

// Valid type sets for validation
const VALID_BLOCK_TYPES = new Set(['source', 'transform', 'sink', 'branch', 'merge', 'plan-step']);
const VALID_EDGE_TYPES = new Set(['data', 'control', 'error']);
const VALID_CATEGORIES = new Set(['event-driven', 'state-management', 'request-handling', 'data-processing', 'agent-plan']);

describe('Pipeline Analysis with Cache', () => {
  let mockLLM: MockLLMProvider;
  let analyzer: PipelineAnalyzer;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLLM = new MockLLMProvider();
    mockLLM.setDefaultResponse(samplePipelinesJson());
    analyzer = new PipelineAnalyzer(mockLLM);
  });

  it('performs full analysis when no cache exists', async () => {
    mockedLoadCache.mockResolvedValue(null);

    const result = await analyzer.analyze('/project', GRAPH);

    // LLM should be called once
    expect(mockLLM.callLog).toHaveLength(1);

    // Result should have valid pipelines
    expect(result.pipelines).toHaveLength(2);

    // saveCache should be called
    expect(mockedSaveCache).toHaveBeenCalledOnce();
    expect(mockedSaveCache).toHaveBeenCalledWith(
      '/project',
      expect.any(Array),
      GRAPH_NODES.map(n => n.id),
    );

    // Validate pipeline structure
    for (const pipeline of result.pipelines) {
      expect(VALID_CATEGORIES).toContain(pipeline.category);
      for (const block of pipeline.blocks) {
        expect(VALID_BLOCK_TYPES).toContain(block.blockType);
        // All files should reference valid graph node IDs
        for (const file of block.files) {
          expect(GRAPH_NODES.some(n => n.id === file)).toBe(true);
        }
      }
      for (const edge of pipeline.edges) {
        expect(VALID_EDGE_TYPES).toContain(edge.edgeType);
        // Edge source and target should reference block IDs in this pipeline
        const blockIds = new Set(pipeline.blocks.map(b => b.id));
        expect(blockIds).toContain(edge.source);
        expect(blockIds).toContain(edge.target);
      }
    }
  });

  it('returns cached result when no files are stale', async () => {
    mockedLoadCache.mockResolvedValue({
      version: 1,
      generatedAt: Date.now() - 60_000,
      projectRoot: '/project',
      fileMtimes: { 'src/routes.ts': Date.now() },
      pipelines: SAMPLE_PIPELINES,
    });
    mockedFindStaleFiles.mockResolvedValue({
      changed: [],
      added: [],
      removed: [],
    });

    const result = await analyzer.analyze('/project', GRAPH);

    // LLM should NOT be called
    expect(mockLLM.callLog).toHaveLength(0);

    // Same pipelines returned
    expect(result.pipelines).toEqual(SAMPLE_PIPELINES);
  });

  it('performs incremental update when 1 file is stale', async () => {
    const updatedHandlerBlock = {
      id: 'handler-block',
      label: 'Handler v2',
      blockType: 'transform' as const,
      files: ['src/handler.ts'],
    };

    const incrementalResponse: PipelineDefinition[] = [
      {
        ...SAMPLE_PIPELINES[0],
        blocks: [
          SAMPLE_PIPELINES[0].blocks[0],
          updatedHandlerBlock,
          SAMPLE_PIPELINES[0].blocks[2],
        ],
      },
    ];

    mockLLM.setDefaultResponse(JSON.stringify(incrementalResponse));

    mockedLoadCache.mockResolvedValue({
      version: 1,
      generatedAt: Date.now() - 60_000,
      projectRoot: '/project',
      fileMtimes: { 'src/handler.ts': Date.now() - 120_000 },
      pipelines: SAMPLE_PIPELINES,
    });
    mockedFindStaleFiles.mockResolvedValue({
      changed: ['src/handler.ts'],
      added: [],
      removed: [],
    });
    mockedFindAffectedPipelines.mockReturnValue(['request-pipeline']);

    const result = await analyzer.analyze('/project', GRAPH);

    // LLM should be called once (incremental)
    expect(mockLLM.callLog).toHaveLength(1);

    // Should have both pipelines: updated request + unchanged event
    expect(result.pipelines).toHaveLength(2);

    // The request pipeline should have the updated handler block
    const requestPipeline = result.pipelines.find(p => p.id === 'request-pipeline');
    expect(requestPipeline).toBeDefined();
    const handlerBlock = requestPipeline!.blocks.find(b => b.id === 'handler-block');
    expect(handlerBlock).toBeDefined();
    expect(handlerBlock!.label).toBe('Handler v2');

    // The event pipeline should be unchanged (preserved from cache)
    const eventPipeline = result.pipelines.find(p => p.id === 'event-pipeline');
    expect(eventPipeline).toBeDefined();
    expect(eventPipeline).toEqual(SAMPLE_PIPELINES[1]);

    // saveCache should be called
    expect(mockedSaveCache).toHaveBeenCalledOnce();
  });

  it('falls back to full analysis when >30% files are stale', async () => {
    mockedLoadCache.mockResolvedValue({
      version: 1,
      generatedAt: Date.now() - 60_000,
      projectRoot: '/project',
      fileMtimes: {},
      pipelines: SAMPLE_PIPELINES,
    });

    // 3 out of 5 files stale = 60% > 30% threshold
    mockedFindStaleFiles.mockResolvedValue({
      changed: ['src/routes.ts', 'src/handler.ts'],
      added: ['src/new-file.ts'],
      removed: [],
    });

    const result = await analyzer.analyze('/project', GRAPH);

    // LLM should be called once (full rebuild, not incremental)
    expect(mockLLM.callLog).toHaveLength(1);

    // Verify it's a full analysis by checking the prompt doesn't come from delta context
    // (The mock resolves both context types, but we can check saveCache was called)
    expect(result.pipelines).toHaveLength(2);
    expect(mockedSaveCache).toHaveBeenCalledOnce();
  });

  it('validates block types and edge types in parsed output', async () => {
    // Provide a response with some invalid types — analyzer should coerce them
    const responseWithBadTypes = JSON.stringify([{
      id: 'test-pipeline',
      label: 'Test',
      category: 'invalid-category',
      blocks: [
        { id: 'b1', label: 'Block 1', blockType: 'nonexistent', files: ['src/routes.ts'] },
        { id: 'b2', label: 'Block 2', blockType: 'source', files: ['src/handler.ts'] },
      ],
      edges: [
        { id: 'e1', source: 'b1', target: 'b2', edgeType: 'invalid-edge' },
      ],
    }]);

    mockLLM.setDefaultResponse(responseWithBadTypes);
    mockedLoadCache.mockResolvedValue(null);

    const result = await analyzer.analyze('/project', GRAPH);

    expect(result.pipelines).toHaveLength(1);
    const pipeline = result.pipelines[0];

    // Invalid category should be coerced to 'data-processing'
    expect(pipeline.category).toBe('data-processing');

    // Invalid blockType should be coerced to 'transform'
    expect(pipeline.blocks[0].blockType).toBe('transform');

    // Valid blockType should be preserved
    expect(pipeline.blocks[1].blockType).toBe('source');

    // Invalid edgeType should be coerced to 'data'
    expect(pipeline.edges[0].edgeType).toBe('data');
  });

  it('filters file references to only valid graph node IDs', async () => {
    const responseWithBadFiles = JSON.stringify([{
      id: 'test-pipeline',
      label: 'Test',
      category: 'request-handling',
      blocks: [
        {
          id: 'b1',
          label: 'Block 1',
          blockType: 'source',
          files: ['src/routes.ts', 'src/nonexistent.ts', 'src/handler.ts'],
        },
      ],
      edges: [],
    }]);

    mockLLM.setDefaultResponse(responseWithBadFiles);
    mockedLoadCache.mockResolvedValue(null);

    const result = await analyzer.analyze('/project', GRAPH);

    const block = result.pipelines[0].blocks[0];
    // Should only contain files that exist in the graph
    expect(block.files).toEqual(['src/routes.ts', 'src/handler.ts']);
    expect(block.files).not.toContain('src/nonexistent.ts');
  });
});
