import { useMemo } from 'react';
import { useGraphStore } from '../stores/graph-store.js';
import { useEventStore } from '../stores/event-store.js';
import type { PipelineDefinition } from '@hudai/shared';

export interface BlockActivity {
  heat: number;
  isSpotlight: boolean;
  indicator?: string;
  isFailing: boolean;
}

export interface PipelineTabActivity {
  hasActivity: boolean;   // any block has heat > 0
  maxHeat: number;        // highest block heat
  hasEdits: boolean;      // recent file.edit events match a block
  hasFailing: boolean;    // failing test files match a block
}

/**
 * Checks if two paths refer to the same file despite different formats.
 * Handles: absolute vs relative, with/without leading slash, etc.
 * Uses suffix matching — the shorter path must be a suffix of the longer one,
 * aligned on a '/' boundary.
 */
function pathsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  // Ensure the shorter string is a proper path suffix of the longer one
  const long = a.length >= b.length ? a : b;
  const short = a.length >= b.length ? b : a;
  if (!short) return false;
  // Check if long ends with /short or long === short
  return long.endsWith('/' + short) || long === short;
}

/**
 * For a pipeline block file path, find matching graph node IDs.
 * Returns all matching node IDs (there should usually be 0 or 1).
 */
function findNodeIds(
  filePath: string,
  nodeMap: Map<string, any>,
  pathToId: Map<string, string>,
): string[] {
  // Direct match on node ID
  if (nodeMap.has(filePath)) return [filePath];

  // pathToId maps absolute path → relative node ID
  const fromPathMap = pathToId.get(filePath);
  if (fromPathMap && nodeMap.has(fromPathMap)) return [fromPathMap];

  // Suffix match: pipeline file "packages/server/src/foo.ts" should match
  // node ID "packages/server/src/foo.ts" or absolute paths in pathToId
  const matches: string[] = [];
  for (const [id] of nodeMap) {
    if (pathsMatch(id, filePath)) {
      matches.push(id);
      break; // one match is enough
    }
  }
  if (matches.length > 0) return matches;

  // Try reverse: check absolute paths in pathToId
  for (const [absPath, nodeId] of pathToId) {
    if (pathsMatch(absPath, filePath) && nodeMap.has(nodeId)) {
      matches.push(nodeId);
      break;
    }
  }
  return matches;
}

/**
 * Find which block a file path (from an event) belongs to.
 * Event paths may be absolute; pipeline files are relative.
 */
function findBlockForPath(
  eventPath: string,
  blockFiles: Map<string, string>, // pipelineFilePath → blockId
): string | null {
  for (const [pipelineFile, blockId] of blockFiles) {
    if (pathsMatch(eventPath, pipelineFile)) {
      return blockId;
    }
  }
  return null;
}

/**
 * Maps file activity from the graph store onto pipeline blocks.
 * Returns a Map<blockId, BlockActivity> for the given pipeline.
 */
