import { create } from 'zustand';
import type { AgentConfig, PermissionSuggestion } from '@hudai/shared';

interface ConfigStore {
  config: AgentConfig | null;
  suggestions: PermissionSuggestion[];
  setConfig: (config: AgentConfig) => void;
  addSuggestion: (s: PermissionSuggestion) => void;
  dismissSuggestion: (tool: string) => void;
  clear: () => void;
}

export const useConfigStore = create<ConfigStore>((set) => ({
  config: null,
  suggestions: [],
  setConfig: (config) => set({ config }),
  addSuggestion: (s) =>
    set((state) => {
      // Replace existing suggestion for the same tool
      const filtered = state.suggestions.filter((x) => x.tool !== s.tool);
      return { suggestions: [...filtered, s] };
    }),
  dismissSuggestion: (tool) =>
    set((state) => ({
      suggestions: state.suggestions.filter((s) => s.tool !== tool),
    })),
  clear: () => set({ config: null, suggestions: [] }),
}));
