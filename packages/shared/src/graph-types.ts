export interface FileNode {
  id: string;          // relative path: 'src/auth/oauth.ts'
  path: string;        // absolute path
  label: string;       // filename: 'oauth.ts'
  group: string;       // directory cluster: 'src/auth'
  extension: string;   // '.ts'
  size: number;        // file bytes -> maps to node radius
  heat: number;        // 0-1, activity intensity
  visited: boolean;    // agent has read this file
  modified: boolean;   // agent has modified this file
  x?: number;
  y?: number;
}

export interface DependencyEdge {
  source: string;      // FileNode.id
  target: string;      // FileNode.id
  type: 'import' | 'directory';
}

export interface CodebaseGraph {
  nodes: FileNode[];
  edges: DependencyEdge[];
  architecture?: ArchitectureLayer;
}

// --- C4-inspired architecture layer ---

export interface ArchContainer {
  id: string;                    // e.g., "server", "client", "shared"
  label: string;                 // "API Server", "React Frontend"
  technology?: string;           // "Node.js / Fastify 5"
  groups: string[];              // directory paths this container owns
  color?: number;                // override group palette color
}

export interface ContainerRelationship {
  source: string;                // container id
  target: string;                // container id
  label: string;                 // "WebSocket events"
}

export interface ArchitectureLayer {
  containers: ArchContainer[];
  relationships: ContainerRelationship[];
}
