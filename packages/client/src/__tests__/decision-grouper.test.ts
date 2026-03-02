import { describe, it, expect } from 'vitest';
import { groupIntoDecisions } from '../utils/decision-grouper.js';
import type { AVPEvent } from '@hudai/shared';

function makeEvent(type: string, ts: number): AVPEvent {
  return {
    id: `evt-${ts}`,
    sessionId: 'test',
    timestamp: ts,
    category: 'execution',
    type,
    source: 'test',
    data: {},
  } as AVPEvent;
}

describe('groupIntoDecisions', () => {
  it('returns empty for empty events', () => {
    expect(groupIntoDecisions([])).toEqual([]);
  });

  it('groups events without think.start into single decision', () => {
    const events = [makeEvent('file.read', 100), makeEvent('file.edit', 200)];
    const decisions = groupIntoDecisions(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].thinkEvent).toBeUndefined();
    expect(decisions[0].actionEvents).toHaveLength(2);
  });

  it('think.start creates new decision', () => {
    const events = [
      makeEvent('think.start', 100),
      makeEvent('file.read', 200),
      makeEvent('file.edit', 300),
    ];
    const decisions = groupIntoDecisions(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].thinkEvent!.type).toBe('think.start');
    expect(decisions[0].actionEvents).toHaveLength(2);
  });

  it('multiple think.start events create multiple decisions', () => {
    const events = [
      makeEvent('think.start', 100),
      makeEvent('file.read', 200),
      makeEvent('think.start', 300),
      makeEvent('shell.run', 400),
    ];
    const decisions = groupIntoDecisions(events);
    expect(decisions).toHaveLength(2);
    expect(decisions[0].actionEvents).toHaveLength(1);
    expect(decisions[1].actionEvents).toHaveLength(1);
  });

  it('skips raw.output events', () => {
    const events = [
      makeEvent('file.read', 100),
      makeEvent('raw.output', 150),
      makeEvent('file.edit', 200),
    ];
    const decisions = groupIntoDecisions(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].actionEvents).toHaveLength(2);
  });

  it('sets timestamps correctly', () => {
    const events = [
      makeEvent('think.start', 100),
      makeEvent('file.read', 200),
      makeEvent('file.edit', 300),
    ];
    const decisions = groupIntoDecisions(events);
    expect(decisions[0].startTs).toBe(100);
    expect(decisions[0].endTs).toBe(300);
  });

  it('actions before first think.start go into their own decision', () => {
    const events = [
      makeEvent('file.read', 50),
      makeEvent('think.start', 100),
      makeEvent('file.edit', 200),
    ];
    const decisions = groupIntoDecisions(events);
    expect(decisions).toHaveLength(2);
    expect(decisions[0].thinkEvent).toBeUndefined();
    expect(decisions[0].actionEvents).toHaveLength(1);
    expect(decisions[1].thinkEvent!.type).toBe('think.start');
  });
});
