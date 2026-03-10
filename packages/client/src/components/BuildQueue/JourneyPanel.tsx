import { useEffect, useRef, useCallback } from 'react';
import { useJourneyStore, type JourneyEntry } from '../../stores/journey-store.js';
import { useEventStore } from '../../stores/event-store.js';
import { useGraphStore } from '../../stores/graph-store.js';
import { colors, alpha, fonts } from '../../theme/tokens.js';

const TYPE_CONFIG: Record<JourneyEntry['type'], { icon: string; color: string; label: string }> = {
  file:    { icon: '◆', color: colors.accent.primary, label: 'File' },
  shell:   { icon: '$', color: colors.action.bash, label: 'Shell' },
  search:  { icon: '⌕', color: '#8b5cf6', label: 'Search' },
  think:   { icon: '~', color: colors.text.muted, label: 'Think' },
  test:    { icon: '⚑', color: '#f59e0b', label: 'Test' },
  plan:    { icon: '☰', color: colors.status.successLight, label: 'Plan' },
  control: { icon: '·', color: colors.text.dimmed, label: '' },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function JourneyNode({
  entry,
  isSelected,
  isLast,
  onSelect,
  onHover,
}: {
  entry: JourneyEntry;
  isSelected: boolean;
  isLast: boolean;
  onSelect: () => void;
  onHover: (nodeId: string | null) => void;
}) {
  const cfg = TYPE_CONFIG[entry.type];
  const nodeSize = entry.type === 'file' ? 10 : entry.type === 'test' ? 10 : 8;
  const hasMultipleVisits = entry.visits > 1;

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => entry.nodeId && onHover(entry.nodeId)}
      onMouseLeave={() => onHover(null)}
      style={{
        display: 'flex',
        gap: 0,
        padding: 0,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
    >
      {/* Timeline rail */}
      <div style={{
        width: 32,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        {/* Node dot */}
        <div style={{
          width: nodeSize,
          height: nodeSize,
          borderRadius: '50%',
          background: isSelected ? cfg.color : alpha(cfg.color, 0.7),
          border: `2px solid ${cfg.color}`,
          boxShadow: isSelected ? `0 0 8px ${alpha(cfg.color, 0.5)}` : 'none',
          flexShrink: 0,
          position: 'relative',
          zIndex: 1,
        }}>
          {hasMultipleVisits && (
            <div style={{
              position: 'absolute',
              top: -6,
              right: -8,
              fontSize: 8,
              fontFamily: fonts.mono,
              fontWeight: 700,
              color: cfg.color,
              background: colors.bg.primary,
              padding: '0 2px',
              borderRadius: 3,
              lineHeight: 1.2,
            }}>
              ×{entry.visits}
            </div>
          )}
        </div>
        {/* Connecting line */}
        {!isLast && (
          <div style={{
            width: 2,
            flex: 1,
            minHeight: 12,
            background: `linear-gradient(to bottom, ${alpha(cfg.color, 0.3)}, ${alpha(cfg.color, 0.08)})`,
          }} />
        )}
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        minWidth: 0,
        paddingBottom: isLast ? 0 : 10,
        paddingTop: 0,
        marginTop: -2,
      }}>
        {/* Label row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{
            fontSize: 12,
            fontFamily: fonts.mono,
            fontWeight: 600,
            color: isSelected ? colors.text.primary : colors.text.secondary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}>
            {entry.label}
          </span>
          <span style={{
            fontSize: 9,
            fontFamily: fonts.mono,
            color: colors.text.dimmed,
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
          }}>
            {entry.actions.map((a, i) => (
              <span
                key={i}
                style={{
                  fontSize: 9,
                  fontFamily: fonts.mono,
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: 3,
                  background: alpha(cfg.color, 0.15),
                  color: cfg.color,
                  letterSpacing: 0.5,
                }}
              >
                {a}
              </span>
            ))}
          </div>
        )}

        {/* Detail / path for non-file */}
        {entry.detail && entry.type !== 'file' && (
          <div style={{
            marginTop: 2,
            fontSize: 10,
            fontFamily: fonts.mono,
            color: colors.text.dimmed,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {entry.detail}
          </div>
        )}
      </div>
    </button>
  );
}

export function JourneyPanel() {
  const entries = useJourneyStore((s) => s.entries);
  const selectedEntryId = useJourneyStore((s) => s.selectedEntryId);
  const selectEntry = useJourneyStore((s) => s.selectEntry);
  const processEvents = useJourneyStore((s) => s.processEvents);
  const events = useEventStore((s) => s.events);
  const setHighlightNode = useGraphStore((s) => s.setHighlightNode);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleHover = useCallback((nodeId: string | null) => {
    setHighlightNode(nodeId);
  }, [setHighlightNode]);

  useEffect(() => {
    processEvents(events);
  }, [events, processEvents]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  // Compute type summary
  const typeCounts = new Map<JourneyEntry['type'], number>();
  for (const e of entries) {
    typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1);
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      paddingTop: 36,
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${colors.border.subtle}`,
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}>
          <span style={{
            fontSize: 10,
            fontFamily: fonts.display,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: colors.text.muted,
            textTransform: 'uppercase',
          }}>
            Journey
          </span>
          <span style={{
            fontSize: 10,
            fontFamily: fonts.mono,
            color: colors.text.dimmed,
          }}>
            {entries.length} steps
          </span>
        </div>
        {/* Type legend */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Array.from(typeCounts.entries()).map(([type, count]) => {
            const cfg = TYPE_CONFIG[type];
            return (
              <span key={type} style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 9,
                fontFamily: fonts.mono,
                color: cfg.color,
                padding: '1px 5px',
                borderRadius: 3,
                background: alpha(cfg.color, 0.1),
              }}>
                <span style={{ fontSize: 10 }}>{cfg.icon}</span>
                {count}
              </span>
            );
          })}
        </div>
      </div>

      {/* Timeline */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '10px 10px 10px 8px',
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
            <span style={{ fontSize: 11, color: colors.text.dimmed }}>
              Agent actions will trace a path here
            </span>
          </div>
        ) : (
          entries.map((entry, i) => (
            <JourneyNode
              key={entry.id}
              entry={entry}
              isSelected={selectedEntryId === entry.id}
              isLast={i === entries.length - 1}
              onSelect={() => selectEntry(entry.id)}
              onHover={handleHover}
            />
          ))
        )}
      </div>
    </div>
  );
}