export function usePipelineActivity(
  pipeline: PipelineDefinition | null,
): Map<string, BlockActivity> {
  const nodeMap = useGraphStore((s) => s.nodeMap);
  const pathToId = useGraphStore((s) => s.pathToId);
  const failingFiles = useGraphStore((s) => s.failingFiles);
  const heatTick = useGraphStore((s) => s.heatTick);
  // Use a stable selector — hottestFile is tracked in the store to avoid
  // getSnapshot infinite loop from computing derived values in selectors
  const sessionCurrentFile = useGraphStore((s) => s.hottestFile);
  const events = useEventStore((s) => s.events);

  return useMemo(() => {
    const result = new Map<string, BlockActivity>();
    if (!pipeline) return result;

    // Build file→blockId lookup (full pipeline paths only, no basenames)
    const fileToBlock = new Map<string, string>();
    for (const block of pipeline.blocks) {
      for (const file of block.files) {
        fileToBlock.set(file, block.id);
      }
    }

    // Compute per-block heat from file node heat values
    const blockHeat = new Map<string, number>();
    const blockFailing = new Map<string, boolean>();

    for (const block of pipeline.blocks) {
      let maxHeat = 0;
      let failing = false;

      for (const filePath of block.files) {
        const nodeIds = findNodeIds(filePath, nodeMap, pathToId);
        for (const nodeId of nodeIds) {
          const node = nodeMap.get(nodeId);
          if (node) {
            maxHeat = Math.max(maxHeat, node.heat);
          }
          if (failingFiles.has(nodeId)) {
            failing = true;
          }
        }
      }

      blockHeat.set(block.id, maxHeat);
      blockFailing.set(block.id, failing);
    }

    // Determine spotlight: which block contains the currently hottest file
    let spotlightBlockId: string | null = null;
    if (sessionCurrentFile) {
      // sessionCurrentFile is a node ID (relative path)
      // Need to check if it matches any pipeline block file
      for (const block of pipeline.blocks) {
        for (const filePath of block.files) {
          if (pathsMatch(sessionCurrentFile, filePath)) {
            spotlightBlockId = block.id;
            break;
          }
          // Also resolve pipeline file to node ID and compare
          const nodeIds = findNodeIds(filePath, nodeMap, pathToId);
          if (nodeIds.includes(sessionCurrentFile)) {
            spotlightBlockId = block.id;
            break;
          }
        }
        if (spotlightBlockId) break;
      }
    }

    // Determine indicators from recent events
    const recentEvents = events.slice(-20);
    const blockIndicators = new Map<string, string>();
    for (const event of recentEvents) {
      const filePath = (event as any).data?.path;
      if (!filePath) continue;

      const blockId = findBlockForPath(filePath, fileToBlock);
      if (!blockId) continue;

      switch (event.type) {
        case 'file.read':
          blockIndicators.set(blockId, 'R');
          break;
        case 'file.edit':
          blockIndicators.set(blockId, 'E');
          break;
        case 'file.create':
          blockIndicators.set(blockId, '+');
          break;
        case 'file.delete':
          blockIndicators.set(blockId, 'x');
          break;
      }
    }

    // Build final result
    for (const block of pipeline.blocks) {
      const heat = blockHeat.get(block.id) ?? 0;
      const isFailing = blockFailing.get(block.id) ?? false;
      const indicator = blockIndicators.get(block.id);
      const isSpotlight = block.id === spotlightBlockId;

      result.set(block.id, {
        heat,
        isSpotlight,
        indicator,
        isFailing,
      });
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline, nodeMap, pathToId, failingFiles, sessionCurrentFile, events.length, heatTick]);
}

/**
 * Lightweight hook that computes per-pipeline activity summary for all pipelines.
 * Used to highlight tabs that have activity even when not selected.
 */
export function useAllPipelinesActivity(
  pipelines: PipelineDefinition[],
): Map<string, PipelineTabActivity> {
  const nodeMap = useGraphStore((s) => s.nodeMap);
  const pathToId = useGraphStore((s) => s.pathToId);
  const failingFiles = useGraphStore((s) => s.failingFiles);
  const heatTick = useGraphStore((s) => s.heatTick);
  const events = useEventStore((s) => s.events);

  return useMemo(() => {
    const result = new Map<string, PipelineTabActivity>();

    // Collect recent edit/create paths from events
    const recentEvents = events.slice(-20);
    const recentEditPaths = new Set<string>();
    for (const event of recentEvents) {
      if (event.type === 'file.edit' || event.type === 'file.create') {
        const p = (event as any).data?.path;
        if (p) recentEditPaths.add(p);
      }
    }

    for (const pipeline of pipelines) {
      let maxHeat = 0;
      let hasEdits = false;
      let hasFailing = false;

      for (const block of pipeline.blocks) {
        for (const filePath of block.files) {
          // Check heat from graph nodes using robust matching
          const nodeIds = findNodeIds(filePath, nodeMap, pathToId);
          for (const nodeId of nodeIds) {
            const node = nodeMap.get(nodeId);
            if (node) maxHeat = Math.max(maxHeat, node.heat);
            if (failingFiles.has(nodeId)) hasFailing = true;
          }

          // Check recent edits against this file using suffix matching
          for (const editPath of recentEditPaths) {
            if (pathsMatch(editPath, filePath)) {
              hasEdits = true;
            }
          }
        }
      }

      result.set(pipeline.id, {
        hasActivity: maxHeat > 0,
        maxHeat,
        hasEdits,
        hasFailing,
      });
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelines, nodeMap, pathToId, failingFiles, events.length, heatTick]);
}
