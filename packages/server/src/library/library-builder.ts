import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { CodebaseGraph, FileCard, LibraryBuildProgress, LibraryManifest, ModuleShelf, ProjectOverview } from '@hudai/shared';
import { loadManifest, saveManifest, findStaleFiles, getLibraryDir } from './library-cache.js';
import { FileCardBuilder } from './file-card-builder.js';
import { ModuleShelfBuilder, identifyModules } from './module-shelf-builder.js';
import { OverviewBuilder } from './overview-builder.js';
import { generateMarkdown } from './library-markdown.js';
import type { LLMClient } from '../llm/llm-provider.js';

export type LibraryProgressCallback = (progress: LibraryBuildProgress) => void;

export interface LibraryBuildResult {
  manifest: LibraryManifest;
  fromCache: boolean;
}

export class LibraryBuilder {
  private fileCardBuilder: FileCardBuilder;
  private moduleShelfBuilder: ModuleShelfBuilder;
  private overviewBuilder: OverviewBuilder;

  constructor(llm: LLMClient) {
    this.fileCardBuilder = new FileCardBuilder(llm);
    this.moduleShelfBuilder = new ModuleShelfBuilder(llm);
    this.overviewBuilder = new OverviewBuilder(llm);
  }

  async build(
    rootDir: string,
    graph: CodebaseGraph,
    onProgress?: LibraryProgressCallback,
  ): Promise<LibraryBuildResult> {
    // 1. Gather current file mtimes
    const currentFiles = await this.gatherFileMtimes(rootDir, graph);

    // 2. Load cached manifest
    const cached = await loadManifest(rootDir);

    if (cached) {
      const staleness = await findStaleFiles(cached, currentFiles);
      const totalStale = staleness.changed.length + staleness.added.length + staleness.removed.length;

      if (totalStale === 0) {
        console.log('[library] Full cache hit — using cached library');
        return { manifest: cached, fromCache: true };
      }

      console.log(`[library] Cache stale — ${staleness.changed.length} changed, ${staleness.added.length} added, ${staleness.removed.length} removed`);

      // Incremental rebuild
      return this.incrementalBuild(rootDir, graph, cached, staleness, currentFiles, onProgress);
    }

    // 3. Full build
    console.log('[library] No cache — full build');
    return this.fullBuild(rootDir, graph, currentFiles, onProgress);
  }

  private async fullBuild(
    rootDir: string,
    graph: CodebaseGraph,
    currentFiles: { filePath: string; mtimeMs: number }[],
    onProgress?: LibraryProgressCallback,
  ): Promise<LibraryBuildResult> {
    const allFilePaths = currentFiles.map(f => f.filePath);
    const mtimeMap = new Map(currentFiles.map(f => [f.filePath, f.mtimeMs]));

    // Phase 1: File cards
    onProgress?.({ phase: 'file-cards', current: 0, total: allFilePaths.length, label: 'Analyzing files...' });
    const fileCards = await this.fileCardBuilder.build(rootDir, allFilePaths, (cur, tot) => {
      onProgress?.({ phase: 'file-cards', current: cur, total: tot, label: `Analyzing files (${cur}/${tot})...` });
    });

    // Stamp mtimes
    for (const card of fileCards) {
      card.mtimeMs = mtimeMap.get(card.filePath) ?? 0;
    }

    const fileCardMap = new Map(fileCards.map(c => [c.filePath, c]));

    // Phase 2: Module shelves
    const modules = identifyModules(graph);
    onProgress?.({ phase: 'module-shelves', current: 0, total: modules.length, label: 'Building module summaries...' });
    const shelves = await this.moduleShelfBuilder.build(modules, fileCardMap, graph, (cur, tot) => {
      onProgress?.({ phase: 'module-shelves', current: cur, total: tot, label: `Building module summaries (${cur}/${tot})...` });
    });

    // Phase 3: Overview
    onProgress?.({ phase: 'overview', current: 0, total: 1, label: 'Generating project overview...' });
    const directoryTree = this.buildDirectoryTree(graph);
    const overview = await this.overviewBuilder.build(rootDir, shelves, directoryTree);
    onProgress?.({ phase: 'overview', current: 1, total: 1, label: 'Project overview complete' });

    // Phase 4: Save + markdown
    onProgress?.({ phase: 'markdown', current: 0, total: 1, label: 'Writing library files...' });
    const fileMtimes: Record<string, number> = {};
    for (const f of currentFiles) {
      fileMtimes[f.filePath] = f.mtimeMs;
    }

    const manifest: LibraryManifest = {
      version: 1,
      generatedAt: Date.now(),
      projectRoot: rootDir,
      overview,
      modules: shelves,
      fileMtimes,
    };

    await saveManifest(rootDir, manifest);
    await generateMarkdown(getLibraryDir(rootDir), manifest);
    onProgress?.({ phase: 'markdown', current: 1, total: 1, label: 'Library ready' });

    const totalCards = shelves.reduce((sum, m) => sum + m.fileCards.length, 0);
    console.log(`[library] Built ${shelves.length} modules, ${totalCards} file cards`);

    return { manifest, fromCache: false };
  }

