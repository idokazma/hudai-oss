import { stat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { scanDirectory } from './directory-scanner.js';
import { parseImports } from './import-parser.js';
import type { CodebaseGraph, FileNode, ArchitectureLayer, ArchContainer, ContainerRelationship } from '@hudai/shared';

export class GraphBuilder {
  private graph: CodebaseGraph = { nodes: [], edges: [] };
  private nodeMap = new Map<string, FileNode>();
  private _rootDir = '';

  get rootDir(): string {
    return this._rootDir;
  }

  async build(rootDir: string): Promise<CodebaseGraph> {
    this._rootDir = rootDir;
    console.log(`[graph] Scanning ${rootDir}...`);

    const nodes = await scanDirectory(rootDir);
    console.log(`[graph] Found ${nodes.length} files`);

    const edges = await parseImports(nodes, rootDir);
    console.log(`[graph] Found ${edges.length} import edges`);

    this.nodeMap.clear();
    for (const n of nodes) this.nodeMap.set(n.id, n);

    const architecture = await this.detectArchitecture(rootDir, nodes, edges);
    this.graph = { nodes, edges, architecture };
    return this.graph;
  }

  getGraph(): CodebaseGraph {
    return this.graph;
  }

  /**
   * Auto-detect architectural containers from project structure.
   * Looks for monorepo packages/, apps/, services/ dirs,
   * or falls back to top-level source directories.
   */
  private async detectArchitecture(
    rootDir: string,
    nodes: FileNode[],
    edges: { source: string; target: string }[],
  ): Promise<ArchitectureLayer> {
    const containers: ArchContainer[] = [];
    const relationships: ContainerRelationship[] = [];

    // Collect all top-level groups from file nodes
    const topLevelGroups = new Set<string>();
    for (const n of nodes) {
      if (n.group === '.') continue;
      topLevelGroups.add(n.group.split('/')[0]);
    }

    // Try monorepo: packages/*, apps/*, services/*
    const monoDirs = ['packages', 'apps', 'services'];
    let foundMono = false;
    for (const monoDir of monoDirs) {
      if (!topLevelGroups.has(monoDir)) continue;
      try {
        const entries = await readdir(path.join(rootDir, monoDir), { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const groupPrefix = `${monoDir}/${entry.name}`;
          // Check that files actually exist under this directory
          const hasFiles = nodes.some(n => n.group === groupPrefix || n.group.startsWith(groupPrefix + '/'));
          if (!hasFiles) continue;

          const tech = await this.detectTechnology(path.join(rootDir, monoDir, entry.name));
          const allGroups = this.collectGroups(groupPrefix, nodes);
          containers.push({
            id: groupPrefix,
            label: this.formatLabel(entry.name),
            technology: tech,
            groups: allGroups,
          });
          foundMono = true;
        }
      } catch { /* dir doesn't exist */ }
    }

    // Fallback: use top-level directories as containers
    if (!foundMono) {
      for (const topGroup of topLevelGroups) {
        const hasFiles = nodes.some(n => n.group === topGroup || n.group.startsWith(topGroup + '/'));
        if (!hasFiles) continue;
        const tech = await this.detectTechnology(path.join(rootDir, topGroup));
        const allGroups = this.collectGroups(topGroup, nodes);
        containers.push({
          id: topGroup,
          label: this.formatLabel(topGroup),
          technology: tech,
          groups: allGroups,
        });
      }
    }

    // Root-level files get their own container if they exist
    const rootFiles = nodes.filter(n => n.group === '.');
    if (rootFiles.length > 0) {
      containers.push({
        id: '__root__',
        label: 'Root',
        groups: ['.'],
      });
    }

    // Detect cross-container relationships from import edges
    const groupToContainer = new Map<string, string>();
    for (const c of containers) {
      for (const g of c.groups) {
        groupToContainer.set(g, c.id);
      }
    }
    // Build file-to-container lookup
    const fileToContainer = new Map<string, string>();
    for (const n of nodes) {
      // Walk up group hierarchy to find matching container
      const parts = n.group.split('/');
      for (let i = parts.length; i >= 1; i--) {
        const prefix = parts.slice(0, i).join('/');
        if (groupToContainer.has(prefix)) {
          fileToContainer.set(n.id, groupToContainer.get(prefix)!);
          break;
        }
      }
      if (!fileToContainer.has(n.id) && n.group === '.') {
        fileToContainer.set(n.id, '__root__');
      }
    }

    // Aggregate cross-container edges
    const relSet = new Map<string, { source: string; target: string; count: number }>();
    for (const e of edges) {
      const sc = fileToContainer.get(e.source);
      const tc = fileToContainer.get(e.target);
      if (!sc || !tc || sc === tc) continue;
      const key = `${sc}→${tc}`;
      const existing = relSet.get(key);
      if (existing) {
        existing.count++;
      } else {
        relSet.set(key, { source: sc, target: tc, count: 1 });
      }
    }
    for (const rel of relSet.values()) {
      relationships.push({
        source: rel.source,
        target: rel.target,
        label: `${rel.count} import${rel.count > 1 ? 's' : ''}`,
      });
    }

    return { containers, relationships };
  }

  private collectGroups(prefix: string, nodes: FileNode[]): string[] {
    const groups = new Set<string>();
    groups.add(prefix);
    for (const n of nodes) {
      if (n.group === prefix || n.group.startsWith(prefix + '/')) {
        groups.add(n.group);
      }
    }
    return [...groups];
  }

  private formatLabel(name: string): string {
    // "server" → "Server", "my-app" → "My App"
    return name
      .split(/[-_]/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private async detectTechnology(dir: string): Promise<string | undefined> {
    try {
      const raw = await readFile(path.join(dir, 'package.json'), 'utf-8');
      const pkg = JSON.parse(raw);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const techs: string[] = [];
      if (allDeps['react'] || allDeps['react-dom']) techs.push('React');
      if (allDeps['vue']) techs.push('Vue');
      if (allDeps['svelte']) techs.push('Svelte');
      if (allDeps['fastify']) techs.push('Fastify');
      if (allDeps['express']) techs.push('Express');
      if (allDeps['next']) techs.push('Next.js');
      if (allDeps['vite']) techs.push('Vite');
      if (allDeps['better-sqlite3'] || allDeps['pg'] || allDeps['mysql2']) techs.push('Database');
      if (allDeps['typescript']) techs.push('TypeScript');
      if (techs.length === 0 && pkg.types) techs.push('TypeScript Types');
      return techs.length > 0 ? techs.join(' + ') : undefined;
    } catch {
      return undefined;
    }
  }

  applyFileActivity(
    filePath: string,
    type: 'read' | 'edit' | 'create' | 'delete',
  ): { updates: Partial<FileNode>[]; newNode: boolean } {
    // Normalize to relative path
    let relativePath = filePath;
    if (this._rootDir && filePath.startsWith(this._rootDir)) {
      relativePath = filePath.slice(this._rootDir.length + 1);
    }

    let node = this.nodeMap.get(relativePath);

    // If node doesn't exist and it's a create/edit, add it dynamically
    if (!node && (type === 'create' || type === 'edit')) {
      const ext = path.extname(relativePath);
      const label = path.basename(relativePath);
      const group = path.dirname(relativePath);
      const absPath = this._rootDir ? path.join(this._rootDir, relativePath) : relativePath;

      node = {
        id: relativePath,
        path: absPath,
        label,
        group: group === '.' ? '.' : group,
        extension: ext,
        size: 0,
        heat: 1,
        visited: true,
        modified: true,
      };
      this.nodeMap.set(relativePath, node);
      this.graph.nodes.push(node);

      // Try to get actual file size asynchronously (best-effort, won't block)
      stat(absPath).then((s) => { node!.size = s.size; }).catch(() => {});

      return { updates: [], newNode: true };
    }

    if (!node) return { updates: [], newNode: false };

    const updates: Partial<FileNode> = { id: node.id };

    switch (type) {
      case 'read':
        node.heat = Math.min(1, node.heat + 0.3);
        node.visited = true;
        updates.heat = node.heat;
        updates.visited = true;
        break;
      case 'edit':
      case 'create':
        node.heat = 1;
        node.visited = true;
        node.modified = true;
        updates.heat = node.heat;
        updates.visited = true;
        updates.modified = true;
        break;
      case 'delete':
        node.heat = 0;
        updates.heat = 0;
        break;
    }

    return { updates: [updates], newNode: false };
  }
}
