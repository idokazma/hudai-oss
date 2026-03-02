import { describe, it, expect, beforeEach } from 'vitest';
import { useEventStore } from '../stores/event-store.js';
import type { AVPEvent } from '@hudai/shared';

function makeEvent(id: string): AVPEvent {
  return {
    id,
    sessionId: 'test',
    timestamp: Date.now(),
    category: 'execution',
    type: 'shell.run',
    source: 'test',
    data: { command: 'echo hi' },
  } as AVPEvent;
}

describe('useEventStore', () => {
  beforeEach(() => {
    useEventStore.getState().clear();
  });

  it('addEvent appends to array', () => {
    useEventStore.getState().addEvent(makeEvent('e1'));
    expect(useEventStore.getState().events).toHaveLength(1);
    useEventStore.getState().addEvent(makeEvent('e2'));
    expect(useEventStore.getState().events).toHaveLength(2);
  });

  it('ring buffer truncation at 10,000 events', () => {
    const events = Array.from({ length: 10_000 }, (_, i) => makeEvent(`e${i}`));
    useEventStore.getState().addEvents(events);
    expect(useEventStore.getState().events).toHaveLength(10_000);

    // Adding one more should keep at 10,000
    useEventStore.getState().addEvent(makeEvent('overflow'));
    expect(useEventStore.getState().events).toHaveLength(10_000);
    expect(useEventStore.getState().events[9999].id).toBe('overflow');
  });

  it('addEvents bulk adds', () => {
    const events = [makeEvent('e1'), makeEvent('e2'), makeEvent('e3')];
    useEventStore.getState().addEvents(events);
    expect(useEventStore.getState().events).toHaveLength(3);
  });

  it('clear resets to empty', () => {
    useEventStore.getState().addEvent(makeEvent('e1'));
    useEventStore.getState().clear();
    expect(useEventStore.getState().events).toHaveLength(0);
  });
});
