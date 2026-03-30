import { create } from 'zustand';
import type { ThreadSummary } from '@hudai/shared';

interface ThreadState {
  threads: ThreadSummary[];
  /** Thread selected for detail view in center viewport */
  selectedThreadId: string | null;
  upsertThread: (t: ThreadSummary) => void;
  setThreads: (ts: ThreadSummary[]) => void;
  selectThread: (id: string | null) => void;
  clear: () => void;
}

export const useThreadStore = create<ThreadState>((set) => ({
  threads: [],
  selectedThreadId: null,

  upsertThread: (t) =>
    set((s) => {
      const idx = s.threads.findIndex((x) => x.threadId === t.threadId);
      if (idx >= 0) {
        const updated = [...s.threads];
        updated[idx] = t;
        return { threads: updated };
      }
      return { threads: [...s.threads, t] };
    }),

  setThreads: (threads) => set({ threads }),

  selectThread: (id) => set({ selectedThreadId: id }),

  clear: () => set({ threads: [], selectedThreadId: null }),
}));
