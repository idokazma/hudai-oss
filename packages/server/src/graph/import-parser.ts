import { init, parse } from 'es-module-lexer';
import { readFile } from 'fs/promises';
import path from 'path';
import type { DependencyEdge, FileNode } from '@hudai/shared';

const PARSEABLE = new Set(['.ts', '.tsx', '.js', '.jsx']);

export async function parseImports(
  nodes: FileNode[],
  rootDir: string,
): Promise<DependencyEdge[]> {
  await init;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: DependencyEdge[] = [];

  for (const node of nodes) {
    if (!PARSEABLE.has(node.extension)) continue;

    try {
      const code = await readFile(node.path, 'utf-8');
      const [imports] = parse(code);

      for (const imp of imports) {
        if (!imp.n || !imp.n.startsWith('.')) continue;
        const resolved = resolveImport(imp.n, node.id, nodeIds);
        if (resolved) {
          edges.push({ source: node.id, target: resolved, type: 'import' });
        }
      }
    } catch {
      // Skip unparseable files
    }
  }

  return edges;
}

function resolveImport(
  specifier: string,
  fromId: string,
  nodeIds: Set<string>,
): string | null {
  const dir = path.dirname(fromId);
  const base = path.join(dir, specifier).replace(/\\/g, '/');

  const candidates = [
    base,
    base + '.ts',
    base + '.tsx',
    base + '.js',
    base + '.jsx',
    base + '/index.ts',
    base + '/index.js',
  ];

  // Handle .js → .ts remapping (common in ESM TypeScript)
  if (base.endsWith('.js')) {
    const tsBase = base.slice(0, -3);
    candidates.push(tsBase + '.ts', tsBase + '.tsx');
  }

  for (const c of candidates) {
    const normalized = path.normalize(c).replace(/\\/g, '/');
    if (nodeIds.has(normalized)) return normalized;
  }

  return null;
}
