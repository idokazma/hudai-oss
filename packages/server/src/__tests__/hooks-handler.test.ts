import { describe, it, expect } from 'vitest';
import { HooksHandler } from '../hooks/hooks-handler.js';

describe('HooksHandler', () => {
  it('maps permission_prompt to waiting_permission', () => {
    const handler = new HooksHandler();
    const result = handler.handleNotification({
      matcher: 'permission_prompt',
      tool: 'Bash',
      command: 'npm install express',
    });
    expect(result).toEqual({
      activity: 'waiting_permission',
      detail: 'Bash: npm install express',
    });
  });

  it('maps idle_prompt to waiting_input', () => {
    const handler = new HooksHandler();
    const result = handler.handleNotification({ matcher: 'idle_prompt' });
    expect(result).toEqual({
      activity: 'waiting_input',
      detail: 'Agent is idle — waiting for instructions',
    });
  });

  it('maps elicitation_dialog to waiting_answer', () => {
    const handler = new HooksHandler();
    const result = handler.handleNotification({
      matcher: 'elicitation_dialog',
      question: 'Which approach?',
      options: ['A', 'B', 'C'],
    });
    expect(result).toEqual({
      activity: 'waiting_answer',
      detail: 'Which approach?',
      options: ['A', 'B', 'C'],
    });
  });

  it('returns null for unknown matchers', () => {
    const handler = new HooksHandler();
    const result = handler.handleNotification({ matcher: 'auth_success' });
    expect(result).toBeNull();
  });

  it('emits activity event on valid notification', () => {
    const handler = new HooksHandler();
    const events: any[] = [];
    handler.on('activity', (update) => events.push(update));

    handler.handleNotification({ matcher: 'idle_prompt' });
    expect(events).toHaveLength(1);
    expect(events[0].activity).toBe('waiting_input');
  });

  it('does not emit for unknown matchers', () => {
    const handler = new HooksHandler();
    const events: any[] = [];
    handler.on('activity', (update) => events.push(update));

    handler.handleNotification({ matcher: 'auth_success' });
    expect(events).toHaveLength(0);
  });

  it('handles permission_prompt with only tool name', () => {
    const handler = new HooksHandler();
    const result = handler.handleNotification({
      matcher: 'permission_prompt',
      tool: 'Write',
    });
    expect(result!.detail).toBe('Approval needed: Write');
  });

  it('handles permission_prompt with no tool info', () => {
    const handler = new HooksHandler();
    const result = handler.handleNotification({
      matcher: 'permission_prompt',
    });
    expect(result!.detail).toBe('Approval needed');
  });

  it('handles permission_prompt with message fallback', () => {
    const handler = new HooksHandler();
    const result = handler.handleNotification({
      matcher: 'permission_prompt',
      message: 'Custom permission message',
    });
    expect(result!.detail).toBe('Custom permission message');
  });
});
