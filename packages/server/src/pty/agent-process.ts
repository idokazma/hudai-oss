import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface AgentProcessOptions {
  tmuxTarget: string;
}

export interface SpawnAgentOptions {
  /** Directory where the new Claude agent should run */
  projectPath: string;
  /** Optional initial prompt to send to Claude after it starts */
  prompt?: string;
  /** Optional custom tmux session name */
  sessionName?: string;
}

function findBinary(name: string): string {
  try {
    return execSync(`zsh -lc "which ${name}"`, { encoding: 'utf-8' }).trim();
  } catch {
    return name;
  }
}

const TMUX = findBinary('tmux');

function tmuxExec(args: string): string {
  return execSync(`${TMUX} ${args}`, { encoding: 'utf-8' });
}

export class AgentProcess extends EventEmitter {
  private tmuxTarget: string = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastCaptureLines: string[] = [];
  private lastPaneContentStr: string = '';
  private _running = false;

  get running() {
    return this._running;
  }

  static getPaneCwd(tmuxTarget: string): string {
    return tmuxExec(`display-message -t "${tmuxTarget}" -p "#{pane_current_path}"`).trim();
  }

  /**
   * Get the shell PID of a tmux pane.
   */
  static getPanePid(tmuxTarget: string): number | undefined {
    try {
      const pid = tmuxExec(`display-message -t "${tmuxTarget}" -p "#{pane_pid}"`).trim();
      const n = parseInt(pid, 10);
      return isNaN(n) ? undefined : n;
    } catch {
      return undefined;
    }
  }

  /**
   * Find the Claude Code child process PID given a shell PID.
   * Walks the process tree: shell → claude (node) process.
   */
  static getClaudeChildPid(panePid: number): number | undefined {
    try {
      // pgrep -P finds direct children of the shell process
      const children = execSync(`pgrep -P ${panePid}`, { encoding: 'utf-8' }).trim();
      const pids = children.split('\n').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
      // Return the first child — typically the claude process
      return pids[0];
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve a tmux pane to its Claude Code session info via PID→session file mapping.
   * Returns the session ID and JSONL path if found.
   */
  static getClaudeSessionForPane(tmuxTarget: string): { pid: number; sessionId: string; cwd: string; jsonlPath?: string } | undefined {
    const panePid = AgentProcess.getPanePid(tmuxTarget);
    if (!panePid) return undefined;

    const claudePid = AgentProcess.getClaudeChildPid(panePid);
    if (!claudePid) return undefined;

    // Read ~/.claude/sessions/{pid}.json
    try {
      const sessionFile = join(homedir(), '.claude', 'sessions', `${claudePid}.json`);
      const content = readFileSync(sessionFile, 'utf-8');
      const data = JSON.parse(content);
      if (data.sessionId) {
        return {
          pid: claudePid,
          sessionId: data.sessionId,
          cwd: data.cwd || '',
        };
      }
    } catch { /* session file not found */ }

    return undefined;
  }

  static listPanes(): Array<{ id: string; title: string; command: string; cwd: string }> {
    try {
      const raw = tmuxExec(
        'list-panes -a -F "#{session_name}:#{window_index}.#{pane_index}|||#{pane_title}|||#{pane_current_command}|||#{pane_current_path}"'
      );
      return raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [id, title, command, cwd] = line.split('|||');
          return { id, title: title || id, command: command || '', cwd: cwd || '' };
        });
    } catch {
      return [];
    }
  }

  /**
   * Capture the last N lines from a tmux pane.
   */
  static captureLastLines(paneTarget: string, lineCount: number = 20): string {
    try {
      return tmuxExec(`capture-pane -t "${paneTarget}" -p -S -${lineCount}`);
    } catch {
      return '';
    }
  }

