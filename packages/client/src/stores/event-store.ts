import { create } from 'zustand';
import type { AVPEvent } from '@hudai/shared';

const MAX_EVENTS = 10_000;

interface EventStoreState {
  events: AVPEvent[];
  addEvent: (event: AVPEvent) => void;
  addEvents: (events: AVPEvent[]) => void;
  clear: () => void;
}

export const useEventStore = create<EventStoreState>((set) => ({
  events: [],
  addEvent: (event) =>
    set((s) => ({
      events: s.events.length >= MAX_EVENTS
        ? [...s.events.slice(-MAX_EVENTS + 1), event]
        : [...s.events, event],
    })),
  addEvents: (events) =>
    set((s) => ({
      events: [...s.events, ...events].slice(-MAX_EVENTS),
    })),
  clear: () => set({ events: [] }),
}));
