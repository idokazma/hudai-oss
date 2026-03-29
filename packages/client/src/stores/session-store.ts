import { create } from 'zustand';
import type { SessionState, AVPEvent } from '@hudai/shared';

export interface TestHealth {
  passed: number;
  failed: number;
  total: number;
  lastRun: number;
}

/** Rough estimate: average tokens per event (for context usage heuristic) */
const EST_TOKENS_PER_EVENT = 500;
/** Rough context window size for estimation purposes */
const EST_CONTEXT_WINDOW = 200_000;
/** Max percentage cap for heuristic estimates */
const EST_MAX_PERCENT = 95;
/** Seconds per "token unit" for time-based token estimation */
const EST_SECONDS_PER_TOKEN_UNIT = 30;
/** Token units per event for density-based estimation */
const EST_TOKEN_UNITS_PER_EVENT = 0.3;

const MAX_TRAIL = 8;

interface SessionStore {
  session: SessionState;
  testHealth: TestHealth | null;
  /** Estimated context usage (0-100), heuristic from event count */
  contextPercent: number;
  /** Estimated token usage (0-100), heuristic from session activity */
  tokensPercent: number;
  /** Last N file paths the agent visited — drives movement trail on map */
  movementTrail: string[];
  setSession: (state: SessionState) => void;
  patchSession: (patch: Partial<SessionState>) => void;
  updateFromEvent: (event: AVPEvent, totalEvents: number) => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
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

  setSession: (session) => set({ session, movementTrail: [] }),

  patchSession: (patch) =>
    set((s) => {
      const newSession = { ...s.session, ...patch };
      // Track movement trail when agentCurrentFile changes
      if (patch.agentCurrentFile && patch.agentCurrentFile !== s.session.agentCurrentFile) {
        const trail = s.session.agentCurrentFile
          ? [...s.movementTrail, s.session.agentCurrentFile].slice(-MAX_TRAIL)
          : s.movementTrail;
        return { session: newSession, movementTrail: trail };
      }
      return { session: newSession };
    }),

  updateFromEvent: (event, totalEvents) => {
    // Update test health from test.result events
    if (event.type === 'test.result') {
      const d = event.data;
      set({
        testHealth: {
          passed: d.passed,
          failed: d.failed,
          total: d.total,
          lastRun: Date.now(),
        },
      });
    }

    const contextEst = Math.min(EST_MAX_PERCENT, Math.round((totalEvents * EST_TOKENS_PER_EVENT) / (EST_CONTEXT_WINDOW / 100)));
    const { session } = get();
    const elapsed = session.startedAt ? (Date.now() - session.startedAt) / 1000 : 0;
    const tokensEst = Math.min(EST_MAX_PERCENT, Math.round(elapsed / EST_SECONDS_PER_TOKEN_UNIT + totalEvents * EST_TOKEN_UNITS_PER_EVENT));

    set({ contextPercent: contextEst, tokensPercent: tokensEst });
  },
}));
