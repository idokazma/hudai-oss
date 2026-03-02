import type { CodebaseGraph, FileCard, ModuleShelf } from '@hudai/shared';
import { buildModuleShelfPrompt } from './library-prompts.js';
import type { ProgressCallback } from './file-card-builder.js';
import type { LLMClient } from '../llm/llm-provider.js';

interface ModuleDefinition {
  slug: string;
  name: string;
  dirPrefix: string;
  filePaths: string[];
}

/**
 * Identify logical modules from the codebase graph.
 * Uses architecture containers for top-level grouping,
 * and subdirectories with 3+ files become sub-modules.
 */
export function identifyModules(graph: CodebaseGraph): ModuleDefinition[] {
  const modules: ModuleDefinition[] = [];
  const containers = graph.architecture?.containers ?? [];

  if (containers.length > 0) {
    // Use architecture containers as top-level modules
    for (const container of containers) {
      if (container.id === '__root__') continue;

      // Collect all files in this container
      const containerFiles = graph.nodes.filter(n =>
        container.groups.some(g => n.group === g || n.group.startsWith(g + '/'))
      );

      if (containerFiles.length === 0) continue;

      // Check for sub-modules: directories with 3+ files under this container
      const subDirs = new Map<string, string[]>();
      for (const node of containerFiles) {
        // Get directory relative to container prefix
        const relGroup = node.group;
        // Find a meaningful sub-directory depth (e.g., packages/server/src/parser)
        const parts = relGroup.split('/');
        // Use depth 3 or 4 as sub-module boundary depending on nesting
        const subModuleDepth = Math.min(parts.length, container.id.split('/').length + 2);
        const subDir = parts.slice(0, subModuleDepth).join('/');

        if (!subDirs.has(subDir)) subDirs.set(subDir, []);
        subDirs.get(subDir)!.push(node.id);
      }

      // If container has enough sub-directories with 3+ files, split into sub-modules
      const significantSubDirs = [...subDirs.entries()].filter(([, files]) => files.length >= 3);

      if (significantSubDirs.length > 1) {
        // Create sub-modules
        for (const [subDir, files] of significantSubDirs) {
          const slug = subDir.replace(/\//g, '--');
          const nameParts = subDir.split('/');
          const name = nameParts[nameParts.length - 1]
            .split(/[-_]/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');

          modules.push({
            slug,
            name,
            dirPrefix: subDir,
            filePaths: files,
          });
        }

        // Remaining files in the container not covered by sub-modules
        const coveredFiles = new Set(significantSubDirs.flatMap(([, files]) => files));
        const remaining = containerFiles.filter(n => !coveredFiles.has(n.id));
        if (remaining.length > 0) {
          const slug = container.id.replace(/\//g, '--');
          modules.push({
            slug: slug + '--other',
            name: (container.label ?? container.id) + ' (Other)',
            dirPrefix: container.id,
            filePaths: remaining.map(n => n.id),
          });
        }
      } else {
        // Single module for the whole container
        const slug = container.id.replace(/\//g, '--');
        modules.push({
          slug,
          name: container.label ?? container.id,
          dirPrefix: container.id,
          filePaths: containerFiles.map(n => n.id),
        });
      }
    }
  } else {
    // No architecture containers — fall back to top-level directories
    const topDirs = new Map<string, string[]>();
    for (const node of graph.nodes) {
      const topDir = node.group === '.' ? '.' : node.group.split('/')[0];
      if (!topDirs.has(topDir)) topDirs.set(topDir, []);
      topDirs.get(topDir)!.push(node.id);
    }
    for (const [dir, files] of topDirs) {
      const slug = dir === '.' ? 'root' : dir.replace(/\//g, '--');
      modules.push({
        slug,
        name: dir === '.' ? 'Root' : dir.charAt(0).toUpperCase() + dir.slice(1),
        dirPrefix: dir,
        filePaths: files,
      });
    }
  }

  return modules;
}

export class ModuleShelfBuilder {
  constructor(private llm: LLMClient) {}

  /**
   * Build module shelves from identified modules and their file cards.
   */
  async build(
    modules: ModuleDefinition[],
    fileCardMap: Map<string, FileCard>,
    graph: CodebaseGraph,
    onProgress?: ProgressCallback,
  ): Promise<ModuleShelf[]> {
    const shelves: ModuleShelf[] = [];
    const total = modules.length;

    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      const cards = mod.filePaths
        .map(fp => fileCardMap.get(fp))
        .filter((c): c is FileCard => c != null);

      if (cards.length === 0) {
        onProgress?.(i + 1, total);
        continue;
      }

      // Find cross-module dependency edges
      const modFilePaths = new Set(mod.filePaths);
      const depEdges: { from: string; to: string }[] = [];
      for (const edge of graph.edges) {
        if (modFilePaths.has(edge.source) && !modFilePaths.has(edge.target)) {
          depEdges.push({ from: edge.source, to: edge.target });
        }
      }

      try {
        const prompt = buildModuleShelfPrompt(mod.name, mod.dirPrefix, cards, depEdges);
        const responseText = await this.llm.generate(prompt + '\n\nRespond with valid JSON only.');

        let jsonText = responseText.trim();
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        const parsed = JSON.parse(jsonText);

        shelves.push({
          slug: mod.slug,
          name: parsed.name ?? mod.name,
          dirPrefix: mod.dirPrefix,
          purpose: parsed.purpose ?? '',
          patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
          publicApi: Array.isArray(parsed.publicApi) ? parsed.publicApi.map((a: any) => ({
            name: a.name ?? '',
            filePath: a.filePath ?? '',
            kind: a.kind ?? 'other',
          })) : [],
          dependsOn: Array.isArray(parsed.dependsOn) ? parsed.dependsOn : [],
          fileCards: cards,
        });
      } catch (err) {
        console.error(`[library] Failed to build module shelf for ${mod.name}:`, err);
        // Create a basic shelf without LLM analysis
        shelves.push({
          slug: mod.slug,
          name: mod.name,
          dirPrefix: mod.dirPrefix,
          purpose: `Module at ${mod.dirPrefix} with ${cards.length} files`,
          patterns: [],
          publicApi: [],
          dependsOn: [],
          fileCards: cards,
        });
      }

      onProgress?.(i + 1, total);
    }

    return shelves;
  }
}
