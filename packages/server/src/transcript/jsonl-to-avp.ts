import type { AVPEvent, PermissionRule } from '@hudai/shared';
import { matchPermission } from '../config/permission-matcher.js';
import { parseTestOutput } from '../parser/test-output-parser.js';

/**
 * A single line from Claude Code's JSONL transcript file.
 * Each line has a `type` field indicating the message kind.
 */
export interface JsonlEntry {
  type: 'assistant' | 'user' | 'progress' | 'system' | 'file-history-snapshot' | 'queue-operation' | 'pr-link';
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  sessionId?: string;
  subtype?: string;
  message?: {
    role?: string;
    content?: JsonlContentBlock[] | string;
    model?: string;
    id?: string;
    stop_reason?: string | null;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  compactMetadata?: {
    trigger?: string;
    preTokens?: number;
  };
  data?: {
    message?: {
      type?: string;
      timestamp?: string;
      message?: {
        role?: string;
        content?: JsonlContentBlock[] | string;
        model?: string;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
      };
    };
  };
}

export type JsonlContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { type: 'tool_result'; tool_use_id: string; content?: string | JsonlContentBlock[] };

/**
 * Translate a JSONL entry into zero or more AVP events.
 * Only processes `assistant` type entries with tool_use or thinking blocks.
 * Progress entries with tool_result are also processed for completion events.
 */
export interface TranslateOptions {
  permissionRules?: PermissionRule[];
  agentId?: string;
  agentDepth?: number;
}

export function translateJsonlEntry(
  entry: JsonlEntry,
  sessionId: string,
  seenToolIds: Map<string, { name: string; ts: number; input?: Record<string, any> }>,
  options?: TranslateOptions,
): AVPEvent[] {
  const events: AVPEvent[] = [];
  const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

  if (entry.type === 'assistant') {
    const content = entry.message?.content;
    if (!Array.isArray(content)) return events;

    for (const block of content) {
      if (block.type === 'tool_use') {
        // Dedup by tool_use id
        if (seenToolIds.has(block.id)) continue;
        seenToolIds.set(block.id, { name: block.name, ts, input: block.input });

        const event = toolUseToEvent(block, sessionId, ts);
        if (event) {
          // Stamp agent context
          if (options?.agentId) {
            event.agentId = options.agentId;
            event.agentDepth = options.agentDepth ?? 0;
          }
          // Stamp permission status
          if (options?.permissionRules && options.permissionRules.length > 0) {
            event.permission = matchPermission(block.name, block.input, options.permissionRules);
          }
          events.push(event);
        }
      } else if (block.type === 'thinking') {
        // Emit think events for thinking blocks
        events.push(makeEvent(sessionId, ts, {
          category: 'reasoning',
          type: 'think.start',
          source: 'transcript',
          data: {
            summary: block.thinking.slice(0, 300),
            fullLength: block.thinking.length,
          },
        }));
      } else if (block.type === 'text' && block.text.trim()) {
        events.push(makeEvent(sessionId, ts, {
          category: 'control',
          type: 'raw.output',
          source: 'transcript',
          data: { text: block.text.trim().slice(0, 500) },
        }));
      }
    }
  } else if (entry.type === 'progress') {
    // Progress entries contain nested messages — extract tool_use and tool_result
    const nested = entry.data?.message;
    if (!nested) return events;

    const nestedContent = nested.message?.content;
    if (!Array.isArray(nestedContent)) return events;
    const nestedTs = nested.timestamp ? new Date(nested.timestamp).getTime() : ts;

    if (nested.type === 'assistant') {
      for (const block of nestedContent) {
        if (block.type === 'tool_use') {
          if (seenToolIds.has(block.id)) continue;
          seenToolIds.set(block.id, { name: block.name, ts: nestedTs });
          const event = toolUseToEvent(block, sessionId, nestedTs);
          if (event) {
            if (options?.agentId) {
              event.agentId = options.agentId;
              event.agentDepth = options.agentDepth ?? 0;
            }
            if (options?.permissionRules && options.permissionRules.length > 0) {
              event.permission = matchPermission(block.name, block.input, options.permissionRules);
            }
            events.push(event);
          }
        }
      }
    } else if (nested.type === 'user') {
      for (const block of nestedContent) {
        if (block.type === 'tool_result') {
          const resultEvents = toolResultToEvents(block, sessionId, nestedTs, seenToolIds);
          events.push(...resultEvents);
        }
      }
    }
  } else if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
    // Context compaction event
    const preTokens = entry.compactMetadata?.preTokens ?? 0;
    const trigger = entry.compactMetadata?.trigger ?? 'auto';
    events.push(makeEvent(sessionId, ts, {
      category: 'control',
      type: 'context.compaction',
      source: 'transcript',
      data: { preTokens, trigger },
    }));
  } else if (entry.type === 'user') {
    // Top-level user messages — could be user prompts
    const content = entry.message?.content;
    if (typeof content === 'string' && content.trim()) {
      events.push(makeEvent(sessionId, ts, {
        category: 'control',
        type: 'task.start',
        source: 'transcript',
        data: { prompt: content.trim().slice(0, 500) },
      }));
    }
  }

