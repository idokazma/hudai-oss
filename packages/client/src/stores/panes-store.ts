import { create } from 'zustand';
import type { TmuxPane } from '@hudai/shared';

interface PanesStore {
  panes: TmuxPane[];
  setPanes: (panes: TmuxPane[]) => void;
}

export const usePanesStore = create<PanesStore>((set) => ({
  panes: [],
  setPanes: (panes) => set({ panes }),
}));
