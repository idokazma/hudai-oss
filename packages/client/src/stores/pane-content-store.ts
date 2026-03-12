import { create } from 'zustand';

export interface Caret {
  x: number;
  lineIndex: number;
}

interface PaneContentStore {
  /** Raw terminal content (tmux mode) */
  content: string;
  caret: Caret | null;
  /** Accumulated text blocks from stream-json mode */
  streamOutput: string;
  /** Which mode is active */
  mode: 'tmux' | 'stream';
  setContent: (content: string, caret?: Caret | null) => void;
  appendStreamOutput: (text: string) => void;
  setStreamOutput: (text: string) => void;
  setMode: (mode: 'tmux' | 'stream') => void;
  clear: () => void;
}

export const usePaneContentStore = create<PaneContentStore>((set) => ({
  content: '',
  caret: null,
  streamOutput: '',
  mode: 'tmux',
  setContent: (content, caret) => set({ content, caret: caret ?? null }),
  appendStreamOutput: (text) => set((s) => ({ streamOutput: s.streamOutput + text })),
  setStreamOutput: (text) => set({ streamOutput: text }),
  setMode: (mode) => set({ mode }),
  clear: () => set({ content: '', caret: null, streamOutput: '' }),
}));
