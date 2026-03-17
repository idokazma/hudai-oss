import type { AVPEvent, ServerMessage, ThreadSummary, ThreadPhase, ThreadOutcome } from '@hudai/shared';
import type { LLMProvider } from './llm-provider.js';
import { formatEventForPrompt } from './insight-engine.js';
import { ThreadSummaryStore } from '../persistence/event-store.js';

const MAX_THREADS = 30;
const MAX_EVENTS_PER_THREAD = 50;
const SUMMARY_DEBOUNCE_MS = 3_000;

interface ThreadState {
  threadId: string;
  sessionId: string;
  prompt: string;
  startedAt: number;
  completedAt: number | null;
  phase: ThreadPhase;
  summary: string | null;
  bullets: string[] | null;
  outcome: ThreadOutcome | null;
  events: AVPEvent[];
  summaryRequested: boolean;
}

function detectPhase(eventType: string): ThreadPhase | null {
  switch (eventType) {
    case 'file.read':
    case 'search.grep':
    case 'search.glob':
    case 'think.start':
    case 'think.end':
      return 'investigating';
    case 'file.edit':
    case 'file.create':
    case 'file.delete':
      return 'implementing';
    case 'test.run':
    case 'test.result':
    case 'shell.run':
      return 'testing';
    case 'agent.error':
      return 'error';
    default:
      return null;
  }
}

const PHASE_ORDER: Record<ThreadPhase, number> = {
  investigating: 0,
  implementing: 1,
  testing: 2,
  done: 3,
  error: 4,
};

export class ThreadSummarizer {
  private threads: ThreadState[] = [];
  private activeThreadId: string | null = null;
  private pendingMessages: ServerMessage[] = [];
  private summaryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private summaryStore: ThreadSummaryStore;
  private projectPath: string | null = null;

  /** Called when async LLM results are ready and need broadcasting */
  onFlushReady?: (messages: ServerMessage[]) => void;

  constructor(private llm: LLMProvider) {
    this.summaryStore = new ThreadSummaryStore();
  }

  onEvent(event: AVPEvent): void {
    if (event.type === 'task.start') {
      // Finalize previous thread
      this.finalizeActive();

      const prompt = ((event as any).data?.prompt || '').trim();
      if (!prompt) return;

      const thread: ThreadState = {
        threadId: event.id,
        sessionId: event.sessionId,
        prompt: prompt.slice(0, 500),
        startedAt: event.timestamp,
        completedAt: null,
        phase: 'investigating',
        summary: null,
        bullets: null,
        outcome: { type: 'working' },
        events: [event],
        summaryRequested: false,
      };

      this.threads.push(thread);
      if (this.threads.length > MAX_THREADS) {
        this.threads.shift();
      }
      this.activeThreadId = thread.threadId;
      this.pendingMessages.push({ kind: 'thread.update', thread: this.toSummary(thread) });
      return;
    }

    // Update active thread
    const active = this.getActive();
    if (!active) return;

    if (active.events.length < MAX_EVENTS_PER_THREAD) {
      active.events.push(event);
    }

    const newPhase = detectPhase(event.type);
    if (newPhase) {
      // Only advance phase forward (investigating -> implementing -> testing), or set error
      if (newPhase === 'error' || PHASE_ORDER[newPhase] > PHASE_ORDER[active.phase]) {
        active.phase = newPhase;
        if (newPhase === 'error') {
          active.outcome = { type: 'error' };
        }
        this.pendingMessages.push({ kind: 'thread.update', thread: this.toSummary(active) });
      }
    }
  }

  onActivityIdle(): void {
    this.finalizeActive();
  }

  private finalizeActive(): void {
    const active = this.getActive();
    if (!active) return;

    if (active.phase !== 'done' && active.phase !== 'error') {
      active.phase = 'done';
    }
    active.completedAt = Date.now();
    if (active.outcome?.type === 'working') {
      active.outcome = { type: active.phase === 'error' ? 'error' : 'success' };
    }
    this.activeThreadId = null;
    this.pendingMessages.push({ kind: 'thread.update', thread: this.toSummary(active) });

    // Schedule LLM summary (debounced)
    this.scheduleSummary(active);
  }

  private scheduleSummary(thread: ThreadState): void {
    if (thread.summaryRequested) return;
    // Clear any existing timer
    const existing = this.summaryTimers.get(thread.threadId);
    if (existing) clearTimeout(existing);

    this.summaryTimers.set(thread.threadId, setTimeout(() => {
      this.summaryTimers.delete(thread.threadId);
      this.requestSummary(thread);
    }, SUMMARY_DEBOUNCE_MS));
  }

