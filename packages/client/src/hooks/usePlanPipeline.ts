import { useMemo } from 'react';
import { usePlanStore } from '../stores/plan-store.js';
import type { PipelineDefinition, PlanBlockStatus } from '@hudai/shared';
import type { PlanTaskStatus } from '../stores/plan-store.js';

const STATUS_MAP: Record<PlanTaskStatus, PlanBlockStatus> = {
  queued: 'planned',
  active: 'in-progress',
  done: 'completed',
};

export function usePlanPipeline(): PipelineDefinition | null {
  const tasks = usePlanStore((s) => s.tasks);
  const planSource = usePlanStore((s) => s.planSource);

  return useMemo(() => {
    if (tasks.length === 0) return null;

    const isPlan = planSource === 'plan';

    const blocks = tasks.map((task) => ({
      id: task.id,
      label: task.name,
      blockType: 'plan-step' as const,
      files: task.files,
      description: task.detail,
      planStatus: isPlan ? 'blueprint' as PlanBlockStatus : STATUS_MAP[task.status],
    }));

    const edges = blocks.slice(0, -1).map((block, i) => ({
      id: `plan-edge-${i}`,
      source: block.id,
      target: blocks[i + 1].id,
      edgeType: 'control' as const,
    }));

    const done = tasks.filter((t) => t.status === 'done').length;

    return {
      id: '__agent-plan__',
      label: isPlan ? 'Plan' : 'Todo',
      category: 'agent-plan' as const,
      description: isPlan
        ? `${tasks.length} steps`
        : `${done}/${tasks.length} steps completed`,
      blocks,
      edges,
    };
  }, [tasks, planSource]);
}
