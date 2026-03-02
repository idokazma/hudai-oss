import { create } from 'zustand';
import type { LibraryBuildProgress, ProjectOverview, ModuleShelf } from '@hudai/shared';

interface LibraryStoreState {
  buildProgress: LibraryBuildProgress | null;
  overview: ProjectOverview | null;
  modules: ModuleShelf[];
  moduleCount: number;
  fileCardCount: number;
  isBuilding: boolean;

  setProgress: (progress: LibraryBuildProgress) => void;
  setReady: (overview: ProjectOverview, moduleCount: number, fileCardCount: number) => void;
  setManifest: (overview: ProjectOverview, modules: ModuleShelf[]) => void;
  clear: () => void;
}

export const useLibraryStore = create<LibraryStoreState>((set) => ({
  buildProgress: null,
  overview: null,
  modules: [],
  moduleCount: 0,
  fileCardCount: 0,
  isBuilding: false,

  setProgress: (progress) => set({ buildProgress: progress, isBuilding: true }),

  setReady: (overview, moduleCount, fileCardCount) => set({
    overview,
    moduleCount,
    fileCardCount,
    isBuilding: false,
    buildProgress: null,
  }),

  setManifest: (overview, modules) => set({
    overview,
    modules,
    moduleCount: modules.length,
    fileCardCount: modules.reduce((sum, m) => sum + m.fileCards.length, 0),
  }),

  clear: () => set({
    buildProgress: null,
    overview: null,
    modules: [],
    moduleCount: 0,
    fileCardCount: 0,
    isBuilding: false,
  }),
}));
