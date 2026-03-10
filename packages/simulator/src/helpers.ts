import type { JsonlEntry, ContentBlock, HookNotification } from './types.js';
import { randomUUID } from 'crypto';

let counter = 0;

export function resetCounter() {
  counter = 0;
}

function nextId(): string {
  return randomUUID();
}

function ts(): string {
  return new Date().toISOString();
}

// ── User prompt ──

export function userPrompt(text: string): JsonlEntry {
  return {
    type: 'user',
    uuid: nextId(),
    timestamp: ts(),
    message: {
      role: 'user',
      content: text,
    },
  };
}

// ── Assistant message with tool uses ──

export function assistantMessage(
  content: ContentBlock[],
  opts?: { model?: string; inputTokens?: number; outputTokens?: number },
): JsonlEntry {
  return {
    type: 'assistant',
    uuid: nextId(),
    timestamp: ts(),
    message: {
      role: 'assistant',
      content,
      model: opts?.model ?? 'claude-sonnet-4-6-20250514',
      usage: {
        input_tokens: opts?.inputTokens ?? 5000,
        output_tokens: opts?.outputTokens ?? 1200,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 3000,
      },
    },
  };
}

// ── Tool use blocks ──

export function thinking(text: string): ContentBlock {
  return { type: 'thinking', thinking: text };
}

export function textBlock(text: string): ContentBlock {
  return { type: 'text', text };
}

export function readFile(path: string, limit?: number): ContentBlock {
  const id = nextId();
  return {
    type: 'tool_use',
    id,
    name: 'Read',
    input: { file_path: path, ...(limit ? { limit } : {}) },
  };
}

export function editFile(
  path: string,
  oldString: string,
  newString: string,
): ContentBlock {
  return {
    type: 'tool_use',
    id: nextId(),
    name: 'Edit',
    input: { file_path: path, old_string: oldString, new_string: newString },
  };
}

export function writeFile(path: string, content: string): ContentBlock {
  return {
    type: 'tool_use',
    id: nextId(),
    name: 'Write',
    input: { file_path: path, content },
  };
}

export function bash(command: string): ContentBlock {
  return {
    type: 'tool_use',
    id: nextId(),
    name: 'Bash',
    input: { command },
  };
}

export function grep(pattern: string): ContentBlock {
  return {
    type: 'tool_use',
    id: nextId(),
    name: 'Grep',
    input: { pattern },
  };
}

export function glob(pattern: string): ContentBlock {
  return {
    type: 'tool_use',
    id: nextId(),
    name: 'Glob',
    input: { pattern },
  };
}

export function todoWrite(
  tasks: { content: string; status: 'completed' | 'in_progress' | 'pending' }[],
): ContentBlock {
  return {
    type: 'tool_use',
    id: nextId(),
    name: 'TodoWrite',
    input: { tasks },
  };
}

export function subagent(
  prompt: string,
  subagentType = 'general-purpose',
  background = false,
): ContentBlock {
  return {
    type: 'tool_use',
    id: nextId(),
    name: 'Task',
    input: { prompt, subagent_type: subagentType, run_in_background: background },
  };
}

// ── Tool result (progress entry) ──

export function toolResult(
  toolUseId: string,
  resultText: string,
  model?: string,
): JsonlEntry {
  return {
    type: 'progress',
    uuid: nextId(),
    timestamp: ts(),
    data: {
      message: {
        type: 'user',
        timestamp: ts(),
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: toolUseId, content: resultText },
          ],
        },
      },
    },
  };
}

// ── Compaction ──

export function compaction(preTokens: number): JsonlEntry {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    uuid: nextId(),
    timestamp: ts(),
    compactMetadata: {
      trigger: 'auto',
      preTokens,
    },
  };
}

/** Extract the tool_use ID from a ContentBlock (for building tool_result references) */
export function getToolId(block: ContentBlock): string {
  if (block.type === 'tool_use') return block.id;
  throw new Error('Not a tool_use block');
}

// ── Hook notifications ──

export function hookPermission(tool: string, command: string): HookNotification {
  return { matcher: 'permission_prompt', tool, command };
}

export function hookIdle(): HookNotification {
  return { matcher: 'idle_prompt', message: 'Agent is idle — waiting for instructions' };
}

export function hookQuestion(question: string, options: string[]): HookNotification {
  return { matcher: 'elicitation_dialog', question, options };
}
