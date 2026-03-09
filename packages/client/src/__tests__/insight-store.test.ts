import { describe, it, expect, beforeEach } from 'vitest';
import { useInsightStore } from '../stores/insight-store.js';

describe('useInsightStore', () => {
  beforeEach(() => {
    useInsightStore.getState().clear();
  });

  it('starts with null summary and intent', () => {
    const s = useInsightStore.getState();
    expect(s.summary).toBeNull();
    expect(s.intent).toBeNull();
    expect(s.notifications).toHaveLength(0);
  });

  it('setSummary stores summary', () => {
    const summary = { text: 'All good', confidence: 0.9 } as any;
    useInsightStore.getState().setSummary(summary);
    expect(useInsightStore.getState().summary).toBe(summary);
  });

  it('setIntent stores intent', () => {
    const intent = { goal: 'fix bug', confidence: 0.8 } as any;
    useInsightStore.getState().setIntent(intent);
    expect(useInsightStore.getState().intent).toBe(intent);
  });

  it('addNotification prepends to front', () => {
    const n1 = { id: '1', text: 'first' } as any;
    const n2 = { id: '2', text: 'second' } as any;
    useInsightStore.getState().addNotification(n1);
    useInsightStore.getState().addNotification(n2);
    const notifications = useInsightStore.getState().notifications;
    expect(notifications[0]).toBe(n2);
    expect(notifications[1]).toBe(n1);
  });

  it('notification ring buffer caps at 50', () => {
    for (let i = 0; i < 60; i++) {
      useInsightStore.getState().addNotification({ id: `n${i}`, text: `msg ${i}` } as any);
    }
    expect(useInsightStore.getState().notifications).toHaveLength(50);
    // Most recent should be first
    expect(useInsightStore.getState().notifications[0].id).toBe('n59');
  });

  it('clear resets all fields', () => {
    useInsightStore.getState().setSummary({ text: 'x' } as any);
    useInsightStore.getState().setIntent({ goal: 'y' } as any);
    useInsightStore.getState().addNotification({ id: '1' } as any);
    useInsightStore.getState().clear();
    const s = useInsightStore.getState();
    expect(s.summary).toBeNull();
    expect(s.intent).toBeNull();
    expect(s.notifications).toHaveLength(0);
  });
});
