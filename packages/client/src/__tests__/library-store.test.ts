import { describe, it, expect, beforeEach } from 'vitest';
import { useLibraryStore } from '../stores/library-store.js';

describe('useLibraryStore', () => {
  beforeEach(() => {
    useLibraryStore.getState().clear();
  });

  it('starts with null overview and zero counts', () => {
    const s = useLibraryStore.getState();
    expect(s.overview).toBeNull();
    expect(s.modules).toHaveLength(0);
    expect(s.moduleCount).toBe(0);
    expect(s.fileCardCount).toBe(0);
    expect(s.isBuilding).toBe(false);
  });

  it('setProgress sets isBuilding to true', () => {
    useLibraryStore.getState().setProgress({ step: 'scanning', progress: 50 } as any);
    const s = useLibraryStore.getState();
    expect(s.isBuilding).toBe(true);
    expect(s.buildProgress).toEqual({ step: 'scanning', progress: 50 });
  });

  it('setReady sets isBuilding to false and clears buildProgress', () => {
    useLibraryStore.getState().setProgress({ step: 'building' } as any);
    useLibraryStore.getState().setReady({ name: 'proj' } as any, 5, 20);
    const s = useLibraryStore.getState();
    expect(s.isBuilding).toBe(false);
    expect(s.buildProgress).toBeNull();
    expect(s.moduleCount).toBe(5);
    expect(s.fileCardCount).toBe(20);
    expect(s.overview).toEqual({ name: 'proj' });
  });

  it('setManifest computes fileCardCount from modules', () => {
    const modules = [
      { name: 'core', fileCards: [{ id: 'a' }, { id: 'b' }] },
      { name: 'utils', fileCards: [{ id: 'c' }] },
      { name: 'empty', fileCards: [] },
    ] as any;
    useLibraryStore.getState().setManifest({ name: 'proj' } as any, modules);
    const s = useLibraryStore.getState();
    expect(s.moduleCount).toBe(3);
    expect(s.fileCardCount).toBe(3); // 2 + 1 + 0
    expect(s.modules).toBe(modules);
  });

  it('setManifest with empty modules gives zero counts', () => {
    useLibraryStore.getState().setManifest({ name: 'proj' } as any, []);
    expect(useLibraryStore.getState().moduleCount).toBe(0);
    expect(useLibraryStore.getState().fileCardCount).toBe(0);
  });

  it('clear resets all state', () => {
    useLibraryStore.getState().setProgress({ step: 'x' } as any);
    useLibraryStore.getState().setManifest({ name: 'y' } as any, [{ name: 'm', fileCards: [{}] }] as any);
    useLibraryStore.getState().clear();
    const s = useLibraryStore.getState();
    expect(s.buildProgress).toBeNull();
    expect(s.overview).toBeNull();
    expect(s.modules).toHaveLength(0);
    expect(s.moduleCount).toBe(0);
    expect(s.fileCardCount).toBe(0);
    expect(s.isBuilding).toBe(false);
  });

  it('setReady updates overview', () => {
    const overview = { name: 'my-project', rootPath: '/src' } as any;
    useLibraryStore.getState().setReady(overview, 10, 50);
    expect(useLibraryStore.getState().overview).toBe(overview);
  });
});