  return events;
}

/**
 * Extract usage data from a JSONL entry (assistant or progress).
 * Returns null if no usage data present.
 */
export function extractUsage(entry: JsonlEntry): {
  usage: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number };
  model: string;
  timestamp: number;
} | null {
  const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

  if (entry.type === 'assistant' && entry.message?.usage) {
    const u = entry.message.usage;
    return {
      usage: {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
      },
      model: entry.message.model ?? 'sonnet',
      timestamp: ts,
    };
  }

  if (entry.type === 'progress') {
    const nested = entry.data?.message?.message;
    if (nested?.usage) {
      const u = nested.usage;
      return {
        usage: {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
        },
        model: nested.model ?? 'sonnet',
        timestamp: ts,
      };
    }
  }

  return null;
}

function toolUseToEvent(
  block: Extract<JsonlContentBlock, { type: 'tool_use' }>,
  sessionId: string,
  ts: number
): AVPEvent | null {
  const input = block.input;

  switch (block.name) {
    case 'Read':
      return makeEvent(sessionId, ts, {
        category: 'navigation',
        type: 'file.read',
        source: 'transcript',
        data: {
          path: input.file_path || '',
          lineCount: input.limit,
        },
      });

    case 'Edit':
      return makeEvent(sessionId, ts, {
        category: 'mutation',
        type: 'file.edit',
        source: 'transcript',
        data: {
          path: input.file_path || '',
          additions: countLines(input.new_string),
          deletions: countLines(input.old_string),
          summary: input.new_string?.slice(0, 100),
        },
      });

    case 'Write':
      return makeEvent(sessionId, ts, {
        category: 'mutation',
        type: 'file.create',
        source: 'transcript',
        data: {
          path: input.file_path || '',
          lineCount: countLines(input.content),
        },
      });

    case 'Bash':
      return makeEvent(sessionId, ts, {
        category: 'execution',
        type: 'shell.run',
        source: 'transcript',
        data: {
          command: input.command || '',
          cwd: input.cwd,
        },
      });

    case 'Grep':
      return makeEvent(sessionId, ts, {
        category: 'navigation',
        type: 'search.grep',
        source: 'transcript',
        data: {
          pattern: input.pattern || '',
          matchCount: 0,
          files: [],
        },
      });

    case 'Glob':
      return makeEvent(sessionId, ts, {
        category: 'navigation',
        type: 'search.glob',
        source: 'transcript',
        data: {
          pattern: input.pattern || '',
          matchCount: 0,
          files: [],
        },
      });

    case 'Task':
      return makeEvent(sessionId, ts, {
        category: 'control',
        type: 'subagent.start',
        source: 'transcript',
        data: {
          agentId: block.id,
          agentType: input.subagent_type || input.type || 'Task',
          prompt: input.prompt?.slice(0, 500) || '',
          parentAgentId: null,
          background: input.run_in_background ?? false,
        },
      });

    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList': {
      const tasks = input.tasks ?? [];
      const steps = tasks.map((t: any) => t.content || t.subject || String(t));
      // Derive currentStep from task statuses instead of hardcoding 0
      const completedCount = tasks.filter(
        (t: any) => t.status === 'completed' || t.status === 'done'
      ).length;
      // First in-progress task, or the one right after all completed tasks
      const inProgressIdx = tasks.findIndex(
        (t: any) => t.status === 'in_progress' || t.status === 'active'
      );
      const currentStep = inProgressIdx >= 0
        ? inProgressIdx
        : Math.min(completedCount, Math.max(0, steps.length - 1));
      return makeEvent(sessionId, ts, {
        category: 'reasoning',
        type: 'plan.update',
        source: 'transcript',
        data: { steps, currentStep },
      });
    }

    case 'WebSearch':
      return makeEvent(sessionId, ts, {
        category: 'navigation',
        type: 'search.grep',
        source: 'transcript',
        data: {
          pattern: input.query || '',
          matchCount: 0,
          files: [],
        },
      });

    case 'WebFetch':
      return makeEvent(sessionId, ts, {
        category: 'navigation',
        type: 'search.grep',
        source: 'transcript',
        data: {
          pattern: input.url || '',
          matchCount: 0,
          files: [],
        },
      });

    case 'NotebookEdit':
      return makeEvent(sessionId, ts, {
        category: 'mutation',
        type: 'file.edit',
        source: 'transcript',
        data: {
          path: input.notebook_path || '',
          additions: countLines(input.new_source),
          deletions: 0,
        },
      });

    case 'AskUserQuestion': {
      // Structured question from Claude — extract question text and options
      const q = input.questions?.[0];
      const questionText = q?.question || 'Agent is asking a question';
      const options: string[] = (q?.options || []).map((o: any) => o.label || String(o));
      return makeEvent(sessionId, ts, {
        category: 'control',
        type: 'question.ask',
        source: 'transcript',
        data: {
          question: questionText,
          options,
          toolUseId: block.id,
        },
      });
    }

    default:
      // Unknown tool — emit as shell.run
      return makeEvent(sessionId, ts, {
        category: 'execution',
        type: 'shell.run',
        source: 'transcript',
        data: {
          command: `${block.name}(${JSON.stringify(input).slice(0, 200)})`,
        },
      });
  }
}

