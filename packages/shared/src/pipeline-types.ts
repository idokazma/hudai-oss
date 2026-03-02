// --- Pipeline Visualization Types ---

export type PipelineCategory =
  | 'event-driven'
  | 'state-management'
  | 'request-handling'
  | 'data-processing'
  | 'agent-plan';

export type PipelineBlockType =
  | 'source'
  | 'transform'
  | 'sink'
  | 'branch'
  | 'merge'
  | 'plan-step';

export type PipelineEdgeType =
  | 'data'
  | 'control'
  | 'error';

export type PlanBlockStatus = 'planned' | 'in-progress' | 'completed';

export interface PipelineBlock {
  id: string;
  label: string;
  blockType: PipelineBlockType;
  files: string[];
  technology?: string;
  description?: string;
  planStatus?: PlanBlockStatus;
}

export interface PipelineEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  edgeType: PipelineEdgeType;
}

export interface PipelineDefinition {
  id: string;
  label: string;
  category: PipelineCategory;
  description?: string;
  blocks: PipelineBlock[];
  edges: PipelineEdge[];
}

export interface PipelineLayer {
  pipelines: PipelineDefinition[];
}
