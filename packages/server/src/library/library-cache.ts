import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LibraryManifest } from '@hudai/shared';
import { projectDir } from '../persistence/data-dir.js';

function libraryDir(rootDir: string): string {
  return path.join(projectDir(rootDir), 'library');
}

function manifestPath(rootDir: string): string {
  return path.join(libraryDir(rootDir), 'manifest.json');
}

export function getLibraryDir(rootDir: string): string {
  return libraryDir(rootDir);
}

export async function loadManifest(rootDir: string): Promise<LibraryManifest | null> {
  try {
    const raw = await readFile(manifestPath(rootDir), 'utf-8');
    const manifest: LibraryManifest = JSON.parse(raw);
    if (manifest.version !== 1) return null;
    return manifest;
  } catch {
    return null;
  }
}

export async function saveManifest(rootDir: string, manifest: LibraryManifest): Promise<void> {
  const dir = libraryDir(rootDir);
  await mkdir(dir, { recursive: true });
  await writeFile(manifestPath(rootDir), JSON.stringify(manifest, null, 2), 'utf-8');
}

export interface StalenessResult {
  changed: string[];
  added: string[];
  removed: string[];
}

/**
 * Compare cached file mtimes against current files on disk.
 * Returns which files need to be re-analyzed.
 */
export async function findStaleFiles(
  manifest: LibraryManifest,
  currentFiles: { filePath: string; mtimeMs: number }[],
): Promise<StalenessResult> {
  const cachedMtimes = manifest.fileMtimes;
  const currentMap = new Map(currentFiles.map(f => [f.filePath, f.mtimeMs]));
  const cachedSet = new Set(Object.keys(cachedMtimes));
  const currentSet = new Set(currentFiles.map(f => f.filePath));

  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  // Files that exist in both but have changed mtime
  for (const [filePath, mtime] of currentMap) {
    if (cachedSet.has(filePath)) {
      if (mtime > (cachedMtimes[filePath] ?? 0)) {
        changed.push(filePath);
      }
    } else {
      added.push(filePath);
    }
  }

  // Files in cache but no longer on disk
  for (const filePath of cachedSet) {
    if (!currentSet.has(filePath)) {
      removed.push(filePath);
    }
  }

  return { changed, added, removed };
}
