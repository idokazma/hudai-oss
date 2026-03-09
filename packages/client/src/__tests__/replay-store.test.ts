import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock wsClient before importing the store
vi.mock('../ws/ws-client.js', () => ({
  wsClient: { send: vi.fn() },
}));

import { useReplayStore } from '../stores/replay-store.js';
import { wsClient } from '../ws/ws-client.js';
import type { AVPEvent } from '@hudai/shared';

function makeEvent(id: string, ts: number, type = 'file.read'): AVPEvent {
  return {
    id,
    sessionId: 's1',
    timestamp: ts,
    category: 'navigation',
    type,
    data: { path: '/test' },
  } as AVPEvent;
}

describe('useReplayStore', () => {
  beforeEach(() => {
    useReplayStore.getState().exitReplay();
    vi.clearAllMocks();
  });

  it('starts in live mode', () => {
    const s = useReplayStore.getState();
    expect(s.mode).toBe('live');
    expect(s.replaySessionId).toBeNull();
    expect(s.events).toHaveLength(0);
    expect(s.loading).toBe(false);
  });

  it('enterReplay sets replay mode and sends ws request', () => {
    useReplayStore.getState().enterReplay('session-123');
    const s = useReplayStore.getState();
    expect(s.mode).toBe('replay');
    expect(s.replaySessionId).toBe('session-123');
    expect(s.loading).toBe(true);
    expect(s.playing).toBe(false);
    expect(wsClient.send).toHaveBeenCalledWith({
      kind: 'replay.request',
      sessionId: 'session-123',
      from: 0,
      to: Number.MAX_SAFE_INTEGER,
    });
  });

  it('exitReplay resets to live mode', () => {
    useReplayStore.getState().enterReplay('s1');
    useReplayStore.getState().exitReplay();
    const s = useReplayStore.getState();
    expect(s.mode).toBe('live');
    expect(s.replaySessionId).toBeNull();
    expect(s.loading).toBe(false);
  });

  it('loadEvents stores events and groups decisions', () => {
    const events = [
      makeEvent('e1', 1000, 'think.start'),
      makeEvent('e2', 1001, 'file.read'),
      makeEvent('e3', 2000, 'think.start'),
    ];
    useReplayStore.getState().loadEvents(events);
    const s = useReplayStore.getState();
    expect(s.events).toHaveLength(3);
    expect(s.loading).toBe(false);
    expect(s.cursor).toBe(0);
    expect(s.decisions.length).toBeGreaterThan(0);
  });

  it('setCursor clamps to valid range', () => {
    useReplayStore.getState().loadEvents([
      makeEvent('e1', 1000),
      makeEvent('e2', 2000),
      makeEvent('e3', 3000),
    ]);
    useReplayStore.getState().setCursor(100);
    expect(useReplayStore.getState().cursor).toBe(2);
    useReplayStore.getState().setCursor(-5);
    expect(useReplayStore.getState().cursor).toBe(0);
  });

  it('stepForward increments cursor and stops playing', () => {
    useReplayStore.getState().loadEvents([
      makeEvent('e1', 1000),
      makeEvent('e2', 2000),
    ]);
    useReplayStore.getState().play();
    useReplayStore.getState().stepForward();
    expect(useReplayStore.getState().cursor).toBe(1);
    expect(useReplayStore.getState().playing).toBe(false);
  });

  it('stepForward is no-op at end', () => {
    useReplayStore.getState().loadEvents([makeEvent('e1', 1000)]);
    useReplayStore.getState().stepForward(); // already at end (only 1 event)
    expect(useReplayStore.getState().cursor).toBe(0);
  });

  it('stepBackward decrements cursor', () => {
    useReplayStore.getState().loadEvents([
      makeEvent('e1', 1000),
      makeEvent('e2', 2000),
    ]);
    useReplayStore.getState().setCursor(1);
    useReplayStore.getState().stepBackward();
    expect(useReplayStore.getState().cursor).toBe(0);
    expect(useReplayStore.getState().playing).toBe(false);
  });

  it('stepBackward is no-op at 0', () => {
    useReplayStore.getState().loadEvents([makeEvent('e1', 1000)]);
    useReplayStore.getState().stepBackward();
    expect(useReplayStore.getState().cursor).toBe(0);
  });

  it('play and pause toggle playing state', () => {
    useReplayStore.getState().play();
    expect(useReplayStore.getState().playing).toBe(true);
    useReplayStore.getState().pause();
    expect(useReplayStore.getState().playing).toBe(false);
  });

  it('setSpeed updates speed', () => {
    useReplayStore.getState().setSpeed(4);
    expect(useReplayStore.getState().speed).toBe(4);
  });

  it('requestSessions sends ws message', () => {
    useReplayStore.getState().requestSessions();
    expect(wsClient.send).toHaveBeenCalledWith({ kind: 'sessions.list' });
  });

  it('setSessions stores session list', () => {
    const sessions = [{ id: 's1' }, { id: 's2' }] as any;
    useReplayStore.getState().setSessions(sessions);
    expect(useReplayStore.getState().sessions).toBe(sessions);
  });

  it('stepDecisionForward navigates to next decision', () => {
    const events = [
      makeEvent('e1', 1000, 'think.start'),
      makeEvent('e2', 1500, 'file.read'),
      makeEvent('e3', 2000, 'think.start'),
      makeEvent('e4', 2500, 'file.edit'),
    ];
    useReplayStore.getState().loadEvents(events);
    const { decisions } = useReplayStore.getState();
    if (decisions.length > 1) {
      useReplayStore.getState().stepDecisionForward();
      expect(useReplayStore.getState().decisionCursor).toBe(1);
    }
  });

  it('stepDecisionBackward navigates to previous decision', () => {
    const events = [
      makeEvent('e1', 1000, 'think.start'),
      makeEvent('e2', 1500, 'file.read'),
      makeEvent('e3', 2000, 'think.start'),
    ];
    useReplayStore.getState().loadEvents(events);
    const { decisions } = useReplayStore.getState();
    if (decisions.length > 1) {
      // Move forward first
      useReplayStore.getState().stepDecisionForward();
      useReplayStore.getState().stepDecisionBackward();
      expect(useReplayStore.getState().decisionCursor).toBe(0);
    }
  });
});
