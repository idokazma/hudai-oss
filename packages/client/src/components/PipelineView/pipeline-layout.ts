import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import type { PipelineBlock, PipelineEdge } from '@hudai/shared';

export type LayoutDirection = 'LR' | 'TB';

const DIMS: Record<LayoutDirection, { width: number; height: number }> = {
  LR: { width: 280, height: 160 },
  TB: { width: 380, height: 130 },
};

export interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
}

export function layoutPipeline(
  blocks: PipelineBlock[],
  pipelineEdges: PipelineEdge[],
  direction: LayoutDirection = 'LR',
): LayoutResult {
  const { width: nodeWidth, height: nodeHeight } = DIMS[direction];

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep: direction === 'TB' ? 80 : 140,
    nodesep: direction === 'TB' ? 80 : 60,
  });

  for (const block of blocks) {
    g.setNode(block.id, { width: nodeWidth, height: nodeHeight });
  }

  for (const edge of pipelineEdges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const nodes: Node[] = blocks.map((block) => {
    const pos = g.node(block.id);
    return {
      id: block.id,
      type: 'pipelineBlock',
      position: {
        x: pos.x - nodeWidth / 2,
        y: pos.y - nodeHeight / 2,
      },
      data: { block, direction },
    };
  });

  const edges: Edge[] = pipelineEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'animatedFlow',
    data: { label: edge.label, edgeType: edge.edgeType },
  }));

  return { nodes, edges };
}