function toolResultToEvents(
  block: Extract<JsonlContentBlock, { type: 'tool_result' }>,
  sessionId: string,
  ts: number,
  seenToolIds?: Map<string, { name: string; ts: number; input?: Record<string, any> }>,
): AVPEvent[] {
  const results: AVPEvent[] = [];
  if (!seenToolIds) return results;

  const original = seenToolIds.get(block.tool_use_id);
  if (!original) return results;

  // Check if this is a Task completion (sub-agent end)
  if (original.name === 'Task') {
    const durationMs = ts - original.ts;
    let result: string | undefined;
    if (typeof block.content === 'string') {
      result = block.content.slice(0, 300);
    } else if (Array.isArray(block.content)) {
      const textBlock = block.content.find((b) => b.type === 'text');
      if (textBlock && 'text' in textBlock) {
        result = (textBlock as any).text?.slice(0, 300);
      }
    }
    results.push(makeEvent(sessionId, ts, {
      category: 'control',
      type: 'subagent.end',
      source: 'transcript',
      data: {
        agentId: block.tool_use_id,
        agentType: 'Task',
        result,
        durationMs: Math.max(0, durationMs),
        eventCount: 0,
      },
    }));
    return results;
  }

  // AskUserQuestion answered — emit question.answered
  if (original.name === 'AskUserQuestion') {
    results.push(makeEvent(sessionId, ts, {
      category: 'control',
      type: 'question.answered',
      source: 'transcript',
      data: {
        toolUseId: block.tool_use_id,
        answer: extractResultText(block)?.slice(0, 300),
      },
    }));
    return results;
  }

  // Emit generic tool.complete for all non-Task tool results
  const durationMs = ts - original.ts;
  const resultSummary = extractResultText(block)?.slice(0, 200);
  results.push(makeEvent(sessionId, ts, {
    category: 'execution',
    type: 'tool.complete',
    source: 'transcript',
    data: {
      toolName: original.name,
      toolUseId: block.tool_use_id,
      durationMs: Math.max(0, durationMs),
      resultSummary,
    },
  }));

  // Check if this is a Bash result that contains test output
  if (original.name === 'Bash') {
    const resultText = extractResultText(block);
    const originalCommand = original.input?.command ?? '';
    if (resultText) {
      const testResult = parseTestOutput(originalCommand, resultText);
      if (testResult) {
        results.push(makeEvent(sessionId, ts, {
          category: 'testing',
          type: 'test.result',
          source: 'transcript',
          data: {
            passed: testResult.passed,
            failed: testResult.failed,
            total: testResult.total,
            failures: testResult.failures,
            durationMs: testResult.durationMs,
          },
        }));
      }
    }
  }

  return results;
}

function extractResultText(block: Extract<JsonlContentBlock, { type: 'tool_result' }>): string | null {
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) {
    const textBlock = block.content.find((b) => b.type === 'text');
    if (textBlock && 'text' in textBlock) return (textBlock as any).text;
  }
  return null;
}

function makeEvent(
  sessionId: string,
  timestamp: number,
  partial: Omit<AVPEvent, 'id' | 'sessionId' | 'timestamp'>
): AVPEvent {
  return {
    ...partial,
    id: crypto.randomUUID(),
    sessionId,
    timestamp,
  } as AVPEvent;
}

function countLines(text?: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}
