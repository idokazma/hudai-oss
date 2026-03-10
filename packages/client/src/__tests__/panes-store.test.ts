import { describe, it, expect, beforeEach } from 'vitest';
import { usePanesStore } from '../stores/panes-store.js';

describe('usePanesStore', () => {
  beforeEach(() => {
    usePanesStore.setState({ panes: [] });
  });

  it('starts with empty panes', () => {
    expect(usePanesStore.getState().panes).toHaveLength(0);
  });

  it('setPanes replaces pane list', () => {
    const panes = [
      { id: '%1', command: 'claude', width: 80, height: 24 },
      { id: '%2', command: 'bash', width: 120, height: 40 },
    ] as any;
    usePanesStore.getState().setPanes(panes);
    expect(usePanesStore.getState().panes).toHaveLength(2);
    expect(usePanesStore.getState().panes[0].id).toBe('%1');
    expect(usePanesStore.getState().panes[1].command).toBe('bash');
  });

  it('setPanes overwrites previous panes', () => {
    usePanesStore.getState().setPanes([{ id: '%1', command: 'old' }] as any);
    usePanesStore.getState().setPanes([{ id: '%3', command: 'new' }] as any);
    expect(usePanesStore.getState().panes).toHaveLength(1);
    expect(usePanesStore.getState().panes[0].id).toBe('%3');
  });

  it('setPanes with empty array clears panes', () => {
    usePanesStore.getState().setPanes([{ id: '%1', command: 'x' }] as any);
    usePanesStore.getState().setPanes([]);
    expect(usePanesStore.getState().panes).toHaveLength(0);
  });
});
