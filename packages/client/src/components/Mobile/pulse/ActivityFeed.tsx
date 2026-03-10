import { useEffect } from 'react';
import { useJourneyStore, type JourneyEntry } from '../../../stores/journey-store.js';
import { useEventStore } from '../../../stores/event-store.js';
import { colors, fonts, EVENT_COLORS } from '../../../theme/tokens.js';

const TYPE_ICONS: Record<JourneyEntry['type'], string> = {
  file: '📄',
  shell: '$',
  search: '🔍',
  think: '💭',
  test: '🧪',
  plan: '📋',
  control: '⚡',
};

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

function FeedItem({ entry }: { entry: JourneyEntry }) {
  const dotColor = entry.type === 'file'
    ? (entry.actions.includes('E') || entry.actions.includes('C')
      ? EVENT_COLORS['file.edit']
      : EVENT_COLORS['file.read'])
    : entry.type === 'shell'
      ? EVENT_COLORS['shell.run']
      : entry.type === 'search'
        ? EVENT_COLORS['search.grep']
        : entry.type === 'test'
          ? EVENT_COLORS['test.run']
          : colors.text.dimmed;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 0',
        borderBottom: `1px solid ${colors.border.subtle}`,
      }}
    >
      {/* Type indicator */}
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
        }}
      />

      {/* Label */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontFamily: fonts.mono,
            color: colors.text.primary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.label}
        </div>
        {entry.actions.length > 0 && (
          <div
            style={{
              fontSize: 10,
              fontFamily: fonts.mono,
              color: colors.text.dimmed,
              marginTop: 1,
            }}
          >
            {entry.actions.join(' ')}
            {entry.visits > 1 && ` ×${entry.visits}`}
          </div>
        )}
      </div>

      {/* Timestamp */}
      <span
        style={{
          fontSize: 10,
          fontFamily: fonts.mono,
          color: colors.text.dimmed,
          flexShrink: 0,
        }}
      >
        {timeAgo(entry.timestamp)}
      </span>
    </div>
  );
}

export function ActivityFeed() {
  const entries = useJourneyStore((s) => s.entries);
  const events = useEventStore((s) => s.events);
  const processEvents = useJourneyStore((s) => s.processEvents);

  // Rebuild journey entries when events change
  useEffect(() => {
    if (events.length > 0) processEvents(events);
  }, [events.length]);

  const recent = entries.slice(-20).reverse();

  if (recent.length === 0) {
    return (
      <div
        style={{
          padding: '24px 16px',
          textAlign: 'center',
          fontSize: 13,
          fontFamily: fonts.mono,
          color: colors.text.dimmed,
        }}
      >
        No activity yet
      </div>
    );
  }

  return (
    <div style={{ padding: '0 16px' }}>
      <div
        style={{
          fontSize: 11,
          fontFamily: fonts.body,
          color: colors.text.muted,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        Recent Activity
      </div>
      {recent.map((entry) => (
        <FeedItem key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