  /**
   * Peek at the last few lines of a tmux pane to detect agent status.
   */
  static peekPaneStatus(paneTarget: string): { status: 'working' | 'waiting_input' | 'waiting_permission' | 'asking' | 'idle' | 'unknown'; statusLine: string } {
    try {
      const raw = tmuxExec(`capture-pane -t "${paneTarget}" -p -S -20`);
      const lines = raw.split('\n').map(l => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean);
      const lastLines = lines.slice(-10);
      const tail = lastLines.join('\n');

      // Check for idle ❯ prompt first (Claude Code's "waiting for input" prompt)
      // Must come before permission check — the ❯ prompt with a status bar hint
      // like "⏵⏵ accept edits on" is still idle, not a permission request.
      const lastLine = lastLines[lastLines.length - 1] || '';
      if (tail.match(/^❯\s*$/m)) {
        return { status: 'waiting_input', statusLine: '' };
      }

      // Check for permission prompt (Yes/No/Yes always)
      if (tail.match(/\(Y\)es.*\(N\)o/i) || tail.includes('Allow') || tail.match(/Do you want to/i)) {
        const contextLine = lastLines.find(l => l.includes('Allow') || l.match(/\(Y\)es/i) || l.match(/Do you want/i)) || lastLines[lastLines.length - 1];
        return { status: 'waiting_permission', statusLine: contextLine };
      }

      // Check for question (? prompt from AskUserQuestion)
      if (tail.match(/^\?\s+/m) || tail.match(/Has a question/i)) {
        const questionLine = lastLines.find(l => l.match(/^\?\s+/)) || lastLines[lastLines.length - 1];
        return { status: 'asking', statusLine: questionLine };
      }

      // Check for waiting input (> prompt at end, $ prompt)
      if (lastLine.match(/^>\s*$/) || lastLine.match(/\$\s*$/)) {
        return { status: 'waiting_input', statusLine: '' };
      }

      // Check for spinner / working indicators
      if (tail.includes('⏺') || tail.includes('⠋') || tail.includes('⠙') || tail.includes('⠹') || tail.includes('⠸') || tail.includes('⠼') || tail.includes('⠴') || tail.includes('⠦') || tail.includes('⠧') || tail.includes('⠇') || tail.includes('⠏')) {
        const workLine = lastLines[lastLines.length - 1];
        return { status: 'working', statusLine: workLine };
      }

      // If command is claude/node, likely working
      return { status: 'unknown', statusLine: lastLine };
    } catch {
      return { status: 'unknown', statusLine: '' };
    }
  }

  /**
   * List all panes with their detected status.
   */
  static listPanesWithStatus(): Array<{ id: string; title: string; command: string; status: 'working' | 'waiting_input' | 'waiting_permission' | 'asking' | 'idle' | 'unknown'; statusLine: string }> {
    const panes = AgentProcess.listPanes();
    return panes.map((pane) => {
      const { status, statusLine } = AgentProcess.peekPaneStatus(pane.id);
      return { ...pane, status, statusLine };
    });
  }

  /**
   * Create a new tmux session running Claude Code and return the pane target.
   * The session name is `hudai-agent-<timestamp>` to avoid collisions.
   */
  /**
   * Kill a tmux session by target (e.g. "sessionName:0.0" or project path).
   * Extracts the session name and runs `tmux kill-session -t`.
   */
  static killSession(tmuxTarget: string): void {
    const sessionName = tmuxTarget.split(':')[0];
    tmuxExec(`kill-session -t "${sessionName}"`);
  }

