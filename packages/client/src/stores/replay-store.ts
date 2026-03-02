import { create } from 'zustand';
import type { AVPEvent, SessionSummary } from '@hudai/shared';
import { wsClient } from '../ws/ws-client.js';
import { groupIntoDecisions, type Decision } from '../utils/decision-grouper.js';

interface ReplayStore {
  mode: 'live' | 'replay';
  replaySessionId: string | null;
  sessions: SessionSummary[];
  /** All events for the replay session (loaded in batch) */
  events: AVPEvent[];
  /** Current cursor position (index into events) */
  cursor: number;
  playing: boolean;
  speed: number;
  loading: boolean;
  /** Grouped decisions for decision-level navigation */
  decisions: Decision[];
  /** Current decision cursor */
  decisionCursor: number;
  // Actions
  enterReplay: (sessionId: string) => void;
  exitReplay: () => void;
  setSessions: (sessions: SessionSummary[]) => void;
  requestSessions: () => void;
  loadEvents: (events: AVPEvent[]) => void;
  setCursor: (index: number) => void;
  play: () => void;
  pause: () => void;
  setSpeed: (speed: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  stepDecisionForward: () => void;
  stepDecisionBackward: () => void;
}

export const useReplayStore = create<ReplayStore>((set, get) => ({
  mode: 'live',
  replaySessionId: null,
  sessions: [],
  events: [],
  cursor: 0,
  playing: false,
  speed: 1,
  loading: false,
  decisions: [],
  decisionCursor: 0,

  enterReplay: (sessionId) => {
    set({
      mode: 'replay',
      replaySessionId: sessionId,
      events: [],
      cursor: 0,
      playing: false,
      loading: true,
    });
    // Request all events for this session
    wsClient.send({
      kind: 'replay.request',
      sessionId,
      from: 0,
      to: Number.MAX_SAFE_INTEGER,
    });
  },

  exitReplay: () => {
    set({
      mode: 'live',
      replaySessionId: null,
      events: [],
      cursor: 0,
      playing: false,
      loading: false,
    });
  },

  setSessions: (sessions) => set({ sessions }),

  requestSessions: () => {
    wsClient.send({ kind: 'sessions.list' });
  },

  loadEvents: (events) => {
    const decisions = groupIntoDecisions(events);
    set({ events, cursor: 0, loading: false, decisions, decisionCursor: 0 });
  },

  setCursor: (index) => {
    const { events } = get();
    const clamped = Math.max(0, Math.min(index, events.length - 1));
    set({ cursor: clamped });
  },

  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  setSpeed: (speed) => set({ speed }),

  stepForward: () => {
    const { cursor, events } = get();
    if (cursor < events.length - 1) {
      set({ cursor: cursor + 1, playing: false });
    }
  },

  stepBackward: () => {
    const { cursor } = get();
    if (cursor > 0) {
      set({ cursor: cursor - 1, playing: false });
    }
  },

  stepDecisionForward: () => {
    const { decisionCursor, decisions, events } = get();
    if (decisionCursor < decisions.length - 1) {
      const nextDecision = decisions[decisionCursor + 1];
      // Find the event index for the start of the next decision
      const startTs = nextDecision.startTs;
      const eventIndex = events.findIndex((e) => e.timestamp >= startTs);
      set({
        decisionCursor: decisionCursor + 1,
        cursor: eventIndex >= 0 ? eventIndex : get().cursor,
        playing: false,
      });
    }
  },

  stepDecisionBackward: () => {
    const { decisionCursor, decisions, events } = get();
    if (decisionCursor > 0) {
      const prevDecision = decisions[decisionCursor - 1];
      const startTs = prevDecision.startTs;
      const eventIndex = events.findIndex((e) => e.timestamp >= startTs);
      set({
        decisionCursor: decisionCursor - 1,
        cursor: eventIndex >= 0 ? eventIndex : 0,
        playing: false,
      });
    }
  },
}));
