import { EventEmitter } from 'events';
import { watch, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import crypto from 'node:crypto';
import type { AVPEvent, PermissionRule } from '@hudai/shared';
import { translateJsonlEntry, extractUsage, type JsonlEntry, type TranslateOptions } from './jsonl-to-avp.js';

/**
 * Watches Claude Code's JSONL transcript files for real-time structured events.
 *
 * Uses ~/.claude/history.jsonl to find the active session ID for a project,
 * then tails the corresponding {sessionId}.jsonl file.
 */
export class TranscriptWatcher extends EventEmitter {
  private transcriptDir: string;
  private projectPath: string;
  private filePath: string | null = null;
  private fileOffset = 0;
  private abortController: AbortController | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private sessionId: string;
  private seenToolIds = new Map<string, { name: string; ts: number; input?: Record<string, any> }>();
  private _active = false;
  private _permissionRules: PermissionRule[] = [];

  // Plan progress tracking
  private planSteps: string[] = [];
  private planCurrentStep = 0;
  private toolActivitySinceLastAdvance = 0;
  private lastEntryType: string = '';

  constructor(sessionId: string, projectPath: string) {
    super();
    this.sessionId = sessionId;
    this.projectPath = projectPath;
    const slug = TranscriptWatcher.projectSlug(projectPath);
    this.transcriptDir = join(homedir(), '.claude', 'projects', slug);
  }

  get active() {
    return this._active;
  }

  get watchedFile() {
    return this.filePath;
  }

  get transcriptDirectory() {
    return this.transcriptDir;
  }

  set permissionRules(rules: PermissionRule[]) {
    this._permissionRules = rules;
  }

  /**
   * Derive the project slug from a project path.
   * Claude Code replaces `/` and `.` with `-`, strips leading slash.
   * e.g. /home/user/Projects/myapp -> -home-user-Projects-myapp
   */
  static projectSlug(projectPath: string): string {
    const stripped = projectPath.startsWith('/') ? projectPath.slice(1) : projectPath;
    return '-' + stripped.replace(/[/.]/g, '-');
  }

  /**
   * Find the active session's JSONL file by reading ~/.claude/history.jsonl.
   * Each line: { project, sessionId, timestamp }
   * We find the most recent sessionId for our project path.
   */
  async findActiveTranscript(): Promise<string | null> {
    try {
      const historyPath = join(homedir(), '.claude', 'history.jsonl');
      const historyContent = await readFile(historyPath, 'utf-8');
      const lines = historyContent.split('\n');

      let latestSession = { id: '', timestamp: 0 };

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed);
          if (entry.project === this.projectPath && entry.timestamp > latestSession.timestamp) {
            latestSession = { id: entry.sessionId, timestamp: entry.timestamp };
          }
        } catch {
          // Skip malformed lines
        }
      }

      if (!latestSession.id) {
        return null;
      }

      // Check if the JSONL file exists and is recent
      const filePath = join(this.transcriptDir, `${latestSession.id}.jsonl`);
      try {
        const s = await stat(filePath);
        const ageMs = Date.now() - s.mtimeMs;
        if (ageMs > 30 * 60 * 1000) {
          return null;
        }
        return filePath;
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Start watching. Finds the active transcript and tails new lines.
   * If no transcript found, starts a retry timer (session may start after attach).
   */
  async start(): Promise<void> {
    this.filePath = await this.findActiveTranscript();

    if (!this.filePath) {
      console.log('[transcript] No active transcript found for', this.projectPath, '— retrying every 5s');
      this.startRetry();
      return;
    }

    await this.beginWatching();
  }

  private async beginWatching(): Promise<void> {
    if (!this.filePath) return;

    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }

    console.log('[transcript] Watching:', this.filePath);
    this._active = true;
    this.emit('active', this.filePath);

    // Backfill: read existing content from the start so we capture
    // earlier events (especially the first user prompt) that occurred
    // before Hudai attached.
    this.fileOffset = 0;
    await this.readNewLines();

    // Watch for changes
    this.abortController = new AbortController();
    const filePath = this.filePath;

    (async () => {
      try {
        const watcher = watch(filePath, { signal: this.abortController!.signal });
        for await (const event of watcher) {
          if (event.eventType === 'change') {
            await this.readNewLines();
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('[transcript] Watch error:', err);
        }
      }
    })();

    // Fallback poll every 2s
    this.pollTimer = setInterval(() => {
      this.readNewLines().catch(() => {});
    }, 2000);
  }

  private startRetry() {
    this.retryTimer = setInterval(async () => {
      this.filePath = await this.findActiveTranscript();
      if (this.filePath) {
        await this.beginWatching();
      }
    }, 5000);
  }

  stop() {
    this._active = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    this.filePath = null;
    this.fileOffset = 0;
    this.seenToolIds.clear();
    this.planSteps = [];
    this.planCurrentStep = 0;
    this.toolActivitySinceLastAdvance = 0;
  }

  /**
   * Track plan progress by correlating JSONL entries with plan steps.
   *
   * Strategy:
   * - When a plan.update event is emitted, store the plan steps
   * - Track tool activity (file edits, tests, searches) as work on current step
   * - When assistant text references the next step number/name, advance
   * - When a user turn boundary arrives after significant tool activity, advance
   * - Emit updated plan.update events to advance currentStep
   */
  private trackPlanProgress(entry: JsonlEntry, events: AVPEvent[]): void {
    // Pick up new plans from emitted events
    for (const ev of events) {
      if (ev.type === 'plan.update') {
        const steps = (ev as any).data?.steps;
        const currentStep = (ev as any).data?.currentStep ?? 0;
        if (Array.isArray(steps) && steps.length >= 2) {
          // Only reset if this is a genuinely new plan (different steps)
          const stepsKey = steps.join('|');
          const prevKey = this.planSteps.join('|');
          if (stepsKey !== prevKey) {
            this.planSteps = steps;
            this.planCurrentStep = currentStep;
            this.toolActivitySinceLastAdvance = 0;
          } else if (currentStep > this.planCurrentStep) {
            // Same plan but higher currentStep (e.g. from TodoWrite update)
            this.planCurrentStep = currentStep;
            this.toolActivitySinceLastAdvance = 0;
          }
        }
      }
    }

    // No plan to track
    if (this.planSteps.length === 0) return;

    // Count tool activity from events
    const WORK_EVENTS = new Set(['file.edit', 'file.create', 'file.read', 'exec.start', 'search.grep', 'search.glob']);
    for (const ev of events) {
      if (WORK_EVENTS.has(ev.type)) {
        this.toolActivitySinceLastAdvance++;
      }
    }

    // Check assistant text for step references that indicate advancement
    if (entry.type === 'assistant') {
      const content = entry.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            const advanced = this.checkTextForStepAdvance(block.text);
            if (advanced) return; // Already emitted update
          }
        }
      }
    }

    // Turn boundary: user entry after assistant work → advance if there was activity
    if (entry.type === 'user' && this.lastEntryType === 'assistant') {
      if (this.toolActivitySinceLastAdvance >= 3 && this.planCurrentStep < this.planSteps.length - 1) {
        this.advancePlanStep();
      }
    }

    this.lastEntryType = entry.type;
  }

  /**
   * Check assistant text for references to completing steps or moving to next step.
   * Returns true if plan was advanced.
   */
  private checkTextForStepAdvance(text: string): boolean {
    if (this.planCurrentStep >= this.planSteps.length - 1) return false;

    const lower = text.toLowerCase();
    const nextStepNum = this.planCurrentStep + 2; // 1-indexed for display
    const nextStepName = this.planSteps[this.planCurrentStep + 1]?.toLowerCase() || '';

    // Pattern: "Step N" or "step N:" where N is the next step
    const stepNumPattern = new RegExp(`\\bstep\\s+${nextStepNum}\\b`, 'i');
    // Pattern: "Now let's..." or "Moving on to..." or "Next," followed by step name keywords
    const transitionPattern = /\b(now (?:let'?s|i'?ll|we)|moving (?:on|to)|next[,:]|moving forward)\b/i;
    // Pattern: numbered reference like "2." or "2)" at start of a line
    const numberedRef = new RegExp(`^\\s*${nextStepNum}[.):]`, 'm');

    // Check if text mentions the next step by number
    if (stepNumPattern.test(text)) {
      if (this.toolActivitySinceLastAdvance >= 1) {
        this.advancePlanStep();
        return true;
      }
    }

    // Check for transition phrases + next step name keywords
    if (transitionPattern.test(lower) && this.toolActivitySinceLastAdvance >= 2) {
      // Extract key words from next step name and check if any appear in text
      const keywords = nextStepName.split(/\s+/).filter(w => w.length > 4);
      const mentionsNext = keywords.some(kw => lower.includes(kw));
      if (mentionsNext) {
        this.advancePlanStep();
        return true;
      }
    }

    // Check for numbered reference to next step at line start
    if (numberedRef.test(text) && this.toolActivitySinceLastAdvance >= 2) {
      this.advancePlanStep();
      return true;
    }

    return false;
  }

  /**
   * Advance the plan to the next step and emit an updated plan.update event.
   */
  private advancePlanStep(): void {
    if (this.planCurrentStep >= this.planSteps.length - 1) return;

    this.planCurrentStep++;
    this.toolActivitySinceLastAdvance = 0;

    console.log(`[plan-progress] Advanced to step ${this.planCurrentStep + 1}/${this.planSteps.length}: ${this.planSteps[this.planCurrentStep]}`);

    const event: AVPEvent = {
      id: crypto.randomUUID(),
      sessionId: this.sessionId,
      timestamp: Date.now(),
      category: 'reasoning',
      type: 'plan.update',
      source: 'transcript',
      data: {
        steps: this.planSteps,
        currentStep: this.planCurrentStep,
      },
    } as AVPEvent;

    this.emit('event', event);
  }

  private async readNewLines(): Promise<void> {
    if (!this.filePath) return;

    try {
      const s = await stat(this.filePath);
      if (s.size <= this.fileOffset) return;

      const buf = await readFile(this.filePath);
      const newData = buf.subarray(this.fileOffset).toString('utf-8');
      this.fileOffset = s.size;

      const lines = newData.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const entry: JsonlEntry = JSON.parse(trimmed);
          // Emit raw JSONL entry for status detection (SessionMonitor)
          this.emit('entry', entry);
          const opts: TranslateOptions | undefined = this._permissionRules.length > 0
            ? { permissionRules: this._permissionRules }
            : undefined;
          const events = translateJsonlEntry(entry, this.sessionId, this.seenToolIds, opts);
          for (const event of events) {
            this.emit('event', event);
          }
          // Plan progress tracking
          this.trackPlanProgress(entry, events);
          // Extract token usage for cost tracking
          const usageData = extractUsage(entry);
          if (usageData) {
            this.emit('usage', usageData);
          }
        } catch {
          // Partial JSON at end of file — will be complete next read
        }
      }
    } catch {
      // File might have been rotated
    }
  }
}
