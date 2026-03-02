import type { CodebaseGraph, PipelineLayer, PipelineDefinition, PipelineBlock, PipelineEdge } from '@hudai/shared';
import { gatherPipelineContext, gatherDeltaPipelineContext } from './pipeline-context.js';
import { loadCache, saveCache, findStaleFiles, findAffectedPipelines } from './pipeline-cache.js';
import type { PipelineStaleness } from './pipeline-cache.js';
import type { LLMClient } from '../llm/llm-provider.js';

const INCREMENTAL_MAX_FILES = 15;
const INCREMENTAL_MAX_RATIO = 0.3;

export class PipelineAnalyzer {
  constructor(private llm: LLMClient) {}

  async analyze(rootDir: string, graph: CodebaseGraph): Promise<PipelineLayer> {
    const allGraphFiles = graph.nodes.map(n => n.id);

    // 1. Try cache
    const cache = await loadCache(rootDir);
    if (cache) {
      const staleness = await findStaleFiles(cache, rootDir, allGraphFiles);
      const totalStale = staleness.changed.length + staleness.added.length + staleness.removed.length;

      if (totalStale === 0) {
        console.log('[pipeline] Cache hit — using cached pipelines');
        return { pipelines: cache.pipelines };
      }

      // Decide: incremental or full rebuild
      const staleRatio = totalStale / Math.max(allGraphFiles.length, 1);
      if (totalStale <= INCREMENTAL_MAX_FILES && staleRatio < INCREMENTAL_MAX_RATIO) {
        console.log(`[pipeline] Incremental update: ${totalStale} files changed (${staleness.changed.length} changed, ${staleness.added.length} added, ${staleness.removed.length} removed)`);
        return this.incrementalAnalysis(rootDir, graph, cache.pipelines, staleness, allGraphFiles);
      }

      console.log(`[pipeline] Cache stale — ${totalStale} files changed, full rebuild`);
    }

    // 2. Full analysis
    return this.fullAnalysis(rootDir, graph, allGraphFiles);
  }

  private async fullAnalysis(
    rootDir: string,
    graph: CodebaseGraph,
    allGraphFiles: string[],
  ): Promise<PipelineLayer> {
    console.log('[pipeline] Gathering context for LLM analysis...');
    const prompt = await gatherPipelineContext(rootDir, graph);

    console.log('[pipeline] Calling LLM for pipeline analysis...');
    const responseText = await this.llm.generate(prompt + '\n\nRespond with valid JSON only.');
    const pipelines = this.parseAndValidate(responseText, graph);

    // Save cache with ALL graph file IDs (not just referenced files)
    await saveCache(rootDir, pipelines, allGraphFiles);
    console.log(`[pipeline] Detected ${pipelines.length} pipelines, cached`);

    return { pipelines };
  }

  private async incrementalAnalysis(
    rootDir: string,
    graph: CodebaseGraph,
    existingPipelines: PipelineDefinition[],
    staleness: PipelineStaleness,
    allGraphFiles: string[],
  ): Promise<PipelineLayer> {
    const affectedIds = findAffectedPipelines(existingPipelines, staleness);
    console.log(`[pipeline] Affected pipelines: ${affectedIds.length > 0 ? affectedIds.join(', ') : 'none (new files only)'}`);

    const prompt = await gatherDeltaPipelineContext(rootDir, graph, existingPipelines, staleness);

    console.log('[pipeline] Calling LLM (incremental)...');
    const responseText = await this.llm.generate(prompt + '\n\nRespond with valid JSON only.');
    const llmPipelines = this.parseAndValidate(responseText, graph);

    // Merge: use cached pipelines as base, apply LLM changes only where needed
    const staleFiles = new Set([
      ...staleness.changed,
      ...staleness.added,
      ...staleness.removed,
    ]);
    const affectedSet = new Set(affectedIds);
    const cachedMap = new Map(existingPipelines.map(p => [p.id, p]));
    const llmMap = new Map(llmPipelines.map(p => [p.id, p]));

    const pipelines: PipelineDefinition[] = [];

    // Start from cached pipelines as base
    for (const cached of existingPipelines) {
      const llmVersion = llmMap.get(cached.id);

      if (!affectedSet.has(cached.id)) {
        // Unaffected pipeline — use cached version exactly
        pipelines.push(cached);
      } else if (llmVersion) {
        // Affected pipeline — block-level merge
        pipelines.push(this.mergePipeline(cached, llmVersion, staleFiles));
      } else {
        // LLM dropped this pipeline — keep cached (safety)
        console.log(`[pipeline] LLM dropped pipeline "${cached.id}" — restoring from cache`);
        pipelines.push(cached);
      }
    }

    // Add any genuinely new pipelines the LLM created (not in cache)
    for (const llmPipeline of llmPipelines) {
      if (!cachedMap.has(llmPipeline.id)) {
        pipelines.push(llmPipeline);
      }
    }

    // Save cache with ALL graph file IDs
    await saveCache(rootDir, pipelines, allGraphFiles);
    console.log(`[pipeline] Incremental update complete: ${pipelines.length} pipelines`);

    return { pipelines };
  }

