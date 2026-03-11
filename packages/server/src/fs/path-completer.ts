import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { existsSync } from 'node:fs';

export interface PathSuggestion {
  path: string;
  name: string;
  isDirectory: boolean;
  /** True if this directory contains a .git folder (is a project root) */
  isGitRepo?: boolean;
}

/**
 * Expand ~ to home directory and resolve the path.
 */
function expandPath(input: string): string {
  if (input.startsWith('~')) {
    return join(homedir(), input.slice(1));
  }
  return resolve(input);
}

/**
 * Complete a partial filesystem path — returns matching directories.
 * Works like terminal tab-completion:
 *   "/Users/ido/Des"  → ["/Users/ido/Desktop"]
 *   "/Users/ido/Desktop/"  → ["/Users/ido/Desktop/Projects", ...]
 */
export async function completePath(partial: string): Promise<PathSuggestion[]> {
  if (!partial) {
    return listDirectory(homedir());
  }

  const expanded = expandPath(partial);

  // If path ends with / — list contents of that directory
  if (partial.endsWith('/')) {
    if (existsSync(expanded)) {
      return listDirectory(expanded);
    }
    return [];
  }

  // Otherwise — list parent directory and filter by prefix
  const dir = dirname(expanded);
  const prefix = basename(expanded).toLowerCase();

  if (!existsSync(dir)) return [];

  const entries = await listDirectory(dir);
  return entries.filter((e) => e.name.toLowerCase().startsWith(prefix));
}

/**
 * List directories in a given path (excludes hidden dirs and files).
 */
async function listDirectory(dirPath: string): Promise<PathSuggestion[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const results: PathSuggestion[] = [];

    for (const entry of entries) {
      // Skip hidden directories and files
      if (entry.name.startsWith('.')) continue;
      // Only show directories (we're picking a project folder)
      if (!entry.isDirectory()) continue;

      const fullPath = join(dirPath, entry.name);
      const isGitRepo = existsSync(join(fullPath, '.git'));

      results.push({
        path: fullPath,
        name: entry.name,
        isDirectory: true,
        isGitRepo,
      });
    }

    // Sort: git repos first, then alphabetically
    results.sort((a, b) => {
      if (a.isGitRepo && !b.isGitRepo) return -1;
      if (!a.isGitRepo && b.isGitRepo) return 1;
      return a.name.localeCompare(b.name);
    });

    return results;
  } catch {
    return [];
  }
}

/**
 * Scan common locations for project directories (git repos).
 * Returns directories that contain a .git folder.
 */
export async function scanRecentProjects(pastProjectPaths: string[]): Promise<PathSuggestion[]> {
  const seen = new Set<string>();
  const results: PathSuggestion[] = [];

  // 1. Past sessions (most relevant)
  for (const p of pastProjectPaths) {
    if (seen.has(p)) continue;
    seen.add(p);
    if (existsSync(p)) {
      const isGitRepo = existsSync(join(p, '.git'));
      results.push({
        path: p,
        name: basename(p),
        isDirectory: true,
        isGitRepo,
      });
    }
  }

  // 2. Scan common project directories (1 level deep)
  const home = homedir();
  const commonDirs = [
    join(home, 'Desktop', 'Projects'),
    join(home, 'Desktop'),
    join(home, 'Projects'),
    join(home, 'code'),
    join(home, 'Code'),
    join(home, 'dev'),
    join(home, 'Developer'),
    join(home, 'repos'),
    join(home, 'src'),
    join(home, 'workspace'),
    join(home, 'work'),
  ];

  for (const dir of commonDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const fullPath = join(dir, entry.name);
        if (seen.has(fullPath)) continue;
        seen.add(fullPath);
        const isGitRepo = existsSync(join(fullPath, '.git'));
        if (isGitRepo) {
          results.push({
            path: fullPath,
            name: entry.name,
            isDirectory: true,
            isGitRepo: true,
          });
        }
      }
    } catch {
      // Skip unreadable dirs
    }
  }

  return results;
}
