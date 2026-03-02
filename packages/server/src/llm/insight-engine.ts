import type { AVPEvent, DependencyEdge, SessionState, ServerMessage, InsightSummary, InsightIntent, InsightNotification, AdvisorVerbosity } from '@hudai/shared';
import type { LLMProvider } from './llm-provider.js';

const ROLLING_BUFFER_SIZE = 30;
const INTENT_EVENT_THRESHOLD = 3;
const INTENT_REFRESH_INTERVAL = 15;
const SUMMARY_SIGNIFICANT_THRESHOLD = 20;
const SUMMARY_COOLDOWN_MS = 20_000;

const SIGNIFICANT_TYPES = new Set([
  'file.edit', 'file.create', 'file.delete', 'test.run', 'test.result',
  'shell.run', 'shell.output',
]);

function topLevelGroup(event: AVPEvent): string | null {
  const data = (event as any).data;
  const path: string | undefined = data?.path;
  if (!path) return null;
  const parts = path.split('/');
  return parts.length > 1 ? parts[0] : path;
}

function formatEventForPrompt(event: AVPEvent): string {
  const d = (event as any).data;
  switch (event.type) {
    case 'file.read': return `Read ${d.path}`;
    case 'file.edit': return `Edit ${d.path} (+${d.additions}/-${d.deletions})`;
    case 'file.create': return `Create ${d.path}`;
    case 'file.delete': return `Delete ${d.path}`;
    case 'shell.run': return `Shell: ${d.command}`;
    case 'shell.output': return `Shell result: exit=${d.exitCode}`;
    case 'test.run': return `Test run: ${d.command}`;
    case 'test.result': return `Tests: ${d.passed} passed, ${d.failed} failed`;
    case 'search.grep': return `Grep "${d.pattern}" → ${d.matchCount} matches`;
    case 'search.glob': return `Glob "${d.pattern}" → ${d.matchCount} matches`;
    case 'think.start': return `Thinking: ${d.summary || '...'}`;
    case 'plan.update': return `Plan step ${d.currentStep}/${d.steps.length}`;
    case 'permission.prompt': return `Permission: ${d.tool}`;
    case 'loop.warning': return `Loop warning: ${d.pattern} x${d.count}`;
    default: return event.type;
  }
}

export type IntentPhase = { text: string; detectedAt: number; filesEdited: Set<string>; shellCommands: string[]; testsPassed: number; testsFailed: number; errors: number };

export { formatEventForPrompt };

export class InsightEngine {
  private _recentEvents: AVPEvent[] = [];
  private significantEventCount = 0;
  private currentIntent: InsightIntent | null = null;
  private _intentHistory: IntentPhase[] = [];
  private lastSummaryAt = 0;
  private lastIntentGroup: string | null = null;
  private consecutiveGroupCount = 0;
  private eventsSinceIntentRefresh = 0;
  private pendingMessages: ServerMessage[] = [];

  // Notification tracking
  private permissionToolCounts = new Map<string, number>();
  private recentFailures: number[] = [];

  // Proactive trigger tracking
  private lastPhaseText: string | null = null;
  private hadFailures = false;
  private lastThinkStartAt = 0;
  private workingEventCount = 0;

  /** Optional callback for routing notifications to CommanderChat */
  onNotification?: (context: string, severity: 'info' | 'warning' | 'critical', triggeredBy: string, minVerbosity?: AdvisorVerbosity) => void;

  constructor(
    private gemini: LLMProvider,
    private getGraphEdges: () => DependencyEdge[],
  ) {}

  get recentEvents(): AVPEvent[] { return this._recentEvents; }
  get intentHistory(): IntentPhase[] { return this._intentHistory; }

