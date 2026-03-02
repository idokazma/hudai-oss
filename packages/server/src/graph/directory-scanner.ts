import { readdir, stat } from 'fs/promises';
import path from 'path';
import type { FileNode } from '@hudai/shared';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.turbo', '__pycache__', '.hudai',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md',
  '.css', '.scss', '.html', '.py', '.go', '.rs',
  '.yaml', '.yml', '.toml', '.sh', '.sql', '.graphql',
]);

export async function scanDirectory(rootDir: string): Promise<FileNode[]> {
  const entries = await readdir(rootDir, { recursive: true, withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const parentPath = (entry as any).parentPath ?? (entry as any).path ?? rootDir;
    const fullPath = path.join(parentPath, entry.name);
    const relativePath = path.relative(rootDir, fullPath);

    // Skip filtered directories
    const parts = relativePath.split(path.sep);
    if (parts.some(p => SKIP_DIRS.has(p) || (p.startsWith('.') && p.length > 1))) continue;

    const ext = path.extname(entry.name);
    if (!CODE_EXTENSIONS.has(ext)) continue;

    try {
      const fileStat = await stat(fullPath);
      nodes.push({
        id: relativePath,
        path: fullPath,
        label: entry.name,
        group: path.dirname(relativePath),
        extension: ext,
        size: fileStat.size,
        heat: 0,
        visited: false,
        modified: false,
      });
    } catch {
      // Skip files we can't stat
    }
  }

  return nodes;
}
