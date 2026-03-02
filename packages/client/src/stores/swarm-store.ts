import { create } from 'zustand';
import type { SwarmSnapshot } from '@hudai/shared';

interface SwarmState {
  sessions: SwarmSnapshot[];
  setSessions: (sessions: SwarmSnapshot[]) => void;
}

export const useSwarmStore = create<SwarmState>((set) => ({
  sessions: [],
  setSessions: (sessions) => set({ sessions }),
}));
