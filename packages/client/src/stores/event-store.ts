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
    set((s) => {
      if (s.events.length >= MAX_EVENTS) {
        const next = s.events.slice(-(MAX_EVENTS - 1));
        next.push(event);
        return { events: next };
      }
      return { events: [...s.events, event] };
    }),
  addEvents: (events) =>
    set((s) => ({
      events: [...s.events, ...events].slice(-MAX_EVENTS),
    })),
  clear: () => set({ events: [] }),
}));
