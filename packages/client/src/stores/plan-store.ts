import { create } from 'zustand';
import type { AVPEvent, PlanFileSummary } from '@hudai/shared';

export type PlanTaskStatus = 'queued' | 'active' | 'done';
export type PlanSource = 'plan' | 'todo' | null;

export interface PlanTask {
  id: string;
  name: string;
  detail: string;
  status: PlanTaskStatus;
  startedAt: number;
  completedAt?: number;
  files: string[];
}

interface PlanStore {
  tasks: PlanTask[];
  /** Whether the task list is from a plan file ('plan') or TodoWrite/transcript ('todo') */
  planSource: PlanSource;
  /** @deprecated Use planSource !== null */
  hasExplicitPlan: boolean;
  /** Session ID this plan belongs to — only events matching this ID are processed */
  sessionId: string;
  /** Available plan files from ~/.claude/plans/ */
  availablePlans: PlanFileSummary[];
  setSessionId: (id: string) => void;
  setAvailablePlans: (plans: PlanFileSummary[]) => void;
  updateFromEvent: (event: AVPEvent) => void;
  /** Mark all active/queued tasks as done (used when agent is idle after replay) */
  markAllDone: () => void;
  clear: () => void;
}

export const usePlanStore = create<PlanStore>((set, get) => ({
  tasks: [],
  planSource: null,
  hasExplicitPlan: false,
  sessionId: '',
  availablePlans: [],

  setSessionId: (id) => set({ sessionId: id }),
  setAvailablePlans: (plans) => set({ availablePlans: plans }),

  markAllDone: () => {
    const { tasks } = get();
    const updated = tasks.map((t) =>
      t.status === 'active' || t.status === 'queued'
        ? { ...t, status: 'done' as const, completedAt: t.completedAt ?? Date.now() }
        : t
    );
    set({ tasks: updated });
  },

  clear: () => {
    set({ tasks: [], planSource: null, hasExplicitPlan: false, sessionId: '' });
  },

  updateFromEvent: (event) => {
    const { tasks, planSource, sessionId } = get();

    // Only process events belonging to the current attached session
    if (sessionId && event.sessionId && event.sessionId !== sessionId) return;

    // Handle plan.update — from TodoWrite/TaskCreate, terminal parsing, or plan file watcher
    // This is the primary source of truth for the build queue
    if (event.type === 'plan.update') {
      const isPlanFile = event.source === 'plan-file';
      const incomingSource: PlanSource = isPlanFile ? 'plan' : 'todo';

      // If we already have a todo, ignore incoming plan-file events (todo wins)
      if (planSource === 'todo' && isPlanFile) return;

      const steps = event.data.steps;
      const currentStep = event.data.currentStep;
      const stepFiles: string[][] = event.data.stepFiles ?? [];
      const stepDescriptions: string[] = event.data.stepDescriptions ?? [];
      const newTasks: PlanTask[] = steps.map((step, i) => ({
        id: `plan-${i}`,
        name: step,
        detail: stepDescriptions[i] || step,
        // Plan-file source: all steps are queued (static reference). Todo: use progress.
        status: isPlanFile
          ? 'queued' as const
          : (i < currentStep ? 'done' as const : i === currentStep ? 'active' as const : 'queued' as const),
        startedAt: isPlanFile ? 0 : (i <= currentStep ? Date.now() : 0),
        completedAt: isPlanFile ? undefined : (i < currentStep ? Date.now() : undefined),
        files: stepFiles[i] ?? [],
      }));
      set({ tasks: newTasks, planSource: incomingSource, hasExplicitPlan: true });
      return;
    }

    // File accumulation and task.complete advancement only run for todo source
    if (planSource === 'todo') {
      const filePath = getFilePath(event);
      if (filePath) {
        const updated = tasks.map((t) => {
          if (t.status === 'active' && !t.files.includes(filePath)) {
            return { ...t, files: [...t.files, filePath] };
          }
          return t;
        });
        set({ tasks: updated });
      }

      // Handle task.complete — advance to next step
      if (event.type === 'task.complete') {
        const activeIdx = tasks.findIndex((t) => t.status === 'active');
        if (activeIdx >= 0) {
          const updated = tasks.map((t, i) => {
            if (i === activeIdx) return { ...t, status: 'done' as const, completedAt: Date.now() };
            if (i === activeIdx + 1 && t.status === 'queued') return { ...t, status: 'active' as const, startedAt: Date.now() };
            return t;
          });
          set({ tasks: updated });
        }
      }
      return;
    }

    // No plan source — only track task.start/task.complete, no auto-inference
    if (event.type === 'task.complete') {
      const updated = tasks.map((t) =>
        t.status === 'active' ? { ...t, status: 'done' as const, completedAt: Date.now() } : t
      );
      set({ tasks: updated });
    }
  },
}));

function getFilePath(event: AVPEvent): string | null {
  if ('data' in event) {
    const data = event.data as any;
    if (data.path) return data.path;
    if (data.files?.[0]) return data.files[0];
  }
  return null;
}

