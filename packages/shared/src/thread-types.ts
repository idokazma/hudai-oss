export type ThreadPhase = 'investigating' | 'implementing' | 'testing' | 'done' | 'error';

export interface ThreadOutcome {
  type: 'success' | 'error' | 'working';
  label?: string;
}

export interface ThreadSummary {
  threadId: string;        // matches task.start event id
  sessionId: string;
  prompt: string;          // user's original request (truncated)
  startedAt: number;
  completedAt: number | null;
  phase: ThreadPhase;
  summary: string | null;  // LLM 1-liner, null until ready
  bullets: string[] | null; // LLM bullet summary, null until ready
  outcome: ThreadOutcome | null;
  eventCount: number;
}
