import { create } from 'zustand';
import type { TokenState } from '@hudai/shared';

interface TokenStore {
  state: TokenState | null;
  setState: (state: TokenState) => void;
  clear: () => void;
}

export const useTokenStore = create<TokenStore>((set) => ({
  state: null,
  setState: (state) => set({ state }),
  clear: () => set({ state: null }),
}));
