import { create } from 'zustand';
import type { InsightSummary, InsightIntent, InsightNotification } from '@hudai/shared';

interface InsightState {
  summary: InsightSummary | null;
  intent: InsightIntent | null;
  notifications: InsightNotification[];
  setSummary: (s: InsightSummary) => void;
  setIntent: (i: InsightIntent) => void;
  addNotification: (n: InsightNotification) => void;
  clear: () => void;
}

const MAX_NOTIFICATIONS = 50;

export const useInsightStore = create<InsightState>((set) => ({
  summary: null,
  intent: null,
  notifications: [],

  setSummary: (summary) => set({ summary }),

  setIntent: (intent) => set({ intent }),

  addNotification: (n) =>
    set((s) => ({
      notifications: [n, ...s.notifications].slice(0, MAX_NOTIFICATIONS),
    })),

  clear: () => set({ summary: null, intent: null, notifications: [] }),
}));