  private async incrementalBuild(
    rootDir: string,
    graph: CodebaseGraph,
    cached: LibraryManifest,
    staleness: { changed: string[]; added: string[]; removed: string[] },
    currentFiles: { filePath: string; mtimeMs: number }[],
    onProgress?: LibraryProgressCallback,
  ): Promise<LibraryBuildResult> {
    const mtimeMap = new Map(currentFiles.map(f => [f.filePath, f.mtimeMs]));

    // Phase 1: Rebuild file cards for changed + added files
    const staleFiles = [...staleness.changed, ...staleness.added];
    onProgress?.({ phase: 'file-cards', current: 0, total: staleFiles.length, label: `Updating ${staleFiles.length} files...` });

    const newCards = await this.fileCardBuilder.build(rootDir, staleFiles, (cur, tot) => {
      onProgress?.({ phase: 'file-cards', current: cur, total: tot, label: `Updating files (${cur}/${tot})...` });
    });

    // Stamp mtimes
    for (const card of newCards) {
      card.mtimeMs = mtimeMap.get(card.filePath) ?? 0;
    }

    // Merge: keep existing cards for unchanged files, replace/add new ones
    const fileCardMap = new Map<string, FileCard>();
    for (const mod of cached.modules) {
      for (const card of mod.fileCards) {
        if (!staleness.removed.includes(card.filePath) && !staleness.changed.includes(card.filePath)) {
          fileCardMap.set(card.filePath, card);
        }
      }
    }
    for (const card of newCards) {
      fileCardMap.set(card.filePath, card);
    }

    // Phase 2: Rebuild module shelves for affected modules
    const affectedFiles = new Set([...staleness.changed, ...staleness.added, ...staleness.removed]);
    const modules = identifyModules(graph);

    const affectedModules = modules.filter(m =>
      m.filePaths.some(fp => affectedFiles.has(fp))
    );
    const unaffectedSlugs = new Set(
      modules.filter(m => !m.filePaths.some(fp => affectedFiles.has(fp))).map(m => m.slug)
    );

    // Keep cached shelves for unaffected modules
    const cachedShelfMap = new Map(cached.modules.map(m => [m.slug, m]));

    onProgress?.({ phase: 'module-shelves', current: 0, total: affectedModules.length, label: `Rebuilding ${affectedModules.length} modules...` });
    const rebuiltShelves = await this.moduleShelfBuilder.build(affectedModules, fileCardMap, graph, (cur, tot) => {
      onProgress?.({ phase: 'module-shelves', current: cur, total: tot, label: `Rebuilding modules (${cur}/${tot})...` });
    });

    // Merge shelves: unaffected from cache, affected from rebuild
    const allShelves: ModuleShelf[] = [];
    for (const mod of modules) {
      if (unaffectedSlugs.has(mod.slug) && cachedShelfMap.has(mod.slug)) {
        allShelves.push(cachedShelfMap.get(mod.slug)!);
      } else {
        const rebuilt = rebuiltShelves.find(s => s.slug === mod.slug);
        if (rebuilt) allShelves.push(rebuilt);
      }
    }

    // Phase 3: Smart overview rebuild based on change scope
    const directoryTree = this.buildDirectoryTree(graph);
    const affectedModuleSlugs = affectedModules.map(m => m.slug);
    const affectedRatio = affectedModules.length / Math.max(modules.length, 1);

    let overview;
    if (affectedModules.length === 0) {
      // No module structure changes — reuse cached overview entirely
      console.log('[library] Overview unchanged — reusing cached overview');
      overview = cached.overview;
    } else if (affectedRatio <= 0.5) {
      // ≤50% modules changed — incremental overview update
      onProgress?.({ phase: 'overview', current: 0, total: 1, label: 'Updating project overview...' });
      console.log(`[library] Incremental overview update (${affectedModules.length}/${modules.length} modules changed)`);
      overview = await this.overviewBuilder.buildIncremental(
        rootDir,
        cached.overview,
        allShelves,
        affectedModuleSlugs,
        directoryTree,
      );
      onProgress?.({ phase: 'overview', current: 1, total: 1, label: 'Project overview complete' });
    } else {
      // >50% modules changed — full overview rebuild
      onProgress?.({ phase: 'overview', current: 0, total: 1, label: 'Regenerating project overview...' });
      console.log(`[library] Full overview rebuild (${affectedModules.length}/${modules.length} modules changed)`);
      overview = await this.overviewBuilder.build(rootDir, allShelves, directoryTree);
      onProgress?.({ phase: 'overview', current: 1, total: 1, label: 'Project overview complete' });
    }

    // Phase 4: Save + markdown
    onProgress?.({ phase: 'markdown', current: 0, total: 1, label: 'Writing library files...' });
    const fileMtimes: Record<string, number> = {};
    for (const f of currentFiles) {
      fileMtimes[f.filePath] = f.mtimeMs;
    }

    const manifest: LibraryManifest = {
      version: 1,
      generatedAt: Date.now(),
      projectRoot: rootDir,
      overview,
      modules: allShelves,
      fileMtimes,
    };

    await saveManifest(rootDir, manifest);
    await generateMarkdown(getLibraryDir(rootDir), manifest);
    onProgress?.({ phase: 'markdown', current: 1, total: 1, label: 'Library ready' });

    const totalCards = allShelves.reduce((sum, m) => sum + m.fileCards.length, 0);
    console.log(`[library] Incremental rebuild: ${allShelves.length} modules, ${totalCards} file cards (${staleFiles.length} files updated)`);

    return { manifest, fromCache: false };
  }