  static spawnAgent(options: SpawnAgentOptions): string {
    // Sanitize custom name: only allow alphanumeric, dash, underscore
    const sessionName = options.sessionName
      ? options.sessionName.replace(/[^a-zA-Z0-9_-]/g, '-')
      : `hudai-agent-${Date.now()}`;
    const claudeBin = findBinary('claude');
    const dir = options.projectPath;

    // Create a new detached tmux session running claude in the specified directory
    // Unset CLAUDECODE env var so Claude doesn't think it's nested inside another session
    const envPrefix = 'unset CLAUDECODE;';
    // If a prompt is provided, pass it as a positional argument (NOT -p which is non-interactive print mode)
    if (options.prompt) {
      const escaped = options.prompt.replace(/'/g, "'\\''");
      execSync(
        `${TMUX} new-session -d -s "${sessionName}" -c "${dir}" "bash -c '${envPrefix} ${claudeBin} \\x27${escaped}\\x27'"`,
        { encoding: 'utf-8' }
      );
    } else {
      execSync(
        `${TMUX} new-session -d -s "${sessionName}" -c "${dir}" "bash -c '${envPrefix} ${claudeBin}'"`,
        { encoding: 'utf-8' }
      );
    }

    // The pane target for the first window of the new session
    const tmuxTarget = `${sessionName}:0.0`;

    return tmuxTarget;
  }

  attach(options: AgentProcessOptions) {
    this.tmuxTarget = options.tmuxTarget;

    // Verify the tmux pane exists
    try {
      tmuxExec(`display-message -t "${this.tmuxTarget}" -p "ok"`);
    } catch {
      throw new Error(`tmux pane "${this.tmuxTarget}" not found.`);
    }

    // Emit initial content as history, then snapshot for diffing
    const initialLines = this.captureLines();
    const initialContent = initialLines.filter(l => l.trim()).join('\n');
    if (initialContent) {
      this.emit('data', initialContent);
    }
    // Also emit as pane-content so the live preview populates immediately
    const initialCaret = this.getCaret(this.lastRawLineCount, initialLines.length);
    this.emit('pane-content', initialLines.join('\n'), initialCaret);
    this.lastCaptureLines = initialLines;

    // Poll every 500ms, only emit new lines appended since last capture
    this.pollTimer = setInterval(() => {
      try {
        const currentLines = this.captureLines();

        const newLines = this.findNewLines(this.lastCaptureLines, currentLines);

        if (newLines.length > 0) {
          this.emit('data', newLines.join('\n'));
        }

        // Only emit pane-content when content actually changed
        const joined = currentLines.join('\n');
        if (joined !== this.lastPaneContentStr) {
          const caret = this.getCaret(this.lastRawLineCount, currentLines.length);
          this.emit('pane-content', joined, caret);
          this.lastPaneContentStr = joined;
        }

        this.lastCaptureLines = currentLines;
      } catch {
        // Pane may have been closed
      }
    }, 300);

    this._running = true;
    return this;
  }

  private getCaret(rawLineCount: number, trimmedLineCount: number): { x: number; lineIndex: number } | null {
    try {
      const raw = tmuxExec(
        `display-message -t "${this.tmuxTarget}" -p "#{cursor_x} #{cursor_y} #{pane_height}"`
      ).trim();
      const [x, cursorY, paneHeight] = raw.split(' ').map(Number);
      // Cursor line in the raw capture (absolute index from top)
      const caretInRaw = rawLineCount - paneHeight + cursorY;
      // If the cursor is on a line that got trimmed (trailing empty), it's past trimmed content
      if (caretInRaw >= trimmedLineCount) {
        // Cursor is below all content — place it at the end
        return { x, lineIndex: trimmedLineCount };
      }
      return { x, lineIndex: caretInRaw };
    } catch {
      return null;
    }
  }

  private lastRawLineCount = 0;

  private captureFailCount = 0;

  private captureLines(): string[] {
    try {
      const raw = tmuxExec(`capture-pane -t "${this.tmuxTarget}" -p -e -S -500`);
      this.captureFailCount = 0;
      // Normalize: strip XML tags, trim trailing whitespace per line, remove empty trailing lines
      const lines = raw.split('\n').map(l => l.replace(/<[^>]*>/g, '').trimEnd());
      // Store raw count before trimming (subtract 1 for trailing newline from tmuxExec)
      this.lastRawLineCount = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
      while (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }
      return lines;
    } catch {
      this.captureFailCount++;
      if (this.captureFailCount >= 3) {
        // Pane is gone — emit event so server can auto-detach
        this.emit('pane-died');
      }
      return [];
    }
  }

  /**
   * Find lines that are new in `current` compared to `previous`.
   * Strategy: the previous content is a suffix of the scrollback. New content
   * is appended at the end. Find where previous ends in current and return the rest.
   */
  private findNewLines(previous: string[], current: string[]): string[] {
    if (previous.length === 0) return current; // First capture: emit everything
    if (current.length === 0) return [];

    // Find the last non-empty line of previous
    let anchor = '';
    for (let i = previous.length - 1; i >= 0; i--) {
      if (previous[i].trim()) {
        anchor = previous[i];
        break;
      }
    }
    if (!anchor) return [];

    // Find this anchor in current, searching from the end
    let anchorIdx = -1;
    for (let i = current.length - 1; i >= 0; i--) {
      if (current[i] === anchor) {
        anchorIdx = i;
        break;
      }
    }

    if (anchorIdx === -1) {
      // Anchor not found — screen was cleared or scrolled completely past.
      // Return all non-empty current lines as new content.
      return current.filter(l => l.trim());
    }

    // Everything after the anchor is new
    const newLines = current.slice(anchorIdx + 1).filter(l => l.trim());
    return newLines;
  }

  write(text: string) {
    if (!this.tmuxTarget) {
      throw new Error('Not attached to any tmux pane');
    }
    const escaped = text.replace(/'/g, "'\\''");
    tmuxExec(`send-keys -t "${this.tmuxTarget}" -l '${escaped}'`);
  }

  sendEnter() {
    if (this.tmuxTarget) {
      tmuxExec(`send-keys -t "${this.tmuxTarget}" Enter`);
    }
  }

  sendInterrupt() {
    if (this.tmuxTarget) {
      // Claude Code uses Escape to interrupt, not Ctrl+C
      tmuxExec(`send-keys -t "${this.tmuxTarget}" Escape`);
    }
  }

  private static ALLOWED_KEYS = new Set([
    'Up', 'Down', 'Left', 'Right',
    'Enter', 'Tab', 'BTab', 'BSpace', 'Escape', 'Space',
    'Home', 'End', 'PageUp', 'PageDown', 'DC',
    'C-c', 'C-d', 'C-a', 'C-e', 'C-u', 'C-k', 'C-l', 'C-r', 'C-w', 'C-z',
  ]);

  sendKeys(keys: string) {
    if (!this.tmuxTarget) {
      throw new Error('Not attached to any tmux pane');
    }
    if (!AgentProcess.ALLOWED_KEYS.has(keys)) {
      console.warn(`[send_keys] Rejected unknown key: "${keys}"`);
      return;
    }
    tmuxExec(`send-keys -t "${this.tmuxTarget}" ${keys}`);
  }

  detach() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.tmuxTarget = '';
    this.lastCaptureLines = [];
    this._running = false;
  }

  kill() {
    this.detach();
  }
}
