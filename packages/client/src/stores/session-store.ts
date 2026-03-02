import { create } from 'zustand';
import type { SessionState, AVPEvent } from '@hudai/shared';

export interface TestHealth {
  passed: number;
  failed: number;
  total: number;
  lastRun: number;
}

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

    // Heuristic context estimate: ~200k token window, each event ~500 tokens avg
    // Cap at 95% since we can't know exactly
    const contextEst = Math.min(95, Math.round((totalEvents * 500) / 2000));
    // Token estimate: based on elapsed time and event density
    const { session } = get();
    const elapsed = session.startedAt ? (Date.now() - session.startedAt) / 1000 : 0;
    const tokensEst = Math.min(95, Math.round(elapsed / 30 + totalEvents * 0.3));

    set({ contextPercent: contextEst, tokensPercent: tokensEst });
  },
}));
