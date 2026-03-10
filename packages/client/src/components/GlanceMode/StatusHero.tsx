import React from 'react';
import { useSessionStore } from '../../stores/session-store.js';
import { colors, fonts, alpha } from '../../theme/tokens.js';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  idle: { label: 'IDLE', color: colors.status.successLight },
  running: { label: 'WORKING', color: colors.accent.blue },
  paused: { label: 'PAUSED', color: colors.status.warning },
  complete: { label: 'COMPLETE', color: colors.status.successLight },
  error: { label: 'ERROR', color: colors.status.errorLight },
};

export const StatusHero: React.FC = () => {
  const session = useSessionStore((s) => s.session);
  const mapped = STATUS_MAP[session.status] ?? STATUS_MAP.idle;

  return (
    <div style={{ textAlign: 'center', marginBottom: 32 }}>
      <div
        style={{
          fontSize: 56,
          fontFamily: fonts.display,
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: mapped.color,
          textShadow: `0 0 24px ${alpha(mapped.color, 0.4)}`,
          lineHeight: 1,
          marginBottom: 12,
        }}
      >
        {mapped.label}
      </div>

      {session.taskLabel && session.taskLabel !== 'No active task' && (
        <div
          style={{
            fontSize: 15,
            fontFamily: fonts.body,
            color: colors.text.secondary,
            maxWidth: 480,
            margin: '0 auto',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {session.taskLabel}
        </div>
      )}

      {session.agentCurrentFile && (
        <div
          style={{
            fontSize: 12,
            fontFamily: fonts.mono,
            color: colors.text.muted,
            marginTop: 6,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 400,
            margin: '6px auto 0',
          }}
        >
          {session.agentCurrentFile}
        </div>
      )}
    </div>
  );
};
