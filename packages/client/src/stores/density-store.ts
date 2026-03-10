import { create } from 'zustand';

export type DensityMode = 'glance' | 'work';

interface DensityStore {
  mode: DensityMode;
  setMode: (mode: DensityMode) => void;
}

export const useDensityStore = create<DensityStore>((set) => ({
  mode: 'work',
  setMode: (mode) => set({ mode }),
}));
