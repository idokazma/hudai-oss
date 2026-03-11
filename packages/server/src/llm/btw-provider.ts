import { execSync } from 'child_process';
import { BaseLLMProvider } from './base-provider.js';

function findBinary(name: string): string {
  try {
    return execSync(`zsh -lc "which ${name}"`, { encoding: 'utf-8' }).trim();
  } catch {
    return name;
  }
}

const TMUX = findBinary('tmux');
const POLL_INTERVAL_MS = 300;
const MAX_WAIT_MS = 120_000; // 2 min timeout

/**
 * LLM provider that sends prompts to Claude Code's /btw command via tmux.
 * No API key needed — uses the user's existing Claude Code session.
 */
export class BtwProvider extends BaseLLMProvider {
  protected readonly providerName = 'btw';
  private tmuxTarget: string;

  constructor(tmuxTarget: string) {
    super();
    this.tmuxTarget = tmuxTarget;
  }

  setTmuxTarget(target: string): void {
    this.tmuxTarget = target;
  }

  protected async verifyKey(): Promise<boolean> {
    // No key needed — just verify the tmux pane exists
    try {
      execSync(`${TMUX} display-message -t "${this.tmuxTarget}" -p "ok"`, { encoding: 'utf-8' });
      return true;
    } catch {
      return false;
    }
  }

  protected async callLLM(prompt: string): Promise<string> {
    if (!this.tmuxTarget) {
      throw new Error('BtwProvider: no tmux target set');
    }

    // Capture the pane before we send /btw so we know where the old content ends
    const beforeLines = this.capturePane();

    // Send /btw <prompt> via tmux send-keys
    // Escape single quotes in the prompt for shell safety
    const oneLinePrompt = prompt.replace(/\n/g, ' ').replace(/'/g, "'\\''");
    execSync(`${TMUX} send-keys -t "${this.tmuxTarget}" -l '/btw ${oneLinePrompt}'`, { encoding: 'utf-8' });
    execSync(`${TMUX} send-keys -t "${this.tmuxTarget}" Enter`, { encoding: 'utf-8' });

    // Poll capture-pane until we detect the /btw response is complete.
    // Heuristic: after sending /btw, wait for new content to appear that ends
    // with the input prompt indicator (❯ or >) signaling Claude is done.
    const startedAt = Date.now();
    let responseText = '';

    // Wait a beat for /btw to start processing
    await sleep(1000);

    while (Date.now() - startedAt < MAX_WAIT_MS) {
      await sleep(POLL_INTERVAL_MS);

      const currentLines = this.capturePane();
      const newContent = this.extractNewContent(beforeLines, currentLines);

      if (!newContent) continue;

      // /btw output is done when we see the prompt come back (❯ or the cursor
      // is back at an input line). We look for a line that is just the prompt
      // indicator or the pane has settled (same content for 2 consecutive polls).
      if (responseText === newContent && newContent.length > 0) {
        // Content hasn't changed between polls — response is complete
        break;
      }
      responseText = newContent;
    }

    // Clean up the response: strip the /btw command echo and any prompt indicators
    return this.cleanResponse(responseText);
  }

  private capturePane(): string[] {
    try {
      const raw = execSync(
        `${TMUX} capture-pane -t "${this.tmuxTarget}" -p -S -500`,
        { encoding: 'utf-8' },
      );
      const lines = raw.split('\n').map(l => l.trimEnd());
      while (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }
      return lines;
    } catch {
      return [];
    }
  }

  private extractNewContent(beforeLines: string[], currentLines: string[]): string {
    // Find the last non-empty line of "before" in "current", take everything after
    let anchor = '';
    for (let i = beforeLines.length - 1; i >= 0; i--) {
      if (beforeLines[i].trim()) {
        anchor = beforeLines[i];
        break;
      }
    }
    if (!anchor) return currentLines.join('\n');

    let anchorIdx = -1;
    for (let i = currentLines.length - 1; i >= 0; i--) {
      if (currentLines[i] === anchor) {
        anchorIdx = i;
        break;
      }
    }

    if (anchorIdx === -1) return '';
    return currentLines.slice(anchorIdx + 1).filter(l => l.trim()).join('\n');
  }

  private cleanResponse(raw: string): string {
    const lines = raw.split('\n');
    const cleaned: string[] = [];
    for (const line of lines) {
      // Skip the echoed /btw command
      if (line.trimStart().startsWith('/btw ')) continue;
      // Skip prompt indicators
      if (/^\s*[❯>]\s*$/.test(line)) continue;
      // Skip spinner/status lines
      if (/^[·✢✻✶✳✽⚡●⏺]\s*(Fermenting|Baking|Thinking|Planning|Working|Brewing)/i.test(line)) continue;
      cleaned.push(line);
    }
    return cleaned.join('\n').trim();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
