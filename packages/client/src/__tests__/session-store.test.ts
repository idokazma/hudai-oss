import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '../stores/session-store.js';
import type { AVPEvent } from '@hudai/shared';

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({
      session: {
        sessionId: '',
        status: 'idle',
        agentCurrentFile: null,
        taskLabel: 'No active task',
        startedAt: 0,
        eventCount: 0,
      },
      testHealth: null,
      contextPercent: 0,
      tokensPercent: 0,
      movementTrail: [],
    });
  });

  it('patchSession merges partial state', () => {
    useSessionStore.getState().patchSession({ status: 'running', taskLabel: 'Working...' });
    const s = useSessionStore.getState().session;
    expect(s.status).toBe('running');
    expect(s.taskLabel).toBe('Working...');
    expect(s.sessionId).toBe(''); // unchanged
  });

  it('movement trail tracks agentCurrentFile changes', () => {
    useSessionStore.getState().patchSession({ agentCurrentFile: '/a.ts' });
    useSessionStore.getState().patchSession({ agentCurrentFile: '/b.ts' });
    useSessionStore.getState().patchSession({ agentCurrentFile: '/c.ts' });
    const trail = useSessionStore.getState().movementTrail;
    // Trail stores previous files (not the current one)
    expect(trail).toContain('/a.ts');
    expect(trail).toContain('/b.ts');
  });

  it('trail is capped at 8', () => {
    for (let i = 0; i < 12; i++) {
      useSessionStore.getState().patchSession({ agentCurrentFile: `/file${i}.ts` });
    }
    expect(useSessionStore.getState().movementTrail.length).toBeLessThanOrEqual(8);
  });

  it('trail does not grow for same file repeated', () => {
    useSessionStore.getState().patchSession({ agentCurrentFile: '/a.ts' });
    useSessionStore.getState().patchSession({ agentCurrentFile: '/a.ts' });
    useSessionStore.getState().patchSession({ agentCurrentFile: '/a.ts' });
    // Same file repeated — trail should not grow
    expect(useSessionStore.getState().movementTrail.length).toBe(0);
  });

  it('updateFromEvent sets testHealth from test.result events', () => {
    const event = {
      id: 'e1',
      sessionId: 'test',
      timestamp: Date.now(),
      category: 'testing',
      type: 'test.result',
      source: 'test',
      data: { passed: 5, failed: 2, total: 7, failures: [], durationMs: 1000 },
    } as AVPEvent;
    useSessionStore.getState().updateFromEvent(event, 10);
    const health = useSessionStore.getState().testHealth;
    expect(health).not.toBeNull();
    expect(health!.passed).toBe(5);
    expect(health!.failed).toBe(2);
    expect(health!.total).toBe(7);
  });
});
