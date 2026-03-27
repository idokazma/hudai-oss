import { describe, it, expect } from 'vitest';
import type { AVPEvent } from '../avp-events.js';

/**
 * Verify that the AVPEvent union contains all expected event type discriminants.
 * This test acts as a guard against accidental removal of event types.
 */

const ALL_EXPECTED_TYPES: AVPEvent['type'][] = [
  'file.read',
  'search.grep',
  'search.glob',
  'file.edit',
  'file.create',
  'file.delete',
  'shell.run',
  'shell.output',
  'think.start',
  'think.end',
  'plan.update',
  'test.run',
  'test.result',
  'task.start',
  'task.complete',
  'agent.error',
  'permission.prompt',
  'question.ask',
  'question.answered',
  'subagent.start',
  'subagent.end',
  'tool.complete',
  'memory.change',
  'context.compaction',
  'loop.warning',
  'detail.collapsed',
  'raw.output',
];

describe('AVPEvent union', () => {
  it('contains all expected event type discriminants', () => {
    // This array is typed as AVPEvent['type'][] — if any string is not a valid
    // discriminant, TypeScript will produce a compile error.
    expect(ALL_EXPECTED_TYPES).toHaveLength(27);
  });

  it('has no duplicate type discriminants', () => {
    const unique = new Set(ALL_EXPECTED_TYPES);
    expect(unique.size).toBe(ALL_EXPECTED_TYPES.length);
  });
});
