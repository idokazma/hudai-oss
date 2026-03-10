import { describe, it, expect, beforeEach } from 'vitest';
import { useDensityStore } from '../stores/density-store.js';

describe('useDensityStore', () => {
  beforeEach(() => {
    useDensityStore.setState({ mode: 'work' });
  });

  it('defaults to work mode', () => {
    expect(useDensityStore.getState().mode).toBe('work');
  });

  it('setMode switches to glance', () => {
    useDensityStore.getState().setMode('glance');
    expect(useDensityStore.getState().mode).toBe('glance');
  });

  it('setMode switches back to work', () => {
    useDensityStore.getState().setMode('glance');
    useDensityStore.getState().setMode('work');
    expect(useDensityStore.getState().mode).toBe('work');
  });
});
