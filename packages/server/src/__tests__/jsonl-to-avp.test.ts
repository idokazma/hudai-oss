import { describe, it, expect } from 'vitest';
import { translateJsonlEntry, extractUsage } from '../transcript/jsonl-to-avp.js';
import type { JsonlEntry } from '../transcript/jsonl-to-avp.js';

function makeSeenMap() {
  return new Map<string, { name: string; ts: number; input?: Record<string, any> }>();
}

describe('translateJsonlEntry', () => {
  it('converts assistant tool_use Read to file.read event', () => {
    const entry: JsonlEntry = {
      type: 'assistant',
      timestamp: '2025-01-01T00:00:00Z',
      message: {
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/src/foo.ts' } },
        ],
      },
    };
    const events = translateJsonlEntry(entry, 'sess-1', makeSeenMap());
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('file.read');
    expect(events[0].category).toBe('navigation');
    expect((events[0] as any).data.path).toBe('/src/foo.ts');
  });

  it('converts assistant tool_use Bash to shell.run event', () => {
    const entry: JsonlEntry = {
      type: 'assistant',
      timestamp: '2025-01-01T00:00:00Z',
      message: {
        content: [
          { type: 'tool_use', id: 'tu-2', name: 'Bash', input: { command: 'npm test' } },
        ],
      },
    };
    const events = translateJsonlEntry(entry, 'sess-1', makeSeenMap());
    expect(events[0].type).toBe('shell.run');
    expect((events[0] as any).data.command).toBe('npm test');
  });

  it('converts thinking block to think.start event', () => {
    const entry: JsonlEntry = {
      type: 'assistant',
      timestamp: '2025-01-01T00:00:00Z',
      message: {
        content: [
          { type: 'thinking', thinking: 'Let me analyze this problem carefully...' },
        ],
      },
    };
    const events = translateJsonlEntry(entry, 'sess-1', makeSeenMap());
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('think.start');
    expect(events[0].category).toBe('reasoning');
  });

  it('converts text block to raw.output event', () => {
    const entry: JsonlEntry = {
      type: 'assistant',
      timestamp: '2025-01-01T00:00:00Z',
      message: {
        content: [{ type: 'text', text: 'Here is my analysis.' }],
      },
    };
    const events = translateJsonlEntry(entry, 'sess-1', makeSeenMap());
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('raw.output');
  });

  it('deduplicates tool_use by id', () => {
    const entry: JsonlEntry = {
      type: 'assistant',
      timestamp: '2025-01-01T00:00:00Z',
      message: {
        content: [
          { type: 'tool_use', id: 'tu-dup', name: 'Read', input: { file_path: '/a.ts' } },
        ],
      },
    };
    const seen = makeSeenMap();
    translateJsonlEntry(entry, 'sess-1', seen);
    const events2 = translateJsonlEntry(entry, 'sess-1', seen);
    expect(events2).toHaveLength(0);
  });

  it('handles progress entry with tool_result → tool.complete', () => {
    const seen = makeSeenMap();
    seen.set('tu-bash', { name: 'Bash', ts: 1000, input: { command: 'ls' } });

    const entry: JsonlEntry = {
      type: 'progress',
      timestamp: '2025-01-01T00:00:01Z',
      data: {
        message: {
          type: 'user',
          timestamp: '2025-01-01T00:00:01Z',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tu-bash', content: 'file1.ts\nfile2.ts' },
            ],
          },
        },
      },
    };
    const events = translateJsonlEntry(entry, 'sess-1', seen);
    expect(events.some((e) => e.type === 'tool.complete')).toBe(true);
  });

  it('handles system compact_boundary → context.compaction event', () => {
    const entry: JsonlEntry = {
      type: 'system',
      subtype: 'compact_boundary',
      timestamp: '2025-01-01T00:00:00Z',
      compactMetadata: { trigger: 'auto', preTokens: 150000 },
    };
    const events = translateJsonlEntry(entry, 'sess-1', makeSeenMap());
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('context.compaction');
    expect((events[0] as any).data.preTokens).toBe(150000);
  });

  it('returns empty for non-processable entry types', () => {
    const entry: JsonlEntry = {
      type: 'file-history-snapshot',
      timestamp: '2025-01-01T00:00:00Z',
    };
    const events = translateJsonlEntry(entry, 'sess-1', makeSeenMap());
    expect(events).toHaveLength(0);
  });

  it('converts user message to task.start event', () => {
    const entry: JsonlEntry = {
      type: 'user',
      timestamp: '2025-01-01T00:00:00Z',
      message: {
        content: 'Fix the login bug',
      },
    };
    const events = translateJsonlEntry(entry, 'sess-1', makeSeenMap());
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('task.start');
    expect((events[0] as any).data.prompt).toBe('Fix the login bug');
  });

  it('converts Edit tool_use to file.edit event', () => {
    const entry: JsonlEntry = {
      type: 'assistant',
      timestamp: '2025-01-01T00:00:00Z',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu-edit',
            name: 'Edit',
            input: { file_path: '/src/app.ts', old_string: 'foo', new_string: 'bar\nbaz' },
          },
        ],
      },
    };
    const events = translateJsonlEntry(entry, 'sess-1', makeSeenMap());
    expect(events[0].type).toBe('file.edit');
    expect((events[0] as any).data.path).toBe('/src/app.ts');
    expect((events[0] as any).data.additions).toBe(2);
    expect((events[0] as any).data.deletions).toBe(1);
  });

  it('converts Task tool_use to subagent.start event', () => {
    const entry: JsonlEntry = {
      type: 'assistant',
      timestamp: '2025-01-01T00:00:00Z',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu-task',
            name: 'Task',
            input: { subagent_type: 'Explore', prompt: 'Find auth files' },
          },
        ],
      },
    };
    const events = translateJsonlEntry(entry, 'sess-1', makeSeenMap());
    expect(events[0].type).toBe('subagent.start');
    expect((events[0] as any).data.agentType).toBe('Explore');
  });
});

describe('extractUsage', () => {
  it('extracts usage from assistant entry', () => {
    const entry: JsonlEntry = {
      type: 'assistant',
      timestamp: '2025-01-01T00:00:00Z',
      message: {
        model: 'claude-sonnet-4-6-20250514',
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 100,
        },
      },
    };
    const result = extractUsage(entry);
    expect(result).not.toBeNull();
    expect(result!.usage.inputTokens).toBe(1000);
    expect(result!.usage.outputTokens).toBe(500);
    expect(result!.usage.cacheCreationTokens).toBe(200);
    expect(result!.usage.cacheReadTokens).toBe(100);
    expect(result!.model).toBe('claude-sonnet-4-6-20250514');
  });

  it('extracts usage from progress entry', () => {
    const entry: JsonlEntry = {
      type: 'progress',
      timestamp: '2025-01-01T00:00:00Z',
      data: {
        message: {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-6',
            usage: { input_tokens: 2000, output_tokens: 1000 },
          },
        },
      },
    };
    const result = extractUsage(entry);
    expect(result).not.toBeNull();
    expect(result!.usage.inputTokens).toBe(2000);
    expect(result!.model).toBe('claude-opus-4-6');
  });

  it('returns null for entry without usage', () => {
    const entry: JsonlEntry = {
      type: 'system',
      subtype: 'compact_boundary',
      timestamp: '2025-01-01T00:00:00Z',
    };
    expect(extractUsage(entry)).toBeNull();
  });
});
