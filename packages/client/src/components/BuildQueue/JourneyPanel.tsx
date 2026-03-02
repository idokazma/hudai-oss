import { useEffect, useRef } from 'react';
import { useJourneyStore, type JourneyEntry } from '../../stores/journey-store.js';
import { useEventStore } from '../../stores/event-store.js';
import { useGraphStore } from '../../stores/graph-store.js';
import { colors, fonts } from '../../theme/tokens.js';

const typeColors: Record<JourneyEntry['type'], string> = {
  file: colors.accent.blue,
  shell: colors.accent.orange,
  search: '#8b5cf6',
  think: colors.text.muted,
  test: '#f59e0b',
  plan: colors.status.success,
  control: colors.text.muted,
};

const typeIcons: Record<JourneyEntry['type'], string> = {
  file: '◆',
  shell: '$',
  search: '⌕',
  think: '~',
  test: '⚑',
  plan: '☰',
  control: '·',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function JourneyCard({
  entry,
  isSelected,
  onSelect,
}: {
  entry: JourneyEntry;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const color = typeColors[entry.type];

  return (
    <button
      onClick={onSelect}
      style={{
        display: 'block',
        width: '100%',
        padding: '8px 12px',
        background: isSelected ? `${color}15` : 'transparent',
        border: 'none',
        borderLeft: `3px solid ${isSelected ? color : 'transparent'}`,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) (e.currentTarget as HTMLElement).style.background = colors.surface.base;
      }}
      onMouseLeave={(e) => {
        if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {/* Top row: icon + label + time */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <span style={{ fontSize: 12, color, flexShrink: 0 }}>
          {typeIcons[entry.type]}
        </span>
        <span style={{
          fontSize: 13,
          fontFamily: fonts.mono,
          color: colors.text.primary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {entry.label}
        </span>
        <span style={{
          fontSize: 10,
          fontFamily: fonts.mono,
          color: colors.text.muted,
          flexShrink: 0,
        }}>
          {formatTime(entry.timestamp)}
        </span>
      </div>

      {/* Action badges */}
      {entry.actions.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 3,
          marginTop: 3,
          marginLeft: 16,
        }}>
          {entry.actions.map((a, i) => (
            <span
              key={i}
              style={{
                fontSize: 10,
                fontFamily: fonts.mono,
                padding: '1px 4px',
                borderRadius: 2,
                background: `${color}20`,
                color,
                fontWeight: 600,
              }}
            >
              {a}
            </span>
          ))}
          {entry.eventIds.length > 1 && (
            <span style={{
              fontSize: 10,
              fontFamily: fonts.mono,
              color: colors.text.muted,
            }}>
              {entry.eventIds.length} actions
            </span>
          )}
        </div>
      )}

      {/* Detail line */}
      {entry.detail && entry.type !== 'file' && (
        <div style={{
          marginTop: 2,
          marginLeft: 16,
          fontSize: 11,
          fontFamily: fonts.mono,
          color: colors.text.muted,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {entry.detail}
        </div>
      )}
    </button>
  );
}

export function JourneyPanel() {
  const entries = useJourneyStore((s) => s.entries);
  const selectedEntryId = useJourneyStore((s) => s.selectedEntryId);
  const selectEntry = useJourneyStore((s) => s.selectEntry);
  const processEvents = useJourneyStore((s) => s.processEvents);
  const events = useEventStore((s) => s.events);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Re-derive journey entries when events change
  useEffect(() => {
    processEvents(events);
  }, [events, processEvents]);

  // Auto-scroll to top (latest entry) when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [entries.length]);

  const handleSelect = (entry: JourneyEntry) => {
    selectEntry(entry.id);
    // Highlight node on codemap if it has one
    if (entry.nodeId) {
      // Dispatch to graph store to trigger focus ring
      const { graph } = useGraphStore.getState();
      if (graph) {
        // The MapRenderer's showFocusRing is called via the onNodeClick flow
        // For now, just select — the codemap integration will be wired later
      }
    }
  };

  const reversed = [...entries].reverse();

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      paddingTop: 36,
    }}>
      {/* Stats */}
      <div style={{
        padding: '6px 12px',
        fontSize: 11,
        fontFamily: fonts.mono,
        color: colors.text.muted,
        borderBottom: `1px solid ${colors.border.subtle}`,
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>{entries.length} steps</span>
        {entries.length > 0 && (
          <span>
            {formatTime(entries[0].timestamp)} — {formatTime(entries[entries.length - 1].timestamp)}
          </span>
        )}
      </div>

      {/* Journey list */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {entries.length === 0 ? (
          <div style={{
            padding: '20px 12px',
            fontSize: 12,
            color: colors.text.muted,
            textAlign: 'center',
            lineHeight: 1.6,
          }}>
            No journey data yet
            <br />
            <span style={{ fontSize: 11 }}>Agent actions will appear here as a path</span>
          </div>
        ) : (
          reversed.map((entry) => (
            <JourneyCard
              key={entry.id}
              entry={entry}
              isSelected={selectedEntryId === entry.id}
              onSelect={() => handleSelect(entry)}
            />
          ))
        )}
      </div>
    </div>
  );
}
