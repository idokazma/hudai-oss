import { create } from 'zustand';
import type { ConnectionState } from '../ws/ws-client.js';

interface ConnectionStore {
  state: ConnectionState;
  setState: (state: ConnectionState) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  state: 'disconnected',
  setState: (state) => set({ state }),
}));
