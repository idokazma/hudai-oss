import { useRef, useEffect, useState } from 'react';
import { useEventStore } from '../../stores/event-store.js';
import { useReplayStore } from '../../stores/replay-store.js';
import { TimelineBlock, TIMELINE_LEGEND } from './TimelineBlock.js';
import { TimelineScrubber } from './TimelineScrubber.js';
import { WaterfallView } from './WaterfallView.js';
import { colors, fonts } from '../../theme/tokens.js';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function Timeline() {
  const events = useEventStore((s) => s.events);
  const replayMode = useReplayStore((s) => s.mode);
  const replayCursor = useReplayStore((s) => s.cursor);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'waterfall'>('cards');

  const isReplay = replayMode === 'replay';

  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        if (isReplay) {
          // In replay, scroll to cursor position
          const blocks = scrollRef.current.children;
          const targetBlock = blocks[Math.min(replayCursor, blocks.length - 1)] as HTMLElement;
          if (targetBlock) {
            targetBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }
        } else {
          scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
      }
    });
  }, [events.length, isReplay, replayCursor]);

  // Only show actionable events
  const timelineEvents = events.filter((e) =>
    e.type !== 'raw.output'
  );

  // Time markers
  const firstTs = timelineEvents[0]?.timestamp;
  const lastTs = timelineEvents[timelineEvents.length - 1]?.timestamp;
  const elapsedSec = firstTs && lastTs ? Math.round((lastTs - firstTs) / 1000) : 0;

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: 0,
      background: 'rgba(0,0,0,0.15)',
      borderTop: `1px solid ${colors.border.subtle}`,
    }}>
      {/* Header row: label + time markers + legend */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 16px 4px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 1.5,
            color: colors.text.muted,
          }}>
            Activity
          </span>
          <div style={{ display: 'flex', gap: 2 }}>
            {(['cards', 'waterfall'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  background: viewMode === mode ? 'rgba(255,255,255,0.1)' : 'none',
                  border: `1px solid ${viewMode === mode ? colors.border.subtle : 'transparent'}`,
                  borderRadius: 3,
                  color: viewMode === mode ? colors.text.secondary : colors.text.muted,
                  fontSize: 10,
                  fontFamily: fonts.mono,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  padding: '2px 6px',
                  cursor: 'pointer',
                }}
              >
                {mode === 'cards' ? '▮▮' : '▬▬'}
              </button>
            ))}
          </div>
          {firstTs && (
            <span style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.text.muted }}>
              {formatTime(firstTs)} — {elapsedSec}s elapsed
            </span>
          )}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {TIMELINE_LEGEND.map((item) => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: item.color,
              }} />
              <span style={{
                fontSize: 10,
                color: colors.text.muted,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline content — cards or waterfall */}
      {viewMode === 'waterfall' ? (
        <WaterfallView />
      ) : (
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'flex-end',
            gap: 3,
            padding: '0 16px 8px',
            overflowX: 'auto',
            overflowY: 'hidden',
          }}
        >
          {timelineEvents.length === 0 && (
            <div style={{ color: colors.text.muted, fontSize: 13, padding: '12px 0' }}>
              Waiting for agent activity...
            </div>
          )}
          {timelineEvents.map((event, i) => (
            <TimelineBlock
              key={event.id}
              event={event}
              isLatest={i === timelineEvents.length - 1}
            />
          ))}
        </div>
      )}

      {/* Replay scrubber */}
      {isReplay && <TimelineScrubber />}

      {/* Glow animation for active block */}
      <style>{`
        @keyframes glow-pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
