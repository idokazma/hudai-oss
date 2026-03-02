import { EventEmitter } from 'events';
import type { AVPEvent } from '@hudai/shared';

/** Strip ANSI escape sequences */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export class ClaudeCodeParser extends EventEmitter {
  private sessionId: string;
  private pendingPermission: { tool: string; command: string } | null = null;
  /** When we see TodoWrite/TaskCreate/TaskUpdate, capture subsequent ⎿ lines */
  private capturingTodo = false;
  private todoLines: string[] = [];
  /**
   * Buffer sequential numbered lines to detect inline plans.
   * Non-numbered lines between numbered items (multi-line descriptions) are
   * simply ignored — only structural events (tool use, thinking, prompts) flush.
   */
  private numberedPlanBuffer: string[] = [];
  /** Dedup: track emitted task.start prompts to avoid re-emitting on terminal reflow */
  private emittedPrompts = new Set<string>();
  /** Dedup: track emitted inline plans to avoid re-emitting on terminal reflow */
  private emittedInlinePlans = new Set<string>();
  /** Track detected plan file path to avoid re-emitting */
  private detectedPlanFile: string | null = null;
  /** Track detected plan title to avoid re-emitting */
  private detectedPlanTitle: string | null = null;
  /** When true, the next non-empty box line is treated as the plan title */
  private capturingPlanTitle = false;

  constructor(sessionId: string) {
    super();
    this.sessionId = sessionId;
  }

  /** Reset dedup state (call on session change) */
  resetDedup() {
    this.emittedPrompts.clear();
    this.emittedInlinePlans.clear();
    this.numberedPlanBuffer = [];
  }

  feed(chunk: string) {
    // Strip ANSI escape codes — capture-pane -e includes them for the live terminal
    const lines = stripAnsi(chunk).split('\n');

    // Multi-line scan for permission prompts
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Detect permission block: "Bash command" or "Read file" header
      if (/^(Bash|Read|Edit|Write|Grep|Glob)\s+(command|file)/i.test(line)) {
        // Look ahead for the command and "Do you want to proceed?"
        const cmdLine = lines[i + 1]?.trim() ?? '';
        let hasPrompt = false;
        for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
          if (lines[j]?.includes('Do you want to proceed')) {
            hasPrompt = true;
            break;
          }
        }
        if (hasPrompt && cmdLine) {
          const toolName = line.split(/\s/)[0];
          this.pendingPermission = { tool: toolName, command: cmdLine };
        }
      }

      // "Do you want to proceed?" triggers the permission event
      if (line.includes('Do you want to proceed') && this.pendingPermission) {
        this.emitEvent({
          category: 'control',
          type: 'permission.prompt',
          data: this.pendingPermission,
        });
        this.pendingPermission = null;
        continue;
      }

      this.processLine(line);
    }
  }

  flush() {
    this.flushTodo();
    this.flushNumberedPlan();
  }

  /**
   * Detect inline numbered plans from agent output.
   * When 3+ sequentially numbered items (1. X, 2. Y, ...) have been buffered,
   * emit a plan.update event. Flushed by structural events (tool use, thinking,
   * prompts) — NOT by plain text lines, which may be multi-line continuations.
   */
  private flushNumberedPlan() {
    if (this.numberedPlanBuffer.length < 3) {
      this.numberedPlanBuffer = [];
      return;
    }

    const steps = this.numberedPlanBuffer;

    // Dedup: skip if we already emitted this exact plan
    const planKey = steps.join('|');
    if (this.emittedInlinePlans.has(planKey)) {
      this.numberedPlanBuffer = [];
      return;
    }
    this.emittedInlinePlans.add(planKey);

    this.emitEvent({
      category: 'reasoning',
      type: 'plan.update',
      data: { steps, currentStep: -1 },
    });

    this.numberedPlanBuffer = [];
  }

  /**
   * Try to add a numbered line to the plan buffer.
   * Returns true if the line was a sequential numbered item, false otherwise.
   * Handles "1. text", "2) text" etc. Starts a new sequence on "1." if a
   * previous sequence exists.
   */
  private tryBufferNumberedLine(line: string): boolean {
    const m = line.match(/^(\d+)[\.\)]\s+(.+)/);
    if (!m) return false;

    const num = parseInt(m[1]);
    const text = m[2].trim();

    // Skip very short text (likely not a real plan step)
    if (text.length < 5) return false;

    const expectedNext = this.numberedPlanBuffer.length + 1;

    if (num === 1) {
      // Start of a new sequence — flush any previous one first
      this.flushNumberedPlan();
      this.numberedPlanBuffer = [text];
      return true;
    }

    if (num === expectedNext) {
      // Sequential — add to current sequence
      this.numberedPlanBuffer.push(text);
      return true;
    }

    // Non-sequential number — not part of this plan
    return false;
  }

  private flushTodo() {
    if (!this.capturingTodo || this.todoLines.length === 0) {
      this.capturingTodo = false;
      this.todoLines = [];
      return;
    }

    // Parse todo lines into steps
    // Lines look like: "- [x] Task done", "- [ ] Task pending", "  ⎿ Updated todo list:", etc.
    const steps: string[] = [];
    let currentStep = -1;

    for (const raw of this.todoLines) {
      const line = raw.replace(/^⎿\s*/, '').trim();
      if (!line) continue;

      // Match checkbox format: [x] done, [ ] pending, [>] in progress
      const checkboxMatch = line.match(/^[-•*]\s*\[([x✓ >.])\]\s*(.+)/i);
      if (checkboxMatch) {
        const status = checkboxMatch[1].toLowerCase();
        const taskText = checkboxMatch[2].trim();
        steps.push(taskText);
        if (status === ' ' || status === '.' || status === '>') {
          // First non-done task is the current step
          if (currentStep === -1 && (status === '>' || status === ' ')) {
            currentStep = steps.length - 1;
          }
        }
        continue;
      }

      // Match numbered format: 1. Task, 2. Task
      const numberedMatch = line.match(/^\d+\.\s+(.+)/);
      if (numberedMatch) {
        steps.push(numberedMatch[1].trim());
        continue;
      }

      // Match plain task lines (from TaskCreate output): "Task: subject"
      const taskSubjectMatch = line.match(/^(?:Task|Subject|#\d+):\s*(.+)/i);
      if (taskSubjectMatch) {
        steps.push(taskSubjectMatch[1].trim());
        continue;
      }

      // "Updated todo list:" or similar header — skip
      if (/^(Updated|Created|Completed|Deleted|Todo|Tasks)/i.test(line)) continue;

      // If it's a substantial line not matched above, include it
      if (line.length > 3 && !line.startsWith('─')) {
        steps.push(line);
      }
    }

    if (steps.length > 0) {
      // If no explicit current step found, estimate from done count
      if (currentStep === -1) {
        // Find first non-done step by re-checking the original lines
        let doneCount = 0;
        for (const raw of this.todoLines) {
          const line = raw.replace(/^⎿\s*/, '').trim();
          const match = line.match(/^[-•*]\s*\[([x✓])\]/i);
          if (match) doneCount++;
        }
        currentStep = Math.min(doneCount, steps.length - 1);
      }

      this.emitEvent({
        category: 'reasoning',
        type: 'plan.update',
        data: { steps, currentStep },
      });
    }

    this.capturingTodo = false;
    this.todoLines = [];
  }

  private processLine(line: string) {
    if (!line) return;

    // If capturing todo output, collect ⎿ lines
    if (this.capturingTodo) {
      if (line.startsWith('⎿') || line.match(/^[-•*]\s*\[/) || line.match(/^\d+\.\s+/)) {
        this.todoLines.push(line);
        return;
      }
      // Non-⎿ line means todo output is done
      this.flushTodo();
      // Fall through to process this line normally
    }

    // Skip decorative/noise
    if (/^[─═┌┐└┘├┤┬┴┼│╔╗╚╝║▐▛▜▝▘╌╭╮╰╯\s]+$/.test(line)) { this.flushNumberedPlan(); return; }
    if (/^[─╌\-]{5,}$/.test(line)) { this.flushNumberedPlan(); return; }
    if (line.includes('Claude Code v')) return;
    if (/^\?\s*for shortcuts/.test(line)) return;
    if (/^esc to (interrupt|cancel)/.test(line)) return;
    if (/^[…+\d]+ lines/.test(line)) return;
    if (line.includes('ctrl+o to expand') || line.includes('ctrl+e to explain')) return;
    if (line.includes('Tab to amend')) return;
    if (/^Esc to cancel/.test(line)) return;
    // Skip permission menu options (1. Yes, 2. Yes and don't ask, 3. No)
    if (/^\d+\.\s*(Yes|No)/.test(line)) return;
    if (/^❯\s*\d+\.\s*(Yes|No)/.test(line)) return;
    if (/^Do you want to proceed/.test(line)) return;
    // Skip "Running…" / "Waiting…" status
    if (/^⎿\s*(Running|Waiting)/.test(line)) return;
    // Skip model info
    if (/Opus|Sonnet|Haiku|Claude Max/.test(line)) return;

    // Detect plan file path: ~/.claude/plans/some-name.md
    const planFileMatch = line.match(/~\/\.claude\/plans\/([a-zA-Z0-9_-]+\.md)/);
    if (planFileMatch && planFileMatch[1] !== this.detectedPlanFile) {
      this.detectedPlanFile = planFileMatch[1];
      this.emit('plan-file', planFileMatch[1]);
    }

    // Detect plan title from Claude Code's plan box display.
    // The box has a "Plan to implement" header line, followed by the title on
    // the next non-empty line, all wrapped in │ ... │ borders.
    const boxLineMatch = line.match(/^[│|]\s*(.+?)\s*[│|]?\s*$/);
    if (boxLineMatch) {
      const inner = boxLineMatch[1].trim();

      // "Plan to implement" header → next non-empty box line is the title
      if (/^Plan\s+to\s+implement$/i.test(inner)) {
        this.capturingPlanTitle = true;
      } else if (this.capturingPlanTitle && inner.length >= 5) {
        // This is the title line following "Plan to implement"
        this.capturingPlanTitle = false;
        if (inner !== this.detectedPlanTitle) {
          this.detectedPlanTitle = inner;
          this.emit('plan-title', inner);
        }
      }

      // Also handle "Plan: <title>" on a single line
      const planColonMatch = inner.match(/^Plan:\s*(.+)/i);
      if (planColonMatch) {
        const title = planColonMatch[1].trim();
        if (title.length >= 5 && title !== this.detectedPlanTitle) {
          this.capturingPlanTitle = false;
          this.detectedPlanTitle = title;
          this.emit('plan-title', title);
        }
      }
    } else {
      // Non-box line resets the title capture
      this.capturingPlanTitle = false;
    }

    // Tool use: ⏺ ToolName(args)
    const toolMatch = line.match(/^[⏺✻✶✳✽✢⚡●]?\s*(Read|Edit|Write|Bash|Grep|Glob|Search|WebFetch|WebSearch|Task|TodoWrite|TaskCreate|TaskUpdate|TaskList|NotebookEdit)\((.+)\)\s*$/);
    if (toolMatch) {
      const toolName = toolMatch[1];
      const args = toolMatch[2];

      // TodoWrite, TaskCreate, TaskUpdate — start capturing output
      if (toolName === 'TodoWrite' || toolName === 'TaskCreate' || toolName === 'TaskUpdate' || toolName === 'TaskList') {
        this.flushTodo(); // flush any previous
        this.capturingTodo = true;
        this.todoLines = [];
        // Also emit as tool event
        this.emitToolEvent(toolName, args);
        return;
      }

      this.emitToolEvent(toolName, args);
      return;
    }

    // Thinking/working indicators
    if (/^[·✢✻✶✳✽⚡]\s*(Fermenting|Baking|Thinking|Planning|Working|Brewing)/i.test(line)) {
      this.emitEvent({
        category: 'reasoning',
        type: 'think.start',
        data: { summary: line.replace(/^[·✢✻✶✳✽⚡]\s*/, '') },
      });
      return;
    }

    // Thinking complete
    if (/[✻✶✳✽⚡●⏺]\s*(Baked|Fermented|Done)\s+(for|in)\s+\d+/i.test(line)) {
      const durationMatch = line.match(/(\d+)s/);
      this.emitEvent({
        category: 'reasoning',
        type: 'think.end',
        data: { durationMs: parseInt(durationMatch?.[1] ?? '0') * 1000, summary: line },
      });
      return;
    }

    // User prompt: ❯ text (but not menu selection like ❯ 1. Yes)
    if (line.startsWith('❯') && !/^❯\s*\d+\./.test(line)) {
      const prompt = line.replace(/^❯\s*/, '').trim();
      if (prompt && !this.emittedPrompts.has(prompt)) {
        this.emittedPrompts.add(prompt);
        this.emitEvent({
          category: 'control',
          type: 'task.start',
          data: { prompt },
        });
      }
      return;
    }

    // Tool output (⎿) — skip details (unless capturing todo)
    if (line.startsWith('⎿')) return;

    // Task status lines from Claude Code's task spinner
    // e.g., "✓ Completed: Fix the bug" or "⏳ Working on: Refactor code"
    const taskStatusMatch = line.match(/^[✓✔☑]\s*(Completed|Done|Finished):\s*(.+)/i);
    if (taskStatusMatch) {
      this.emitEvent({
        category: 'control',
        type: 'task.complete',
        data: { summary: taskStatusMatch[2].trim() },
      });
      return;
    }

    // Agent response text (⏺ followed by text, not a tool)
    const agentTextMatch = line.match(/^[⏺✻✶✳✽✢●]\s+(.+)$/);
    if (agentTextMatch) {
      const text = agentTextMatch[1];
      if (/^(Read|Edit|Write|Bash|Grep|Glob|TodoWrite|TaskCreate|TaskUpdate)\(/.test(text)) return;

      // Try to buffer as a numbered plan step (agent-prefixed like ⏺ 1. Foo)
      this.tryBufferNumberedLine(text);

      this.emitEvent({
        category: 'control',
        type: 'raw.output',
        data: { text },
      });
      return;
    }

    // Plain text (no ⏺ prefix) — try to buffer as numbered plan step.
    // This catches plan steps rendered as indented text in Claude's plan mode.
    // Non-numbered lines are silently ignored (multi-line step descriptions).
    this.tryBufferNumberedLine(line);
  }

  private emitToolEvent(toolName: string, args: string) {
    const cleanArgs = args.replace(/^["']|["']$/g, '').trim();

    switch (toolName) {
      case 'Read':
        this.emitEvent({ category: 'navigation', type: 'file.read', data: { path: cleanArgs } });
        break;
      case 'Edit':
        this.emitEvent({ category: 'mutation', type: 'file.edit', data: { path: cleanArgs, additions: 0, deletions: 0 } });
        break;
      case 'Write':
        this.emitEvent({ category: 'mutation', type: 'file.create', data: { path: cleanArgs, lineCount: 0 } });
        break;
      case 'Bash':
        this.emitEvent({ category: 'execution', type: 'shell.run', data: { command: cleanArgs } });
        break;
      case 'Grep': case 'Search':
        this.emitEvent({ category: 'navigation', type: 'search.grep', data: { pattern: cleanArgs, matchCount: 0, files: [] } });
        break;
      case 'Glob':
        this.emitEvent({ category: 'navigation', type: 'search.glob', data: { pattern: cleanArgs, matchCount: 0, files: [] } });
        break;
      case 'TodoWrite':
      case 'TaskCreate':
      case 'TaskUpdate':
      case 'TaskList':
        // These are handled via the capturing mechanism; emit as control event
        this.emitEvent({ category: 'control', type: 'raw.output', data: { text: `${toolName}(${cleanArgs})` } });
        break;
      default:
        this.emitEvent({ category: 'execution', type: 'shell.run', data: { command: `${toolName}(${cleanArgs})` } });
    }
  }

  private emitEvent(partial: Omit<AVPEvent, 'id' | 'sessionId' | 'timestamp'>) {
    // Structural events (anything except raw.output) flush the numbered plan
    // buffer, since they indicate the plan text block has ended.
    if (partial.type !== 'raw.output') {
      this.flushNumberedPlan();
    }

    const event = {
      ...partial,
      id: crypto.randomUUID(),
      sessionId: this.sessionId,
      timestamp: Date.now(),
      source: 'tmux' as const,
    } as AVPEvent;
    this.emit('event', event);
  }
}
