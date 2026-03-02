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
 * Checks the last few non-empty lines for patterns:
 * - Idle ❯ prompt → waiting_input (done, needs next instruction)
 * - "Do you want to proceed?" + numbered options → waiting_permission
 * - Numbered options (1. 2. 3.) without permission → waiting_answer (question)
 * - Anything else → working
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

  // Check for permission prompt: "Do you want to proceed?" with numbered options
  if (tailText.includes('Do you want to proceed')) {
    // For permission prompts, scan a wider window (up to 50 lines)
    // because long commands can push the tool header far above
    const wideTail: string[] = [];
    for (let i = lines.length - 1; i >= 0 && wideTail.length < 50; i--) {
      const trimmed = lines[i].trim();
      if (trimmed) wideTail.unshift(trimmed);
    }

    // Extract tool + command from the formatted permission block.
    // Claude Code renders permission prompts as:
    //   ──────────────
    //    Bash command
    //      git status
    //      Show description
    //    This command requires approval
    //    Do you want to proceed?
    //
    // Strategy: find the separator line (───) or "command" header near "Do you want",
    // then extract the tool name and indented command lines from that block.
    let tool = '';
    let commandLines: string[] = [];
    const toolPattern = /^[⏺✻✶✳✽✢●]?\s*(Bash|Read|Edit|Write|Grep|Glob|WebFetch|WebSearch|NotebookEdit)\b/i;

    // First, try to find the formatted permission block (separator + "Bash command" etc.)
    const permBlockPattern = /^\s*(Bash|Read|Edit|Write|Grep|Glob|WebFetch|WebSearch|NotebookEdit)\s+(command|file|files)\s*$/i;
    let foundPermBlock = false;

    for (let i = 0; i < wideTail.length; i++) {
      const line = wideTail[i];
      const permMatch = line.match(permBlockPattern);
      if (permMatch) {
        tool = permMatch[1];
        foundPermBlock = true;
        // Collect indented command lines after the block header
        for (let j = i + 1; j < wideTail.length && j <= i + 15; j++) {
          const nextLine = wideTail[j];
          if (/Do you want/.test(nextLine)) break;
          if (/^❯\s*\d+\./.test(nextLine)) break;
          if (/requires approval/i.test(nextLine)) break;
          if (/^This (command|will)/.test(nextLine)) break;
          if (/^Command contains/.test(nextLine)) break;
          if (/^─{3,}/.test(nextLine)) break;
          const cleaned = nextLine.trim();
          if (cleaned) {
            commandLines.push(cleaned);
          }
        }
        break;
      }
    }

    // Fallback: find the LAST ⏺ Tool(...) header before "Do you want"
    if (!foundPermBlock) {
      let lastToolIdx = -1;
      let lastToolName = '';
      for (let i = 0; i < wideTail.length; i++) {
        if (/Do you want/.test(wideTail[i])) break;
        const m = wideTail[i].match(toolPattern);
        if (m) {
          lastToolIdx = i;
          lastToolName = m[1];
        }
      }
      if (lastToolIdx >= 0) {
        tool = lastToolName;
        // Extract args from the ⏺ Bash(args) header itself
        const headerLine = wideTail[lastToolIdx];
        const argsMatch = headerLine.match(/\(([^)]+)\)/);
        if (argsMatch) {
          commandLines.push(argsMatch[1]);
        }
      }
    }

    // Build the detail string — show the full command (truncated if very long)
    let detail: string;
    if (commandLines.length > 0) {
      const fullCommand = commandLines.join('\n');
      // Truncate to ~300 chars for display
      const truncated = fullCommand.length > 300
        ? fullCommand.slice(0, 297) + '...'
        : fullCommand;
      detail = `${tool || 'Tool'}: ${truncated}`;
    } else {
      detail = tool ? `Approval needed: ${tool}` : 'Approval needed';
    }

    return { activity: 'waiting_permission', detail };
  }

  // Check for question with numbered options (AskUserQuestion pattern)
  // Look for a question mark followed by numbered options like "1. Option A", "2. Option B"
  // Options may be prefixed with ❯ for the selected one
  //
  // IMPORTANT: Only collect numbered lines AFTER the last question line.
  // This avoids picking up numbered plan steps before the actual question options.
  // e.g. "Plan: 1. Step A  2. Step B  3. Step C  Which step? 1. Yes  2. No  3. Maybe"
  //       should only return [Yes, No, Maybe], not all 6 items.

  // Find the last question line index in tail
  let lastQuestionIdx = -1;
  for (let i = tail.length - 1; i >= 0; i--) {
    if (tail[i].includes('?') && !tail[i].match(/^\d+\.\s/) && !tail[i].includes('Do you want to proceed')) {
      lastQuestionIdx = i;
      break;
    }
  }

  const hasQuestion = lastQuestionIdx >= 0;

  // Only collect numbered option lines AFTER the last question
  const numberedOptionLines: string[] = [];
  if (hasQuestion) {
    for (let i = lastQuestionIdx + 1; i < tail.length; i++) {
      if (/^(?:❯\s*)?\d+\.\s+\S/.test(tail[i])) {
        numberedOptionLines.push(tail[i]);
      }
    }
  }
  const hasNumberedOptions = numberedOptionLines.length > 0;

  if (hasNumberedOptions && hasQuestion) {
    // Not a permission prompt (checked above) — it's AskUserQuestion
    // Extract the question text from the last question line
    const question = tail[lastQuestionIdx].replace(/^[⏺✻✶✳✽✢●]\s*/, '').trim();

    // Extract option texts from numbered lines (strip ❯ prefix if present)
    const options: string[] = [];
    for (const line of numberedOptionLines) {
      const optMatch = line.match(/^(?:❯\s*)?\d+\.\s+(.+)/);
      if (optMatch) {
        options.push(optMatch[1].trim());
      }
    }

    return {
      activity: 'waiting_answer',
      detail: question || 'Agent is asking a question',
      options: options.length > 0 ? options : undefined,
    };
  }

  return { activity: 'working' };
}