  onEvent(event: AVPEvent, sessionState: SessionState): void {
    this._recentEvents.push(event);
    if (this._recentEvents.length > ROLLING_BUFFER_SIZE) {
      this._recentEvents.shift();
    }

    if (SIGNIFICANT_TYPES.has(event.type)) {
      this.significantEventCount++;
    }

    // --- Track stats on current phase ---
    const currentPhase = this._intentHistory[this._intentHistory.length - 1];
    if (currentPhase) {
      const d = (event as any).data;
      if ((event.type === 'file.edit' || event.type === 'file.create') && d?.path) {
        currentPhase.filesEdited.add(d.path);
      }
      if (event.type === 'shell.run' && d?.command) {
        currentPhase.shellCommands.push(d.command);
      }
      if (event.type === 'test.result') {
        currentPhase.testsPassed += d.passed || 0;
        currentPhase.testsFailed += d.failed || 0;
      }
      if (event.type === 'shell.output' && d?.exitCode && d.exitCode !== 0) {
        currentPhase.errors++;
      }
    }

    // --- Intent detection ---
    this.eventsSinceIntentRefresh++;
    const group = topLevelGroup(event);
    if (group) {
      if (group !== this.lastIntentGroup) {
        this.consecutiveGroupCount = 1;
        this.lastIntentGroup = group;
      } else {
        this.consecutiveGroupCount++;
      }

      const shouldGenIntent =
        (this.consecutiveGroupCount >= INTENT_EVENT_THRESHOLD && group !== this.currentIntent?.text) ||
        this.eventsSinceIntentRefresh >= INTENT_REFRESH_INTERVAL;

      if (shouldGenIntent) {
        this.eventsSinceIntentRefresh = 0;
        this.generateIntent(sessionState);
      }
    }

    // Auto summary disabled — periodic timer in index.ts handles this
    // to avoid duplicate broadcasts.

    // --- Proactive triggers ---

    // Track think.start for long-thinking detection
    if (event.type === 'think.start') {
      this.lastThinkStartAt = event.timestamp;
    } else if (SIGNIFICANT_TYPES.has(event.type)) {
      // Any significant action clears the thinking timer
      if (this.lastThinkStartAt > 0) {
        this.lastThinkStartAt = 0;
      }
    }

    // Long thinking: 60s since think.start with no action
    if (this.lastThinkStartAt > 0 && Date.now() - this.lastThinkStartAt > 60_000) {
      this.generateNotification(
        'Agent has been thinking for over 60 seconds without taking action — may be stuck',
        'info',
        'long.thinking',
        'normal',
      );
      this.lastThinkStartAt = 0; // reset so we don't spam
    }

    // Track test failures for recovery detection
    if (event.type === 'test.result') {
      const d = (event as any).data;
      if (d.failed > 0) {
        this.hadFailures = true;
      } else if (this.hadFailures && d.passed > 0 && d.failed === 0) {
        // Test recovery: tests pass after failure period
        this.hadFailures = false;
        this.generateNotification(
          `Tests recovering: ${d.passed} tests now passing after earlier failures`,
          'info',
          'test.recovery',
          'normal',
        );
      }
      // First-run success: 5+ tests pass
      if (!this.hadFailures && d.passed >= 5 && d.failed === 0) {
        this.generateNotification(
          `${d.passed} tests passed on first run`,
          'info',
          'test.success',
          'normal',
        );
      }
    }

    // Track working events for task completion
    if (SIGNIFICANT_TYPES.has(event.type)) {
      this.workingEventCount++;
    }

    // Progress milestone: every 30 significant events (verbose only)
    if (this.significantEventCount > 0 && this.significantEventCount % 30 === 0) {
      this.generateNotification(
        `Progress milestone: ${this.significantEventCount} significant actions completed`,
        'info',
        'progress.milestone',
        'verbose',
      );
    }

    // --- Smart notifications ---
    this.checkNotificationTriggers(event);
  }

  async requestSummary(events: AVPEvent[], sessionState: SessionState, contextPreview?: string): Promise<InsightSummary | null> {
    return this.generateSummaryDirect(events, sessionState, contextPreview);
  }

  flush(): ServerMessage[] {
    const msgs = this.pendingMessages;
    this.pendingMessages = [];
    return msgs;
  }

  /** Call when agent activity changes (e.g. working → waiting_input) */
  activityChanged(from: string | undefined, to: string | undefined): void {
    // Task completion: activity → waiting_input after 5+ working events
    if (to === 'waiting_input' && from === 'working' && this.workingEventCount >= 5) {
      this.generateNotification(
        `Agent completed a task after ${this.workingEventCount} actions — now waiting for input`,
        'info',
        'task.completion',
        'normal',
      );
    }
    if (to === 'working') {
      this.workingEventCount = 0;
    }
  }

  reset(): void {
    this._recentEvents = [];
    this.significantEventCount = 0;
    this.currentIntent = null;
    this._intentHistory = [];
    this.lastSummaryAt = 0;
    this.lastIntentGroup = null;
    this.consecutiveGroupCount = 0;
    this.eventsSinceIntentRefresh = 0;
    this.pendingMessages = [];
    this.permissionToolCounts.clear();
    this.recentFailures = [];
    this.lastPhaseText = null;
    this.hadFailures = false;
    this.lastThinkStartAt = 0;
    this.workingEventCount = 0;
  }

