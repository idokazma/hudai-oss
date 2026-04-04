import type { AgentActivity } from '@hudai/shared';
import { stripAnsi } from './ansi-utils.js';

export interface PaneAnalysis {
  activity: AgentActivity;
  detail?: string;
  options?: string[];
}

/**
 * Analyzes the current pane content (full terminal screen) to determine
 * what the agent is doing right now.
 *
 * Primary detection for permissions and questions comes from JSONL transcript.
 * This analyzer serves as a **safety net fallback** — if the terminal shows a
 * permission dialog or question that JSONL/hooks missed (e.g. auto-approve hook
 * let a destructive command through), this catches it from the terminal output.
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
  const tailText = tail.join('\n');

  // Check for idle prompt: line is just "❯" or "❯ " (cursor waiting)
  if (/^❯\s*$/.test(lastLine)) {
    return { activity: 'waiting_input', detail: 'Agent is idle — waiting for instructions' };
  }

  // Safety net: detect permission dialog from terminal content
  // Matches Claude Code's "(Y)es / (N)o / (Y)es, always" prompt
  if (/\(Y\)es.*\(N\)o/i.test(tailText) || /Do you want to/i.test(tailText)) {
    const contextLine = tail.find(l => /\(Y\)es/i.test(l) || /Allow/i.test(l) || /Do you want/i.test(l)) || lastLine;
    return { activity: 'waiting_permission', detail: contextLine };
  }

  // Safety net: detect AskUserQuestion dialog (? prompt)
  if (/^\?\s+/m.test(tailText)) {
    const questionLine = tail.find(l => /^\?\s+/.test(l)) || lastLine;
    return { activity: 'waiting_answer', detail: questionLine };
  }

  return { activity: 'working' };
}
