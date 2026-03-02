import { execSync } from 'child_process';
import { EventEmitter } from 'events';

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
  private _running = false;

  get running() {
    return this._running;
  }

  static getPaneCwd(tmuxTarget: string): string {
    return tmuxExec(`display-message -t "${tmuxTarget}" -p "#{pane_current_path}"`).trim();
  }

  static listPanes(): Array<{ id: string; title: string; command: string }> {
    try {
      const raw = tmuxExec(
        'list-panes -a -F "#{session_name}:#{window_index}.#{pane_index}|||#{pane_title}|||#{pane_current_command}"'
      );
      return raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [id, title, command] = line.split('|||');
          return { id, title: title || id, command: command || '' };
        });
    } catch {
      return [];
    }
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

        // Always emit the current visible pane content for the live preview
        const caret = this.getCaret(this.lastRawLineCount, currentLines.length);
        this.emit('pane-content', currentLines.join('\n'), caret);

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

  private captureLines(): string[] {
    try {
      const raw = tmuxExec(`capture-pane -t "${this.tmuxTarget}" -p -e -S -500`);
      // Normalize: trim trailing whitespace per line, remove empty trailing lines
      const lines = raw.split('\n').map(l => l.trimEnd());
      // Store raw count before trimming (subtract 1 for trailing newline from tmuxExec)
      this.lastRawLineCount = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
      while (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }
      return lines;
    } catch {
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
