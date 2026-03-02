import { useEffect, useRef } from 'react';
import { useReplayStore } from '../stores/replay-store.js';
import { useEventStore } from '../stores/event-store.js';
import { usePlanStore } from '../stores/plan-store.js';
import { useNotificationStore } from '../stores/notification-store.js';
import { useGraphStore } from '../stores/graph-store.js';
import { useSessionStore } from '../stores/session-store.js';

/**
 * Replay engine: drives cursor advancement during playback
 * and re-derives store state when cursor changes (play or seek).
 */
export function useReplayEngine() {
  const mode = useReplayStore((s) => s.mode);
  const events = useReplayStore((s) => s.events);
  const cursor = useReplayStore((s) => s.cursor);
  const playing = useReplayStore((s) => s.playing);
  const speed = useReplayStore((s) => s.speed);
  const setCursor = useReplayStore((s) => s.setCursor);
  const pause = useReplayStore((s) => s.pause);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCursorRef = useRef(-1);

  // Playback: advance cursor at speed-adjusted intervals
  useEffect(() => {
    if (mode !== 'replay' || !playing || events.length === 0) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    function scheduleNext() {
      const currentCursor = useReplayStore.getState().cursor;
      const allEvents = useReplayStore.getState().events;
      const currentSpeed = useReplayStore.getState().speed;

      if (currentCursor >= allEvents.length - 1) {
        useReplayStore.getState().pause();
        return;
      }

      const currentEvent = allEvents[currentCursor];
      const nextEvent = allEvents[currentCursor + 1];
      // Delay based on original timing, capped at 2s, divided by speed
      const rawDelay = nextEvent.timestamp - currentEvent.timestamp;
      const delay = Math.min(2000, Math.max(50, rawDelay)) / currentSpeed;

      timerRef.current = setTimeout(() => {
        useReplayStore.getState().setCursor(currentCursor + 1);
        scheduleNext();
      }, delay);
    }

    scheduleNext();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [mode, playing, events.length, speed]);

  // Re-derive all store state when cursor changes
  useEffect(() => {
    if (mode !== 'replay' || events.length === 0) return;
    if (cursor === lastCursorRef.current) return;

    const isSeekingBack = cursor < lastCursorRef.current;
    lastCursorRef.current = cursor;

    if (isSeekingBack) {
      // Seeking backward: clear everything and replay from start to cursor
      useEventStore.getState().clear();
      usePlanStore.getState().clear();
      useNotificationStore.getState().clear();

      const slice = events.slice(0, cursor + 1);
      useEventStore.getState().addEvents(slice);
      for (const evt of slice) {
        usePlanStore.getState().updateFromEvent(evt);
        useGraphStore.getState().addActivity(evt);
      }
    } else {
      // Stepping forward: just process the new event
      const evt = events[cursor];
      if (evt) {
        useEventStore.getState().addEvent(evt);
        usePlanStore.getState().updateFromEvent(evt);
        useGraphStore.getState().addActivity(evt);
        const allEvts = useEventStore.getState().events;
        useSessionStore.getState().updateFromEvent(evt, allEvts.length);

        // Update agentCurrentFile from file events
        if (evt.type === 'file.read' || evt.type === 'file.edit' || evt.type === 'file.create') {
          useSessionStore.getState().patchSession({
            agentCurrentFile: (evt as any).data.path,
          });
        }
      }
    }
  }, [mode, cursor, events]);

  // On entering replay, set session state to replay session info
  useEffect(() => {
    if (mode === 'replay' && events.length > 0) {
      const firstEvent = events[0];
      useSessionStore.getState().patchSession({
        sessionId: firstEvent.sessionId,
        status: 'complete',
        startedAt: firstEvent.timestamp,
        eventCount: events.length,
        taskLabel: 'Replay',
      });
      // Clear stores and start fresh
      useEventStore.getState().clear();
      usePlanStore.getState().clear();
      useNotificationStore.getState().clear();
      lastCursorRef.current = -1;
    }
  }, [mode, events.length]);

  // On exiting replay, reset cursor tracker
  useEffect(() => {
    if (mode === 'live') {
      lastCursorRef.current = -1;
    }
  }, [mode]);
}
