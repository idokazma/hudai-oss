import { create } from 'zustand';

interface ConfigPanelStore {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

export const useConfigPanelStore = create<ConfigPanelStore>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));
