import { useEffect, useRef } from 'react';
import { useChatStore } from '../../../stores/chat-store.js';
import { colors, fonts, alpha } from '../../../theme/tokens.js';

const SEVERITY_COLORS: Record<string, string> = {
  critical: colors.status.errorLight,
  warning: colors.status.warning,
  info: colors.accent.primary,
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function AdvisorMessages({ maxMessages = 5 }: { maxMessages?: number }) {
  const messages = useChatStore((s) => s.messages);
  const typing = useChatStore((s) => s.typing);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Only show advisor messages (not actionable/respondable — those go in ActionCardStack)
  const advisorMessages = messages
    .filter((m) => m.role === 'advisor' && !m.actionable && !m.respondable)
    .slice(-maxMessages);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [advisorMessages.length, typing]);

  if (advisorMessages.length === 0 && !typing) return null;

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
          marginBottom: 10,
        }}
      >
        Advisor
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxHeight: 300,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {advisorMessages.map((msg) => {
          const sevColor = msg.severity ? SEVERITY_COLORS[msg.severity] : undefined;
          return (
            <div
              key={msg.id}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                background: colors.surface.base,
                borderLeft: `3px solid ${sevColor ?? colors.action.think}`,
              }}
            >
              {/* Header: severity + time */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 4,
                }}
              >
                {sevColor && (
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: fonts.mono,
                      fontWeight: 700,
                      color: sevColor,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {msg.severity}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: fonts.mono,
                    color: colors.text.dimmed,
                    marginLeft: 'auto',
                  }}
                >
                  {formatTime(msg.timestamp)}
                </span>
              </div>

              {/* Message text */}
              <div
                style={{
                  fontSize: 13,
                  fontFamily: fonts.body,
                  color: colors.text.secondary,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {msg.text}
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {typing && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: colors.surface.base,
              borderLeft: `3px solid ${colors.action.think}`,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontFamily: fonts.body,
                color: colors.text.dimmed,
                fontStyle: 'italic',
              }}
            >
              Thinking...
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
