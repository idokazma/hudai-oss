import { create } from 'zustand';

interface PreviewState {
  url: string | null;
  proxyPort: number | null;
  proxyUrl: string | null;
  centerTab: 'map' | 'preview';
  setUrl: (url: string) => void;
  setProxyPort: (port: number) => void;
  setCenterTab: (tab: 'map' | 'preview') => void;
  close: () => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  url: null,
  proxyPort: null,
  proxyUrl: null,
  centerTab: 'map',
  setUrl: (url) => set({ url, proxyPort: null, proxyUrl: null, centerTab: 'preview' }),
  setProxyPort: (port) => set({ proxyPort: port, proxyUrl: `http://localhost:${port}` }),
  setCenterTab: (tab) => set({ centerTab: tab }),
  close: () => set({ url: null, proxyPort: null, proxyUrl: null, centerTab: 'map' }),
}));
