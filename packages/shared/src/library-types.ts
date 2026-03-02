// --- Codebase Library Types ---

/** Progress of library build, broadcast during build */
export interface LibraryBuildProgress {
  phase: 'file-cards' | 'module-shelves' | 'overview' | 'markdown';
  current: number;
  total: number;
  label: string;
}

/** Summary of a single source file */
export interface FileCard {
  /** Relative path from project root */
  filePath: string;
  /** File modification time when card was generated */
  mtimeMs: number;
  /** One-line purpose */
  purpose: string;
  /** Named exports / public API */
  exports: string[];
  /** Key logic summary (2-3 sentences) */
  keyLogic: string;
  /** Import dependencies (relative paths) */
  dependencies: string[];
  /** Side effects (e.g., "modifies global state", "writes to disk") */
  sideEffects: string[];
  /** Non-obvious gotchas an agent should know */
  gotchas: string[];
}

/** A named export from a file — used in module shelf summaries */
export interface ExportEntry {
  name: string;
  filePath: string;
  kind: 'function' | 'class' | 'type' | 'const' | 'component' | 'other';
}

/** Summary of a logical module (group of related files) */
export interface ModuleShelf {
  /** Slug used for markdown filename, e.g. "packages--server--src--pipeline" */
  slug: string;
  /** Human-readable name, e.g. "Pipeline Analysis" */
  name: string;
  /** Directory prefix this module covers */
  dirPrefix: string;
  /** 2-4 sentence purpose */
  purpose: string;
  /** Architectural patterns used (e.g., "event emitter", "cache-then-LLM") */
  patterns: string[];
  /** Public API — key exports agents should use */
  publicApi: ExportEntry[];
  /** Module-level dependencies (other module slugs) */
  dependsOn: string[];
  /** File cards belonging to this module */
  fileCards: FileCard[];
}

/** Top-level project overview */
export interface ProjectOverview {
  /** Project name */
  name: string;
  /** 2-3 sentence project description */
  description: string;
  /** Tech stack summary */
  stack: string[];
  /** Architectural style (e.g., "monorepo", "microservices", "monolith") */
  architectureStyle: string;
  /** Key patterns used across the project */
  patterns: string[];
  /** Entry points (e.g., "packages/server/src/index.ts") */
  entryPoints: string[];
  /** npm scripts / build commands */
  scripts: Record<string, string>;
  /** High-level directory map */
  directoryMap: string;
}

/** Full cached manifest — persisted to disk */
export interface LibraryManifest {
  version: 1;
  generatedAt: number;
  projectRoot: string;
  overview: ProjectOverview;
  modules: ModuleShelf[];
  /** Per-file mtime tracking for incremental rebuilds */
  fileMtimes: Record<string, number>;
}