  /**
   * Merge an affected pipeline at the block level:
   * - Blocks whose files DON'T overlap with stale files → keep cached version
   * - Blocks whose files DO overlap → use LLM version
   * - New blocks from LLM (not in cache) → accept
   * - Pipeline-level metadata (label, category, description) → keep cached
   */
  private mergePipeline(
    cached: PipelineDefinition,
    llm: PipelineDefinition,
    staleFiles: Set<string>,
  ): PipelineDefinition {
    const cachedBlockMap = new Map(cached.blocks.map(b => [b.id, b]));
    const llmBlockMap = new Map(llm.blocks.map(b => [b.id, b]));

    const mergedBlocks: PipelineBlock[] = [];

    // Process cached blocks first
    for (const cachedBlock of cached.blocks) {
      const blockTouchesStaleFile = cachedBlock.files.some(f => staleFiles.has(f));

      if (blockTouchesStaleFile && llmBlockMap.has(cachedBlock.id)) {
        // Block is affected — use LLM's updated version
        mergedBlocks.push(llmBlockMap.get(cachedBlock.id)!);
      } else if (blockTouchesStaleFile && !llmBlockMap.has(cachedBlock.id)) {
        // Block was affected and LLM removed it (e.g., file was deleted) — drop it
      } else {
        // Block is unaffected — keep cached version exactly
        mergedBlocks.push(cachedBlock);
      }
    }

    // Accept genuinely new blocks from LLM (not in cached)
    for (const llmBlock of llm.blocks) {
      if (!cachedBlockMap.has(llmBlock.id)) {
        mergedBlocks.push(llmBlock);
      }
    }

    // Edges: rebuild from LLM but only keep edges whose source+target exist in merged blocks
    const mergedBlockIds = new Set(mergedBlocks.map(b => b.id));
    const mergedEdges: PipelineEdge[] = [];

    // Prefer LLM edges for affected blocks, cached edges for unaffected
    const cachedEdgeMap = new Map(cached.edges.map(e => [e.id, e]));
    for (const llmEdge of llm.edges) {
      if (mergedBlockIds.has(llmEdge.source) && mergedBlockIds.has(llmEdge.target)) {
        // Check if both endpoints are unaffected — if so, prefer cached edge
        const sourceUnaffected = cachedBlockMap.has(llmEdge.source) &&
          !cachedBlockMap.get(llmEdge.source)!.files.some(f => staleFiles.has(f));
        const targetUnaffected = cachedBlockMap.has(llmEdge.target) &&
          !cachedBlockMap.get(llmEdge.target)!.files.some(f => staleFiles.has(f));

        if (sourceUnaffected && targetUnaffected && cachedEdgeMap.has(llmEdge.id)) {
          mergedEdges.push(cachedEdgeMap.get(llmEdge.id)!);
        } else {
          mergedEdges.push(llmEdge);
        }
      }
    }
    // Keep cached edges that LLM didn't return but whose blocks still exist
    for (const cachedEdge of cached.edges) {
      if (mergedBlockIds.has(cachedEdge.source) && mergedBlockIds.has(cachedEdge.target)) {
        if (!mergedEdges.some(e => e.id === cachedEdge.id)) {
          mergedEdges.push(cachedEdge);
        }
      }
    }

    return {
      // Pipeline-level metadata — keep cached (stable)
      id: cached.id,
      label: cached.label,
      category: cached.category,
      description: cached.description,
      blocks: mergedBlocks,
      edges: mergedEdges,
    };
  }

  private parseAndValidate(responseText: string, graph: CodebaseGraph): PipelineDefinition[] {
    // Strip markdown code fences if present
    let jsonText = responseText.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      console.error('[pipeline] Failed to parse LLM response as JSON');
      throw new Error('LLM returned invalid JSON');
    }

    // Handle both array and {pipelines: [...]} formats
    let pipelines: unknown[];
    if (Array.isArray(parsed)) {
      pipelines = parsed;
    } else if (parsed && typeof parsed === 'object' && 'pipelines' in parsed && Array.isArray((parsed as any).pipelines)) {
      pipelines = (parsed as any).pipelines;
    } else {
      throw new Error('LLM response is not a pipeline array');
    }

    // Collect valid file IDs for validation
    const validFiles = new Set(graph.nodes.map(n => n.id));

    // Validate and clean each pipeline
    const validCategories = new Set(['event-driven', 'state-management', 'request-handling', 'data-processing']);
    const validBlockTypes = new Set(['source', 'transform', 'sink', 'branch', 'merge']);
    const validEdgeTypes = new Set(['data', 'control', 'error']);

    return pipelines.map((p: any, i: number) => {
      const pipeline: PipelineDefinition = {
        id: p.id || `pipeline-${i}`,
        label: p.label || `Pipeline ${i + 1}`,
        category: validCategories.has(p.category) ? p.category : 'data-processing',
        description: p.description,
        blocks: (p.blocks || []).map((b: any) => ({
          id: b.id || `block-${Math.random().toString(36).slice(2, 8)}`,
          label: b.label || 'Unknown Block',
          blockType: validBlockTypes.has(b.blockType) ? b.blockType : 'transform',
          files: (b.files || []).filter((f: string) => validFiles.has(f)),
          technology: b.technology,
          description: b.description,
        })),
        edges: (p.edges || []).map((e: any) => ({
          id: e.id || `edge-${Math.random().toString(36).slice(2, 8)}`,
          source: e.source,
          target: e.target,
          label: e.label,
          edgeType: validEdgeTypes.has(e.edgeType) ? e.edgeType : 'data',
        })),
      };
      return pipeline;
    });
  }
}
