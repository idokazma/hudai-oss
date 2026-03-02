import type { AVPEvent } from '@hudai/shared';

export interface Decision {
  id: string;
  thinkEvent?: AVPEvent;
  actionEvents: AVPEvent[];
  startTs: number;
  endTs: number;
}

/**
 * Groups a list of AVP events into "decisions" —
 * each decision starts with a think.start event and includes
 * all following tool/action events until the next think.start or end.
 */
export function groupIntoDecisions(events: AVPEvent[]): Decision[] {
  const decisions: Decision[] = [];
  let current: Decision | null = null;
  let decisionIndex = 0;

  for (const event of events) {
    // Skip non-actionable events
    if (event.type === 'raw.output') continue;

    if (event.type === 'think.start') {
      // Finalize previous decision
      if (current && (current.thinkEvent || current.actionEvents.length > 0)) {
        current.endTs = event.timestamp;
        decisions.push(current);
      }
      // Start new decision
      current = {
        id: `decision-${decisionIndex++}`,
        thinkEvent: event,
        actionEvents: [],
        startTs: event.timestamp,
        endTs: event.timestamp,
      };
    } else {
      // Non-thinking event — add to current decision or create one
      if (!current) {
        current = {
          id: `decision-${decisionIndex++}`,
          actionEvents: [],
          startTs: event.timestamp,
          endTs: event.timestamp,
        };
      }
      current.actionEvents.push(event);
      current.endTs = event.timestamp;
    }
  }

  // Finalize last decision
  if (current && (current.thinkEvent || current.actionEvents.length > 0)) {
    decisions.push(current);
  }

  return decisions;
}
