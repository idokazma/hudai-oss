import { create } from 'zustand';
import type { AVPEvent, PlanFileSummary } from '@hudai/shared';

export type PlanTaskStatus = 'queued' | 'active' | 'done';

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
  /** Whether the task list came from an explicit plan.update (todo list) */
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

let inferCounter = 0;

export const usePlanStore = create<PlanStore>((set, get) => ({
  tasks: [],
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
    inferCounter = 0;
    set({ tasks: [], hasExplicitPlan: false, sessionId: '' });
  },

  updateFromEvent: (event) => {
    const { tasks, hasExplicitPlan, sessionId } = get();

    // Only process events belonging to the current attached session
    if (sessionId && event.sessionId && event.sessionId !== sessionId) return;

    // Handle plan.update — from TodoWrite/TaskCreate, terminal parsing, or plan file watcher
    // This is the primary source of truth for the build queue
    if (event.type === 'plan.update') {
      const steps = event.data.steps;
      const currentStep = event.data.currentStep;
      const stepFiles: string[][] = event.data.stepFiles ?? [];
      const stepDescriptions: string[] = event.data.stepDescriptions ?? [];
      const newTasks: PlanTask[] = steps.map((step, i) => ({
        id: `plan-${i}`,
        name: step,
        detail: stepDescriptions[i] || step,
        status: i < currentStep ? 'done' as const : i === currentStep ? 'active' as const : 'queued' as const,
        startedAt: i <= currentStep ? Date.now() : 0,
        completedAt: i < currentStep ? Date.now() : undefined,
        files: stepFiles[i] ?? [],
      }));
      set({ tasks: newTasks, hasExplicitPlan: true });
      return;
    }

    // If we have an explicit plan from todo list, update file lists on active task
    // but don't create new tasks from inferred patterns
    if (hasExplicitPlan) {
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

    // No explicit plan — fall back to auto-inference from event patterns
    // This gives a rough activity log when the agent doesn't use TodoWrite

    if (event.type === 'task.start') {
      const promptText = event.data.prompt.trim();
      // Skip trivial/meta prompts
      if (!promptText || /^\/(clear|help|exit|quit|status)$/i.test(promptText)) return;

      const name = promptText.slice(0, 80);

      // Deduplicate: skip if ANY existing task has the same name
      if (tasks.some((t) => t.name === name)) return;

      const updated = tasks.map((t) =>
        t.status === 'active' ? { ...t, status: 'done' as const, completedAt: Date.now() } : t
      );
      const newTask: PlanTask = {
        id: `task-${++inferCounter}`,
        name,
        detail: promptText,
        status: 'active',
        startedAt: Date.now(),
        files: [],
      };
      set({ tasks: [...updated, newTask] });
      return;
    }

    if (event.type === 'task.complete') {
      const updated = tasks.map((t) =>
        t.status === 'active' ? { ...t, status: 'done' as const, completedAt: Date.now() } : t
      );
      set({ tasks: updated });
      return;
    }

    // Auto-infer phases from event patterns
    const category = getEventCategory(event);
    if (!category) return;

    const activeTask = tasks.find((t) => t.status === 'active');
    const phaseName = category.charAt(0).toUpperCase() + category.slice(1);

    if (activeTask && activeTask.name.toLowerCase() === phaseName.toLowerCase()) {
      const filePath = getFilePath(event);
      if (filePath && !activeTask.files.includes(filePath)) {
        const updated = tasks.map((t) =>
          t.id === activeTask.id ? { ...t, files: [...t.files, filePath] } : t
        );
        set({ tasks: updated });
      }
    } else {
      // Don't repeat the same phase if the previous done task was the same
      const lastDone = [...tasks].reverse().find((t) => t.status === 'done');
      if (lastDone && lastDone.name.toLowerCase() === phaseName.toLowerCase() && !activeTask) {
        // Reactivate the last done task of the same phase instead
        const filePath = getFilePath(event);
        const updated = tasks.map((t) =>
          t.id === lastDone.id
            ? { ...t, status: 'active' as const, files: filePath && !t.files.includes(filePath) ? [...t.files, filePath] : t.files }
            : t
        );
        set({ tasks: updated });
      } else {
        const updated = tasks.map((t) =>
          t.status === 'active' ? { ...t, status: 'done' as const, completedAt: Date.now() } : t
        );
        const filePath = getFilePath(event);
        const newTask: PlanTask = {
          id: `auto-${++inferCounter}`,
          name: phaseName,
          detail: getEventDetail(event),
          status: 'active',
          startedAt: Date.now(),
          files: filePath ? [filePath] : [],
        };
        set({ tasks: [...updated, newTask] });
      }
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

function getEventDetail(event: AVPEvent): string {
  if ('data' in event) {
    const data = event.data as any;
    if (data.path) return data.path;
    if (data.command) return data.command;
    if (data.pattern) return data.pattern;
    if (data.prompt) return data.prompt;
  }
  return event.type;
}

function getEventCategory(event: AVPEvent): string {
  switch (event.type) {
    case 'file.read':
    case 'search.grep':
    case 'search.glob':
      return 'analyzing';
    case 'file.edit':
    case 'file.create':
    case 'file.delete':
      return 'modifying';
    case 'test.run':
    case 'test.result':
      return 'testing';
    case 'shell.run':
      return 'executing';
    case 'think.start':
    case 'think.end':
      return 'thinking';
    default:
      return '';
  }
}
