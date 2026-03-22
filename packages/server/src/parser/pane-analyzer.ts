import type { AgentActivity } from '@hudai/shared';

export interface PaneAnalysis {
  activity: AgentActivity;
  detail?: string;
  options?: string[];
}

/** Strip ANSI escape sequences from a string */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Analyzes the current pane content (full terminal screen) to determine
 * what the agent is doing right now.
 *
 * Only detects idle state (❯ prompt). Permission and question detection
 * are handled by the JSONL transcript which has structured, reliable data
 * (tool_use with permission status, AskUserQuestion tool_use).
 */
export function analyzePaneContent(content: string): PaneAnalysis {
  // Strip ANSI escape codes before analysis (capture-pane -e includes them)
  const lines = stripAnsi(content).split('\n');

  // Get last ~15 non-empty lines for quick pattern detection
  const tail: string[] = [];
  for (let i = lines.length - 1; i >= 0 && tail.length < 15; i--) {
    const trimmed = lines[i].trim();
    if (trimmed) tail.unshift(trimmed);
  }

  if (tail.length === 0) return { activity: 'working' };

  const lastLine = tail[tail.length - 1];

  // Check for idle prompt: line is just "❯" or "❯ " (cursor waiting)
  if (/^❯\s*$/.test(lastLine)) {
    return { activity: 'waiting_input', detail: 'Agent is idle — waiting for instructions' };
  }

  return { activity: 'working' };
}
