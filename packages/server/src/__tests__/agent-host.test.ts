import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentHost } from '../agent/agent-host.js';

// We test the handleEntry logic by simulating what processBuffer does
// Since handleEntry is private, we test through the event interface
describe('AgentHost', () => {
  let host: AgentHost;

  beforeEach(() => {
    host = new AgentHost();
  });

  it('starts in non-running state', () => {
    expect(host.running).toBe(false);
    expect(host.claudeSession).toBeNull();
  });

  it('emits events from assistant entries with tool_use blocks', () => {
    const events: any[] = [];
    host.on('event', (e) => events.push(e));

    // Simulate processBuffer by accessing the private method
    const entry = {
      type: 'assistant',
      uuid: 'test-1',
      timestamp: new Date().toISOString(),
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: 'src/index.ts' } },
        ],
        model: 'claude-sonnet-4-6-20250514',
        usage: { input_tokens: 5000, output_tokens: 1000 },
      },
    };

    // Use the internal handleEntry method
    (host as any).sessionId = 'test-session';
    (host as any).handleEntry(entry);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('file.read');
    expect(events[0].source).toBe('stream');
    expect(events[0].sessionId).toBe('test-session');
  });

  it('emits usage data from assistant entries', () => {
    const usages: any[] = [];
    host.on('usage', (u) => usages.push(u));

    (host as any).sessionId = 'test-session';
    (host as any).handleEntry({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        model: 'claude-sonnet-4-6-20250514',
        usage: {
          input_tokens: 5000,
          output_tokens: 1200,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 3000,
        },
      },
    });

    expect(usages).toHaveLength(1);
    expect(usages[0].usage.inputTokens).toBe(5000);
    expect(usages[0].usage.outputTokens).toBe(1200);
    expect(usages[0].model).toBe('claude-sonnet-4-6-20250514');
  });

  it('emits output for text blocks in assistant messages', () => {
    const outputs: string[] = [];
    host.on('output', (text) => outputs.push(text));

    (host as any).sessionId = 'test-session';
    (host as any).handleEntry({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me read the file.' },
          { type: 'tool_use', id: 'tu-2', name: 'Read', input: { file_path: 'foo.ts' } },
        ],
      },
    });

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toBe('Let me read the file.');
  });

  it('emits result event and stores claudeSessionId', () => {
    const results: any[] = [];
    host.on('result', (r) => results.push(r));

    (host as any).handleEntry({
      type: 'result',
      session_id: 'claude-sess-123',
      result: 'All done.',
      subtype: 'success',
      cost_usd: 0.05,
      is_error: false,
      total_turns: 3,
    });

    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe('claude-sess-123');
    expect(results[0].subtype).toBe('success');
    expect(host.claudeSession).toBe('claude-sess-123');
  });

  it('deduplicates tool_use IDs', () => {
    const events: any[] = [];
    host.on('event', (e) => events.push(e));

    const entry = {
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-dup', name: 'Read', input: { file_path: 'a.ts' } },
        ],
      },
    };

    (host as any).sessionId = 'test-session';
    (host as any).handleEntry(entry);
    (host as any).handleEntry(entry); // same ID again

    expect(events).toHaveLength(1); // only one event
  });

  it('handles thinking blocks', () => {
    const events: any[] = [];
    host.on('event', (e) => events.push(e));

    (host as any).sessionId = 'test-session';
    (host as any).handleEntry({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me think about this...' },
        ],
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('think.start');
  });

  it('handles user entries as task.start', () => {
    const events: any[] = [];
    host.on('event', (e) => events.push(e));

    (host as any).sessionId = 'test-session';
    (host as any).handleEntry({
      type: 'user',
      timestamp: new Date().toISOString(),
      message: {
        role: 'user',
        content: 'Fix the login bug',
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('task.start');
  });

  it('handles progress entries with tool_result', () => {
    const events: any[] = [];
    host.on('event', (e) => events.push(e));

    // First register the tool_use
    (host as any).sessionId = 'test-session';
    (host as any).handleEntry({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-bash-1', name: 'Bash', input: { command: 'npm test' } },
        ],
      },
    });

    // Then the tool_result via progress
    (host as any).handleEntry({
      type: 'progress',
      timestamp: new Date().toISOString(),
      data: {
        message: {
          type: 'user',
          timestamp: new Date().toISOString(),
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tu-bash-1', content: 'Tests: 5 passed' },
            ],
          },
        },
      },
    });

    expect(events.length).toBeGreaterThanOrEqual(2);
    const toolComplete = events.find(e => e.type === 'tool.complete');
    expect(toolComplete).toBeDefined();
    expect(toolComplete.data.toolName).toBe('Bash');
  });

  it('destroy clears state', () => {
    (host as any).claudeSessionId = 'sess-123';
    (host as any).seenToolIds.set('x', { name: 'Read', ts: 0 });
    (host as any).buffer = 'partial data';

    host.destroy();

    expect(host.claudeSession).toBeNull();
    expect((host as any).seenToolIds.size).toBe(0);
    expect((host as any).buffer).toBe('');
  });
});
