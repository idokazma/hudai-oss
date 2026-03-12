import { useSessionStore } from '../../stores/session-store.js';
import { useNotificationStore } from '../../stores/notification-store.js';
import { colors, fonts, alpha } from '../../theme/tokens.js';

const STATUS_COLORS: Record<string, string> = {
  idle: colors.status.successLight,
  running: colors.accent.primary,
  paused: colors.status.warning,
  complete: colors.status.successLight,
  error: colors.status.errorLight,
};

interface Props {
  onPromptOpen: () => void;
}

export function MobileHeader({ onPromptOpen }: Props) {
  const session = useSessionStore((s) => s.session);
  const lastActivity = useNotificationStore((s) => s.lastActivity);
  const statusColor = STATUS_COLORS[session.status] ?? STATUS_COLORS.idle;
  const isWaiting = lastActivity === 'waiting_permission' || lastActivity === 'waiting_answer';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
        borderBottom: `1px solid ${colors.border.subtle}`,
        flexShrink: 0,
      }}
    >
      {/* Status dot */}
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: statusColor,
          boxShadow: session.status === 'running' ? `0 0 8px ${alpha(statusColor, 0.6)}` : 'none',
          animation: session.status === 'running' ? 'mobilePulse 2s ease-in-out infinite' : 'none',
          flexShrink: 0,
        }}
      />

      {/* Task label */}
      <div
        style={{
          flex: 1,
          fontSize: 14,
          fontFamily: fonts.body,
          fontWeight: 600,
          color: colors.text.primary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {session.taskLabel || 'Hudai'}
      </div>

      {/* Attention badge */}
      {isWaiting && (
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: colors.status.errorLight,
            animation: 'mobilePulse 1s ease-in-out infinite',
          }}
        />
      )}

      {/* Prompt trigger */}
      <button
        onClick={onPromptOpen}
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          border: `1px solid ${colors.border.subtle}`,
          background: colors.surface.base,
          color: colors.text.secondary,
          fontSize: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        ⌨
      </button>
    </div>
  );
}