  // --- Intent generation ---

  private async generateIntent(sessionState: SessionState) {
    const recent = this._recentEvents.slice(-15);
    const lines = recent.map(formatEventForPrompt).join('\n');
    const currentFile = sessionState.agentCurrentFile || 'unknown';
    const dirs = [...new Set(recent.map(topLevelGroup).filter(Boolean))].join(', ');

    const prompt = `You are observing an AI coding agent. Based on these recent actions, describe in ONE sentence (max 12 words) what the agent is currently doing. Be specific about the feature/area, not generic.

Recent actions:
${lines}

Current file: ${currentFile}
Active directories: ${dirs}

Reply with ONLY the sentence, no quotes or punctuation.`;

    const result = await this.gemini.ask(prompt);
    if (!result) return;

    const text = result.trim().replace(/^["']|["']$/g, '').slice(0, 80);
    const intent: InsightIntent = {
      text,
      confidence: recent.length >= 10 ? 'high' : recent.length >= 5 ? 'medium' : 'low',
      detectedAt: Date.now(),
    };
    this.currentIntent = intent;

    // Phase transition detection
    if (this.lastPhaseText && text !== this.lastPhaseText) {
      this.generateNotification(
        `Phase transition: "${this.lastPhaseText}" → "${text}"`,
        'info',
        'phase.transition',
        'normal',
      );
      this.hadFailures = false; // reset on phase change
    }
    this.lastPhaseText = text;

    // Track intent history for richer summaries
    const lastIntent = this._intentHistory[this._intentHistory.length - 1];
    if (!lastIntent || lastIntent.text !== text) {
      this._intentHistory.push({
        text,
        detectedAt: Date.now(),
        filesEdited: new Set(),
        shellCommands: [],
        testsPassed: 0,
        testsFailed: 0,
        errors: 0,
      });
      if (this._intentHistory.length > 20) this._intentHistory.shift();
    }
    this.pendingMessages.push({ kind: 'insight.intent', intent });
  }

  // --- Summary generation (fire-and-forget from onEvent) ---

  private async generateSummary(recentEvents: AVPEvent[], sessionState: SessionState) {
    const summary = await this.generateSummaryDirect(recentEvents, sessionState);
    if (summary) {
      this.pendingMessages.push({ kind: 'insight.summary', summary });
    }
  }

  private async generateSummaryDirect(events: AVPEvent[], sessionState: SessionState, contextPreview?: string): Promise<InsightSummary | null> {
    this.lastSummaryAt = Date.now();

    const durationMin = sessionState.startedAt
      ? Math.round((Date.now() - sessionState.startedAt) / 60000)
      : 0;

    const hasLoopWarning = events.some(e => e.type === 'loop.warning');

    // Build rich phase descriptions with per-phase status
    const phaseLines = this._intentHistory.map((phase, i) => {
      const isLast = i === this._intentHistory.length - 1;
      const files = phase.filesEdited.size > 0
        ? `edited ${phase.filesEdited.size} file(s)`
        : 'no file changes yet';
      const tests = (phase.testsPassed + phase.testsFailed) > 0
        ? `, tests: ${phase.testsPassed} passed / ${phase.testsFailed} failed`
        : '';
      const errors = phase.errors > 0 ? `, ${phase.errors} error(s)` : '';
      const status = isLast ? '[IN PROGRESS]'
        : phase.errors > 0 || phase.testsFailed > 0 ? '[HAD ISSUES]'
        : '[DONE]';

      return `${i + 1}. ${phase.text} — ${files}${tests}${errors} ${status}`;
    });

    // Current intent for "what's happening now"
    const currentIntentText = this.currentIntent?.text || sessionState.agentActivity || sessionState.status;

    const prompt = `You are briefing a developer who just opened their dashboard and needs to get caught up on what their AI coding agent has been doing. Write a concise "catch me up" summary.

FORMAT: Use exactly these 3 sections with headers. Under each header, write 1-3 short bullet points starting with "- ". Nothing else.

**Objective**
(What is the agent trying to accomplish? The high-level goal/task.)

**Progress**
(What has been done so far? Key milestones, what worked, what hit problems.)

**Next Steps**
(What remains? What is the agent doing right now or about to do?)

DO NOT list individual files or low-level actions. Speak in plain language about the workflow narrative. Be specific about the actual task, not generic.

Session: ${durationMin} minutes | Current intent: ${currentIntentText}
${hasLoopWarning ? 'WARNING: Agent may be stuck in a loop.\n' : ''}
${phaseLines.length > 0 ? `Work phases (chronological):\n${phaseLines.join('\n')}` : 'No distinct work phases detected yet — agent is still in early exploration.'}
${contextPreview ? `\n--- FULL SESSION CONTEXT ---\n${contextPreview}` : ''}
Reply with ONLY the sections above.`;

    const result = await this.gemini.ask(prompt);
    if (!result) return null;

    const timestamps = events.map(e => e.timestamp);
    const summary: InsightSummary = {
      text: result.trim().slice(0, 1000),
      generatedAt: Date.now(),
      eventWindow: [
        timestamps.length > 0 ? Math.min(...timestamps) : Date.now(),
        timestamps.length > 0 ? Math.max(...timestamps) : Date.now(),
      ],
    };
    return summary;
  }

  // --- Smart notification triggers ---

  private checkNotificationTriggers(event: AVPEvent) {
    const data = (event as any).data;

    // file.delete → check for broken imports
    if (event.type === 'file.delete' && data?.path) {
      const edges = this.getGraphEdges();
      const importers = edges.filter(
        (e) => e.target === data.path && e.type === 'import'
      );
      if (importers.length > 0) {
        this.generateNotification(
          `Deleted ${data.path} which is imported by ${importers.length} file(s): ${importers.map(e => e.source).slice(0, 3).join(', ')}`,
          'warning',
          event.type,
        );
      }
    }

    // loop.warning — logged in timeline but no proactive notification (too noisy)

    // permission.prompt — repeated same tool
    if (event.type === 'permission.prompt' && data?.tool) {
      const count = (this.permissionToolCounts.get(data.tool) || 0) + 1;
      this.permissionToolCounts.set(data.tool, count);
      if (count >= 3 && count % 3 === 0) {
        this.generateNotification(
          `Permission for "${data.tool}" requested ${count} times — consider adding an allow rule`,
          'info',
          event.type,
        );
      }
    }

    // Consecutive test failures / shell errors
    if (event.type === 'test.result' && data?.failed > 0) {
      this.recentFailures.push(event.timestamp);
      this.checkConsecutiveFailures();
    }
    if (event.type === 'shell.output' && data?.exitCode && data.exitCode !== 0) {
      this.recentFailures.push(event.timestamp);
      this.checkConsecutiveFailures();
    }

    // file.edit on high in-degree file
    if (event.type === 'file.edit' && data?.path) {
      const edges = this.getGraphEdges();
      const importers = edges.filter(
        (e) => e.target === data.path && e.type === 'import'
      );
      if (importers.length > 5) {
        this.generateNotification(
          `Editing ${data.path} which has ${importers.length} importers — high blast radius`,
          'warning',
          event.type,
        );
      }
    }
  }

  private checkConsecutiveFailures() {
    const now = Date.now();
    this.recentFailures = this.recentFailures.filter((t) => now - t < 60_000);
    if (this.recentFailures.length >= 3 && this.recentFailures.length % 3 === 0) {
      this.generateNotification(
        `${this.recentFailures.length} failures in the last 60 seconds — agent may be struggling`,
        'warning',
        'consecutive.failures',
      );
    }
  }

  private async generateNotification(
    context: string,
    severity: InsightNotification['severity'],
    triggeredBy: string,
    minVerbosity?: AdvisorVerbosity,
  ) {
    // Route to CommanderChat if callback is set — this is the primary path.
    // Don't also emit insight.notification to avoid duplicate Telegram messages.
    if (this.onNotification) {
      this.onNotification(context, severity, triggeredBy, minVerbosity);
      return;
    }

    // Fallback: no CommanderChat, emit raw insight.notification
    const prompt = `You are an AI coding agent monitor. Write a single alert message (max 20 words) for this situation:
${context}

Reply with ONLY the alert message.`;

    const result = await this.gemini.ask(prompt);
    const text = result?.trim().slice(0, 120) || context.slice(0, 120);

    const notification: InsightNotification = {
      id: `insight-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      severity,
      triggeredBy,
      timestamp: Date.now(),
    };
    this.pendingMessages.push({ kind: 'insight.notification', notification });
  }
}
