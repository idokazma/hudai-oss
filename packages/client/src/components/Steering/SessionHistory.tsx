import { useEffect } from 'react';
import { useReplayStore } from '../../stores/replay-store.js';
import { colors, alpha, fonts } from '../../theme/tokens.js';
import type { SessionSummary } from '@hudai/shared';

function formatDate(ts: number): string {
  const d = new Date(ts);
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${hours}:${mins}`;
}

function formatDuration(startedAt: number, endedAt: number | null): string {
  if (!endedAt) return 'ongoing';
  const sec = Math.round((endedAt - startedAt) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}m ${s}s`;
}

const statusBadge: Record<string, { color: string; label: string }> = {
  running: { color: colors.accent.blue, label: 'LIVE' },
  complete: { color: colors.status.successLight, label: 'DONE' },
  error: { color: colors.status.errorLight, label: 'ERR' },
};

function SessionItem({ session, onSelect, isActive }: {
  session: SessionSummary;
  onSelect: () => void;
  isActive: boolean;
}) {
  const badge = statusBadge[session.status] ?? { color: colors.text.muted, label: session.status };

  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 12px',
        background: isActive ? alpha(colors.accent.primary, 0.12) : 'transparent',
        border: 'none',
        borderLeft: `3px solid ${isActive ? colors.accent.blue : 'transparent'}`,
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        transition: 'background 0.2s',
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = colors.surface.base;
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = 'transparent';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{
          fontSize: 12,
          fontFamily: fonts.mono,
          color: colors.text.secondary,
        }}>
          {formatDate(session.startedAt)}
        </span>
        <span style={{
          fontSize: 10,
          fontFamily: fonts.mono,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          padding: '1px 5px',
          borderRadius: 3,
          background: badge.color + '22',
          color: badge.color,
          border: `1px solid ${badge.color}33`,
        }}>
          {badge.label}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: colors.text.muted, fontFamily: fonts.mono }}>
          {session.eventCount} events
        </span>
        <span style={{ fontSize: 11, color: colors.text.muted }}>
          {formatDuration(session.startedAt, session.endedAt)}
        </span>
      </div>
    </button>
  );
}

export function SessionHistory({ onClose }: { onClose: () => void }) {
  const sessions = useReplayStore((s) => s.sessions);
  const requestSessions = useReplayStore((s) => s.requestSessions);
  const enterReplay = useReplayStore((s) => s.enterReplay);
  const replaySessionId = useReplayStore((s) => s.replaySessionId);
  const mode = useReplayStore((s) => s.mode);
  const exitReplay = useReplayStore((s) => s.exitReplay);

  useEffect(() => {
    requestSessions();
  }, [requestSessions]);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 12px',
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 1.5,
        color: colors.text.muted,
        borderBottom: `1px solid ${colors.border.subtle}`,
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>Session History</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: colors.text.muted,
            cursor: 'pointer',
            fontSize: 12,
            padding: '0 4px',
          }}
        >
          x
        </button>
      </div>

      {/* Back to live button */}
      {mode === 'replay' && (
        <button
          onClick={() => {
            exitReplay();
            onClose();
          }}
          style={{
            margin: '8px 12px',
            padding: '6px 12px',
            background: colors.accent.blue,
            border: 'none',
            borderRadius: 4,
            color: colors.text.white,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: 1,
            flexShrink: 0,
          }}
        >
          Back to Live
        </button>
      )}

      {/* Session list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}>
        {sessions.length === 0 ? (
          <div style={{
            padding: '20px 12px',
            fontSize: 12,
            color: colors.text.muted,
            textAlign: 'center',
          }}>
            No past sessions found
          </div>
        ) : (
          sessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              isActive={replaySessionId === s.id}
              onSelect={() => {
                if (s.eventCount > 0) {
                  enterReplay(s.id);
                }
              }}
            />
          ))
        )}
      </div>

      {/* Refresh */}
      <div style={{
        padding: '8px 12px',
        borderTop: `1px solid ${colors.border.subtle}`,
        flexShrink: 0,
      }}>
        <button
          onClick={requestSessions}
          style={{
            width: '100%',
            padding: '4px',
            background: 'none',
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: 3,
            color: colors.text.muted,
            fontSize: 11,
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
