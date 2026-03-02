import { create } from 'zustand';

export interface Caret {
  x: number;
  lineIndex: number;
}

interface PaneContentStore {
  content: string;
  caret: Caret | null;
  setContent: (content: string, caret?: Caret | null) => void;
}

export const usePaneContentStore = create<PaneContentStore>((set) => ({
  content: '',
  caret: null,
  setContent: (content, caret) => set({ content, caret: caret ?? null }),
}));