  private async requestSummary(thread: ThreadState): Promise<void> {
    if (thread.summaryRequested) return;
    thread.summaryRequested = true;

    const eventLines = thread.events.map(formatEventForPrompt).join('\n');
    const prompt = `You are summarizing a code agent's work on a single task.

USER REQUEST: "${thread.prompt}"

EVENTS:
${eventLines}

Respond with ONLY valid JSON, no markdown:
{"summary": "<ONE sentence summary of what was done>", "bullets": ["<bullet 1: key action or finding>", "<bullet 2>", ...], "outcome": "<short label like 'PR merged', 'bug fixed', 'tests passing', 'error: build failed', etc.>"}

Rules for bullets:
- 2-5 bullets, each under 60 chars
- Focus on what was done: files changed, bugs found, tests run
- No fluff, no "started investigating" — only concrete actions`;

    try {
      const result = await this.llm.askQuiet(prompt, 'Thread summary');
      if (!result) return;

      const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      thread.summary = parsed.summary || null;
      thread.bullets = Array.isArray(parsed.bullets) ? parsed.bullets.filter((b: any) => typeof b === 'string' && b.length > 0) : null;
      if (parsed.outcome) {
        const isError = typeof parsed.outcome === 'string' && parsed.outcome.toLowerCase().startsWith('error');
        thread.outcome = {
          type: isError ? 'error' : (thread.phase === 'error' ? 'error' : 'success'),
          label: parsed.outcome,
        };
      }
      const summary = this.toSummary(thread);
      const msg: ServerMessage = { kind: 'thread.update', thread: summary };
      this.pendingMessages.push(msg);
      // Persist to DB
      if (this.projectPath) {
        try { this.summaryStore.save(this.projectPath, summary); } catch {}
      }
      // If async (bootstrap), broadcast immediately via callback
      if (this.onFlushReady) {
        const msgs = this.flush();
        if (msgs.length > 0) this.onFlushReady(msgs);
      }
    } catch (err) {
      console.error('[thread-summarizer] LLM summary failed:', err);
    }
  }

  flush(): ServerMessage[] {
    const msgs = this.pendingMessages;
    this.pendingMessages = [];
    return msgs;
  }

  getAll(): ThreadSummary[] {
    return this.threads.map((t) => this.toSummary(t));
  }

  bootstrap(events: AVPEvent[], projectPath?: string): void {
    this.projectPath = projectPath ?? null;

    // Load cached summaries from DB
    const cachedMap = new Map<string, ThreadSummary>();
    if (projectPath) {
      try {
        const earliest = events.length > 0 ? events[0].timestamp : Date.now() - 12 * 60 * 60 * 1000;
        const cached = this.summaryStore.getByProject(projectPath, earliest);
        for (const t of cached) cachedMap.set(t.threadId, t);
      } catch {}
    }

    // Group events into threads by task.start boundaries
    let current: ThreadState | null = null;

    for (const event of events) {
      if (event.type === 'task.start') {
        // Finalize previous
        if (current) {
          if (current.phase !== 'done' && current.phase !== 'error') {
            current.phase = 'done';
          }
          current.completedAt = event.timestamp;
          if (current.outcome?.type === 'working') {
            current.outcome = { type: current.phase === 'error' ? 'error' : 'success' };
          }
        }

        const prompt = ((event as any).data?.prompt || '').trim();
        if (!prompt) continue;

        // Check if we have a cached summary for this thread
        const cached = cachedMap.get(event.id);

        current = {
          threadId: event.id,
          sessionId: event.sessionId,
          prompt: prompt.slice(0, 500),
          startedAt: event.timestamp,
          completedAt: null,
          phase: 'investigating',
          summary: cached?.summary ?? null,
          bullets: cached?.bullets ?? null,
          outcome: cached?.outcome ?? { type: 'working' },
          events: [event],
          summaryRequested: !!cached?.summary,  // skip LLM if we have cached summary
        };
        this.threads.push(current);
        continue;
      }

      if (!current) continue;

      if (current.events.length < MAX_EVENTS_PER_THREAD) {
        current.events.push(event);
      }

      const newPhase = detectPhase(event.type);
      if (newPhase && (newPhase === 'error' || PHASE_ORDER[newPhase] > PHASE_ORDER[current.phase])) {
        current.phase = newPhase;
        if (newPhase === 'error') {
          current.outcome = { type: 'error' };
        }
      }
    }

    // Finalize last thread if it's done (no active work)
    if (current) {
      if (current.phase !== 'done' && current.phase !== 'error') {
        current.phase = 'done';
      }
      current.completedAt = Date.now();
      if (current.outcome?.type === 'working') {
        current.outcome = { type: current.phase === 'error' ? 'error' : 'success' };
      }
    }

    // Trim to max
    if (this.threads.length > MAX_THREADS) {
      this.threads = this.threads.slice(-MAX_THREADS);
    }

    // Emit thread.list
    this.pendingMessages.push({ kind: 'thread.list', threads: this.getAll() });

    // Schedule LLM summaries only for threads WITHOUT cached summaries
    const needsSummary = this.threads.filter((t) => t.completedAt && !t.summaryRequested && t.events.length > 2);
    needsSummary.forEach((thread, i) => {
      const delay = SUMMARY_DEBOUNCE_MS + i * 2_000; // stagger 2s apart
      this.summaryTimers.set(thread.threadId, setTimeout(() => {
        this.summaryTimers.delete(thread.threadId);
        this.requestSummary(thread);
      }, delay));
    });
  }

  reset(): void {
    // Clear timers
    this.summaryTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.summaryTimers.clear();
    this.threads = [];
    this.activeThreadId = null;
    this.pendingMessages = [];
  }

  private getActive(): ThreadState | null {
    if (!this.activeThreadId) return null;
    return this.threads.find((t) => t.threadId === this.activeThreadId) || null;
  }

  private toSummary(t: ThreadState): ThreadSummary {
    return {
      threadId: t.threadId,
      sessionId: t.sessionId,
      prompt: t.prompt,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      phase: t.phase,
      summary: t.summary,
      bullets: t.bullets,
      outcome: t.outcome,
      eventCount: t.events.length,
    };
  }
}