  private async gatherFileMtimes(
    rootDir: string,
    graph: CodebaseGraph,
  ): Promise<{ filePath: string; mtimeMs: number }[]> {
    const results: { filePath: string; mtimeMs: number }[] = [];

    for (const node of graph.nodes) {
      try {
        const fullPath = path.join(rootDir, node.id);
        const s = await stat(fullPath);
        results.push({ filePath: node.id, mtimeMs: s.mtimeMs });
      } catch {
        // File might not exist
      }
    }

    return results;
  }

  private buildDirectoryTree(graph: CodebaseGraph): string {
    // Build a simple directory tree from graph nodes
    const dirs = new Set<string>();
    for (const node of graph.nodes) {
      const parts = node.group.split('/');
      for (let i = 1; i <= parts.length; i++) {
        dirs.add(parts.slice(0, i).join('/'));
      }
    }

    const sorted = [...dirs].sort();
    const lines: string[] = [];
    for (const dir of sorted) {
      const depth = dir.split('/').length - 1;
      const indent = '  '.repeat(depth);
      const name = dir.split('/').pop() ?? dir;
      const fileCount = graph.nodes.filter(n => n.group === dir).length;
      const suffix = fileCount > 0 ? ` (${fileCount} files)` : '';
      lines.push(`${indent}${name}/${suffix}`);
    }

    return lines.join('\n');
  }
}
