import { create } from 'zustand';

export type DensityMode = 'glance' | 'work';

interface DensityStore {
  mode: DensityMode;
  chatVisible: boolean;
  terminalVisible: boolean;
  setMode: (mode: DensityMode) => void;
  setChatVisible: (v: boolean) => void;
  setTerminalVisible: (v: boolean) => void;
}

export const useDensityStore = create<DensityStore>((set) => ({
  mode: 'work',
  chatVisible: true,
  terminalVisible: true,
  setMode: (mode) => set({ mode }),
  setChatVisible: (chatVisible) => set({ chatVisible }),
  setTerminalVisible: (terminalVisible) => set({ terminalVisible }),
}));
