import type { AVPEvent, ChatMessage, SessionState, ServerMessage, DependencyEdge, AdvisorVerbosity, AdvisorScope } from '@hudai/shared';
import type { LLMProvider } from './llm-provider.js';

const MAX_HISTORY = 100;
const CONTEXT_MESSAGES = 20;

const THROTTLE_MS: Record<AdvisorVerbosity, number> = {
  quiet: Infinity,    // only critical bypasses
  normal: 15 * 60_000, // 15 min
  verbose: 5 * 60_000, // 5 min
};

interface IntentPhase {
  text: string;
  detectedAt: number;
  filesEdited: Set<string>;
  shellCommands: string[];
  testsPassed: number;
  testsFailed: number;
  errors: number;
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

const NOISE_EVENT_TYPES = new Set([
  'raw.output',      // handled separately as agent narrative
  'shell.output',    // redundant with shell.run
  'think.end',       // think.start is enough
]);

/** Check if a raw.output line is agent narrative (not tool calls or junk) */
function isAgentNarrative(text: string): boolean {
  if (!text || text.length < 15) return false;
  // Tool invocations: "ToolName(args)" or "Name - action (MCP)(args)"
  if (/^[A-Z]\w+\(/.test(text)) return false;
  if (/\(MCP\)\s*\(/.test(text)) return false;
  if (/^[\w-]+\s+-\s+[\w-]+\s+\(MCP\)/.test(text)) return false;
  // Thinking duration lines: "Brewed for 7m 29s", etc.
  if (/^(Brewed|Baked|Fermented|Done|Thinking)\s+(for|in)\s+\d+/i.test(text)) return false;
  // Code / structural junk
  if (/^[\{\[\(`<]/.test(text)) return false;
  if (/^[+-]{3}\s/.test(text)) return false;
  if (/^@@\s/.test(text)) return false;
  // File paths standing alone
  if (/^(\/[\w.\-/]+)+$/.test(text)) return false;
  // Spinner / status chrome
  if (/^[·✢✻✶✳✽⚡●⏺]\s*(Fermenting|Baking|Thinking|Planning|Working|Brewing)/i.test(text)) return false;
  return true;
}

/** Build a chronological conversation timeline: user prompts + agent notes + todo actions */
function buildConversationTimeline(events: AVPEvent[]): string[] {
  const lines: string[] = [];
  for (const ev of events) {
    if (ev.type === 'task.start') {
      const prompt = ((ev as any).data?.prompt || '').trim();
      if (prompt) {
        lines.push(`  U: ${prompt}`);
      }
    } else if (ev.type === 'raw.output') {
      const text = ((ev as any).data?.text || '').trim();
      // Capture todo/task tool usage as TODO entries
      if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList)\(/.test(text)) {
        lines.push(`  TODO: ${text}`);
      } else if (isAgentNarrative(text)) {
        lines.push(`  A: ${text}`);
      }
    }
  }
  return lines;
}

const DEFAULT_SYSTEM_PROMPT = `You are the Commander's Advisor observing an AI coding agent working in a developer's codebase. Your role:
- Answer questions about agent activity, files edited, tests run, errors encountered
- Provide concise summaries when asked
- Flag concerns about loops, failures, or risky edits
- Be concise: 1-4 sentences unless the user asks for detail
- You do NOT control the agent — you only observe and advise
- Use technical language appropriate for a developer audience
- When listing files or events, use short bullet points
- You can also see other active agents in the SWARM STATUS section. Answer questions about "all agents", "swarm", or "other sessions" using this context.`;

const DEFAULT_PROACTIVE_PROMPT = `Write a brief advisor message (1-2 sentences) about this alert for the developer. Be specific and actionable. Reply with ONLY the message text.`;

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export class CommanderChat {
  private history: ChatMessage[] = [];
  private pendingMessages: ServerMessage[] = [];
  private sessionId = '';
  private verbosity: AdvisorVerbosity = 'normal';
  private scope: AdvisorScope = 'global';
  private lastProactiveAt = 0;
  private lastProactiveTrigger: string | null = null;
  private customSystemPrompt?: string;
  private customProactivePrompt?: string;

  constructor(
    private gemini: LLMProvider,
    private getRecentEvents: () => AVPEvent[],
    private getSessionState: () => SessionState,
    private getIntentHistory: () => IntentPhase[],
    private getGraphEdges: () => DependencyEdge[],
    private getSwarmSummary: () => string = () => '',
    private getAllEvents: () => AVPEvent[] = () => [],
  ) {}

  setSessionId(id: string): void {
    this.sessionId = id;
  }

  setVerbosity(v: AdvisorVerbosity): void {
    this.verbosity = v;
  }

  getVerbosity(): AdvisorVerbosity {
    return this.verbosity;
  }

  setScope(s: AdvisorScope): void {
    this.scope = s;
  }

  getScope(): AdvisorScope {
    return this.scope;
  }

  getSystemPrompt(): string {
    return this.customSystemPrompt || DEFAULT_SYSTEM_PROMPT;
  }

  setSystemPrompt(p: string | undefined): void {
    this.customSystemPrompt = p;
  }

  getProactivePrompt(): string {
    return this.customProactivePrompt || DEFAULT_PROACTIVE_PROMPT;
  }

  setProactivePrompt(p: string | undefined): void {
    this.customProactivePrompt = p;
  }

  getDefaultSystemPrompt(): string {
    return DEFAULT_SYSTEM_PROMPT;
  }

  getDefaultProactivePrompt(): string {
    return DEFAULT_PROACTIVE_PROMPT;
  }

  isCustomPrompts(): boolean {
    return !!(this.customSystemPrompt || this.customProactivePrompt);
  }

  getContextPreview(allEvents?: AVPEvent[]): string {
    const state = this.getSessionState();
    const all = allEvents || this.getAllEvents();
    const events = all.length > 0 ? all : this.getRecentEvents();
    const intents = this.getIntentHistory();
    const edges = this.getGraphEdges();
    const lines: string[] = [];

    // ── Header: What is this session about?
    const uptime = state.startedAt
      ? formatDuration(Date.now() - state.startedAt)
      : 'unknown';
    lines.push(`SESSION  ${state.status.toUpperCase()}  |  ${state.eventCount} events  |  ${uptime}`);
    if (state.taskLabel) {
      lines.push(`Goal: ${state.taskLabel}`);
    }
    lines.push('');

    // ── The Story: work phases as a to-do list
    lines.push('JOURNEY');
    lines.push('───────');
    if (intents.length > 0) {
      for (let i = 0; i < intents.length; i++) {
        const phase = intents[i];
        const isLast = i === intents.length - 1;
        const isCurrent = isLast && state.status === 'running';

        // Status icon
        const icon = isCurrent ? '▶' : '✓';

        // Stats
        const parts: string[] = [];
        if (phase.filesEdited.size > 0) parts.push(`${phase.filesEdited.size} files edited`);
        if (phase.shellCommands.length > 0) parts.push(`${phase.shellCommands.length} commands`);
        if (phase.testsPassed + phase.testsFailed > 0) {
          const total = phase.testsPassed + phase.testsFailed;
          parts.push(`tests ${phase.testsPassed}/${total}`);
        }
        if (phase.errors > 0) parts.push(`${phase.errors} errors`);
        const stats = parts.length > 0 ? `  (${parts.join(', ')})` : '';

        // Duration
        const nextStart = i < intents.length - 1 ? intents[i + 1].detectedAt : Date.now();
        const dur = formatDuration(nextStart - phase.detectedAt);

        lines.push(`  ${icon} ${phase.text}${stats}  [${dur}]`);

        // Show edited files for current phase
        if (isCurrent && phase.filesEdited.size > 0) {
          for (const f of phase.filesEdited) {
            lines.push(`      · ${f}`);
          }
        }
      }
    } else {
      // No intents detected — build a summary from events
      const meaningful = events.filter(e => !NOISE_EVENT_TYPES.has(e.type));
      const fileSet = new Set<string>();
      let shellCount = 0;
      for (const ev of meaningful) {
        const d = (ev as any).data;
        if (d?.path) fileSet.add(d.path);
        if (ev.type === 'shell.run') shellCount++;
      }
      if (meaningful.length > 0) {
        const parts: string[] = [];
        if (fileSet.size > 0) parts.push(`${fileSet.size} files touched`);
        if (shellCount > 0) parts.push(`${shellCount} commands run`);
        lines.push(`  ▶ Working  (${parts.join(', ') || `${meaningful.length} actions`})`);
      } else {
        lines.push('  (no phases detected yet)');
      }
    }
    lines.push('');

    // ── Plan: latest plan.update with step status
    const planEvents = events.filter(e => e.type === 'plan.update');
    if (planEvents.length > 0) {
      const latest = planEvents[planEvents.length - 1] as any;
      const steps: string[] = latest.data?.steps || [];
      const current: number = latest.data?.currentStep ?? 0;
      if (steps.length > 0) {
        lines.push('PLAN');
        lines.push('────');
        for (let i = 0; i < steps.length; i++) {
          const icon = i < current ? '✓' : i === current ? '▶' : '○';
          lines.push(`  ${icon} ${i + 1}. ${steps[i]}`);
        }
        lines.push('');
      }
    }

    // ── Conversation: user prompts + agent explanations, chronologically
    const timeline = buildConversationTimeline(events);
    if (timeline.length > 0) {
      lines.push('CONVERSATION');
      lines.push('────────────');
      // Show last 30 entries
      for (const entry of timeline) {
        lines.push(entry);
      }
      lines.push('');
    }

    // ── Right Now
    lines.push('RIGHT NOW');
    lines.push('─────────');
    if (state.agentActivity === 'waiting_permission') {
      lines.push(`  ⚠ Waiting for permission: ${state.agentActivityDetail || 'unknown tool'}`);
    } else if (state.agentActivity === 'waiting_input') {
      lines.push('  ⏸ Idle — waiting for next instruction');
    } else if (state.agentActivity === 'waiting_answer') {
      lines.push(`  ? Asking: ${state.agentActivityDetail || '...'}`);
    } else if (state.agentActivity === 'working') {
      lines.push(`  ⚙ Working${state.agentCurrentFile ? ` on ${state.agentCurrentFile}` : ''}`);
    } else {
      lines.push(`  ${state.agentActivity || state.status}`);
    }

    if (state.agentBreadcrumb && state.agentBreadcrumb.length > 1) {
      lines.push(`  Agent stack: ${state.agentBreadcrumb.join(' → ')}`);
    }
    if (state.activeSubagentCount && state.activeSubagentCount > 0) {
      lines.push(`  ${state.activeSubagentCount} sub-agent(s) active`);
    }
    lines.push('');

    // ── Recent actions (filter noise, show last 10 meaningful)
    const meaningful = events.filter(e => !NOISE_EVENT_TYPES.has(e.type));
    const tail = meaningful.slice(-10);
    if (tail.length > 0) {
      lines.push('RECENT ACTIONS');
      lines.push('──────────────');
      for (const ev of tail) {
        const ago = formatDuration(Date.now() - ev.timestamp);
        lines.push(`  ${formatEventForPrompt(ev)}  (${ago} ago)`);
      }
      lines.push('');
    }

    // ── Codebase
    if (edges.length > 0) {
      lines.push(`CODEBASE  ${edges.length} dependency edges tracked`);
    }

    // ── Swarm
    const swarmSummary = this.getSwarmSummary();
    if (swarmSummary) {
      lines.push('');
      lines.push('SWARM');
      lines.push('─────');
      lines.push(swarmSummary);
    }

    return lines.join('\n');
  }

  async onUserMessage(sessionId: string, text: string): Promise<void> {
    this.sessionId = sessionId;

    const userMsg: ChatMessage = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      timestamp: Date.now(),
      role: 'user',
      text,
    };
    this.addToHistory(userMsg);
    this.pendingMessages.push({ kind: 'chat.message', message: userMsg });

    // Show typing indicator
    this.pendingMessages.push({ kind: 'chat.typing', typing: true });

    const contextBlock = this.getContextPreview();
    const chatHistory = this.history.slice(-CONTEXT_MESSAGES);
    const conversationLines = chatHistory
      .filter(m => m.role !== 'system')
      .map(m => `${m.role === 'user' ? 'User' : 'Advisor'}: ${m.text}`)
      .join('\n');

    const prompt = `${this.getSystemPrompt()}

--- SESSION CONTEXT ---
${contextBlock}

--- CHAT HISTORY ---
${conversationLines}

Respond to the user's latest message as the Advisor. Reply with ONLY your response text.`;

    const result = await this.gemini.ask(prompt);

    // Stop typing
    this.pendingMessages.push({ kind: 'chat.typing', typing: false });

    if (!result) {
      const busyMsg: ChatMessage = {
        id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sessionId,
        timestamp: Date.now(),
        role: 'system',
        text: 'Advisor is busy — try again in a moment.',
      };
      this.addToHistory(busyMsg);
      this.pendingMessages.push({ kind: 'chat.message', message: busyMsg });
      return;
    }

    const advisorMsg: ChatMessage = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      timestamp: Date.now(),
      role: 'advisor',
      text: result.trim().slice(0, 1000),
    };
    this.addToHistory(advisorMsg);
    this.pendingMessages.push({ kind: 'chat.message', message: advisorMsg });
  }

  async pushProactive(
    context: string,
    severity: 'info' | 'warning' | 'critical',
    triggeredBy: string,
    minVerbosity?: AdvisorVerbosity,
  ): Promise<void> {
    // Throttle check — critical always bypasses
    if (severity !== 'critical') {
      // Check minimum verbosity requirement
      const levels: AdvisorVerbosity[] = ['quiet', 'normal', 'verbose'];
      const currentLevel = levels.indexOf(this.verbosity);
      const requiredLevel = levels.indexOf(minVerbosity || 'normal');
      if (currentLevel < requiredLevel) return;

      // In quiet mode, only critical gets through
      if (this.verbosity === 'quiet') return;

      // Don't send when session is idle
      const state = this.getSessionState();
      if (state.status === 'idle' || state.agentActivity === 'waiting_input') return;

      // Throttle by time interval
      const elapsed = Date.now() - this.lastProactiveAt;
      if (elapsed < THROTTLE_MS[this.verbosity]) return;
    }

    // Set timestamp BEFORE the async call to prevent concurrent duplicates
    this.lastProactiveAt = Date.now();

    // Dedup: skip if same triggeredBy was the last proactive message
    if (triggeredBy === this.lastProactiveTrigger) return;
    this.lastProactiveTrigger = triggeredBy;
    const contextBlock = this.getContextPreview();

    const prompt = `${this.getSystemPrompt()}

--- SESSION CONTEXT ---
${contextBlock}

--- ALERT ---
${context}

${this.getProactivePrompt()}`;

    const result = await this.gemini.ask(prompt);
    const text = result?.trim().slice(0, 300) || context.slice(0, 300);

    const msg: ChatMessage = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      role: 'advisor',
      text,
      proactive: true,
      triggeredBy,
      severity,
    };
    this.addToHistory(msg);
    this.pendingMessages.push({ kind: 'chat.message', message: msg });
  }

  flush(): ServerMessage[] {
    const msgs = this.pendingMessages;
    this.pendingMessages = [];
    return msgs;
  }

  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  reset(): void {
    this.pendingMessages = [];
    this.sessionId = '';
    this.lastProactiveTrigger = null;
  }

  clearHistory(): void {
    this.history = [];
    this.pendingMessages = [];
    this.sessionId = '';
  }

  private addToHistory(msg: ChatMessage): void {
    this.history.push(msg);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
  }
}
