import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PipelineDefinition } from '@hudai/shared';
import { projectDir } from '../persistence/data-dir.js';

const CACHE_FILE = 'pipeline-cache.json';

export interface PipelineCache {
  version: 1;
  generatedAt: number;
  projectRoot: string;
  fileMtimes: Record<string, number>;
  pipelines: PipelineDefinition[];
}

export interface PipelineStaleness {
  changed: string[];
  added: string[];
  removed: string[];
}

function cachePath(rootDir: string): string {
  return path.join(projectDir(rootDir), CACHE_FILE);
}

export async function loadCache(rootDir: string): Promise<PipelineCache | null> {
  try {
    const raw = await readFile(cachePath(rootDir), 'utf-8');
    const cache: PipelineCache = JSON.parse(raw);
    if (cache.version !== 1) return null;
    return cache;
  } catch {
    return null;
  }
}

export async function saveCache(
  rootDir: string,
  pipelines: PipelineDefinition[],
  files: string[],
): Promise<void> {
  const mtimes: Record<string, number> = {};

  for (const f of files) {
    try {
      const s = await stat(path.join(rootDir, f));
      mtimes[f] = s.mtimeMs;
    } catch {
      // File may not exist — skip
    }
  }

  const cache: PipelineCache = {
    version: 1,
    generatedAt: Date.now(),
    projectRoot: rootDir,
    fileMtimes: mtimes,
    pipelines,
  };

  await writeFile(cachePath(rootDir), JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * Check which files referenced in the cache have changed since generation.
 * Also detects newly added files (in graph but not in cache) and removed files.
 */
export async function findStaleFiles(
  cache: PipelineCache,
  rootDir: string,
  allGraphFiles?: string[],
): Promise<PipelineStaleness> {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  const cachedSet = new Set(Object.keys(cache.fileMtimes));

  // Check cached files for changes / deletions
  for (const [file, cachedMtime] of Object.entries(cache.fileMtimes)) {
    try {
      const s = await stat(path.join(rootDir, file));
      if (s.mtimeMs > cachedMtime) {
        changed.push(file);
      }
    } catch {
      // File deleted — counts as removed
      removed.push(file);
    }
  }

  // Detect newly added files (in graph but not tracked in cache)
  if (allGraphFiles) {
    for (const file of allGraphFiles) {
      if (!cachedSet.has(file)) {
        added.push(file);
      }
    }
  }

  return { changed, added, removed };
}

/**
 * Given a staleness result, find which pipeline IDs are affected
 * (i.e., contain blocks that reference any of the changed/added/removed files).
 */
export function findAffectedPipelines(
  pipelines: PipelineDefinition[],
  staleness: PipelineStaleness,
): string[] {
  const staleFiles = new Set([
    ...staleness.changed,
    ...staleness.added,
    ...staleness.removed,
  ]);

  const affected: string[] = [];
  for (const pipeline of pipelines) {
    const isAffected = pipeline.blocks.some(block =>
      block.files.some(f => staleFiles.has(f))
    );
    if (isAffected) {
      affected.push(pipeline.id);
    }
  }

  return affected;
}
