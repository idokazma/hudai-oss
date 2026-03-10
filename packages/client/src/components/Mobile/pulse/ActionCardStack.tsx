import { useState, useCallback } from 'react';
import { useChatStore } from '../../../stores/chat-store.js';
import { wsClient } from '../../../ws/ws-client.js';
import { colors, fonts, alpha } from '../../../theme/tokens.js';
import type { ChatMessage } from '@hudai/shared';

function ActionCard({ msg, onDismiss }: { msg: ChatMessage; onDismiss: () => void }) {
  const resolveMessage = useChatStore((s) => s.resolveMessage);
  const [offsetX, setOffsetX] = useState(0);
  const [startX, setStartX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const isPermission = msg.actionable;
  const isQuestion = msg.respondable;

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isQuestion) return; // Questions use buttons, not swipe
    setStartX(e.touches[0].clientX);
    setSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swiping) return;
    setOffsetX(e.touches[0].clientX - startX);
  };

  const handleTouchEnd = () => {
    if (!swiping) return;
    setSwiping(false);
    const threshold = 80;
    if (Math.abs(offsetX) > threshold) {
      const direction = offsetX > 0 ? 'right' : 'left';
      setDismissed(true);
      setTimeout(() => {
        if (direction === 'right') {
          wsClient.send({ kind: 'command', command: { type: 'approve' } });
        } else {
          wsClient.send({ kind: 'command', command: { type: 'reject' } });
        }
        resolveMessage(msg.id);
        onDismiss();
      }, 200);
    } else {
      setOffsetX(0);
    }
  };

  const sendOption = (optionNumber: number) => {
    wsClient.send({ kind: 'command', command: { type: 'prompt', data: { text: String(optionNumber) } } });
    resolveMessage(msg.id);
    onDismiss();
  };

  // Swipe color feedback
  const swipeRatio = Math.min(1, Math.abs(offsetX) / 120);
  const swipeBg = offsetX > 20
    ? alpha(colors.status.successLight, swipeRatio * 0.15)
    : offsetX < -20
      ? alpha(colors.status.errorLight, swipeRatio * 0.15)
      : 'transparent';
  const borderColor = offsetX > 20
    ? alpha(colors.status.successLight, 0.4)
    : offsetX < -20
      ? alpha(colors.status.errorLight, 0.4)
      : colors.border.medium;

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        background: `${colors.bg.card}`,
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        padding: 16,
        transform: dismissed
          ? `translateX(${offsetX > 0 ? 300 : -300}px) rotate(${offsetX > 0 ? 10 : -10}deg)`
          : `translateX(${offsetX}px) rotate(${offsetX * 0.03}deg)`,
        transition: swiping ? 'none' : 'transform 0.3s ease, opacity 0.2s',
        opacity: dismissed ? 0 : 1,
        backgroundImage: `linear-gradient(135deg, ${swipeBg}, transparent)`,
        touchAction: 'pan-y',
      }}
    >
      {/* Header */}
      <div
        style={{
          fontSize: 10,
          fontFamily: fonts.body,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: isPermission ? colors.status.warning : colors.accent.primary,
          marginBottom: 8,
        }}
      >
        {isPermission ? 'Approval Needed' : isQuestion ? 'Question' : 'Action'}
      </div>

      {/* Content */}
      <div
        style={{
          fontSize: 14,
          fontFamily: fonts.mono,
          color: colors.text.secondary,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 120,
          overflow: 'auto',
          marginBottom: 12,
        }}
      >
        {msg.text}
      </div>

      {/* Swipe hint for permissions */}
      {isPermission && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            color: colors.text.dimmed,
          }}
        >
          <span>← Reject</span>
          <span>Approve →</span>
        </div>
      )}

      {/* Option buttons for questions */}
      {isQuestion && msg.options && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {msg.options.map((option, idx) => (
            <button
              key={idx}
              onClick={() => sendOption(idx + 1)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                background: colors.surface.base,
                border: `1px solid ${colors.border.subtle}`,
                borderRadius: 8,
                color: colors.text.primary,
                fontSize: 14,
                fontFamily: fonts.mono,
                cursor: 'pointer',
                textAlign: 'left',
                minHeight: 44,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: colors.accent.primary,
                  minWidth: 18,
                }}
              >
                {idx + 1}.
              </span>
              <span>{option}</span>
            </button>
          ))}
        </div>
      )}

      {/* Fallback buttons for permissions (non-touch) */}
      {isPermission && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={() => {
              wsClient.send({ kind: 'command', command: { type: 'approve' } });
              resolveMessage(msg.id);
              onDismiss();
            }}
            style={{
              flex: 1,
              height: 44,
              border: 'none',
              borderRadius: 8,
              background: colors.status.success,
              color: colors.text.white,
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Approve
          </button>
          <button
            onClick={() => {
              wsClient.send({ kind: 'command', command: { type: 'reject' } });
              resolveMessage(msg.id);
              onDismiss();
            }}
            style={{
              flex: 1,
              height: 44,
              border: 'none',
              borderRadius: 8,
              background: colors.status.error,
              color: colors.text.white,
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

export function ActionCardStack() {
  const messages = useChatStore((s) => s.messages);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const actionable = messages.filter(
    (m) => (m.actionable || m.respondable) && !m.resolved && !dismissedIds.has(m.id),
  );

  const handleDismiss = useCallback((id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
  }, []);

  if (actionable.length === 0) return null;

  return (
    <div style={{ padding: '0 16px' }}>
      {/* Counter */}
      <div
        style={{
          fontSize: 11,
          fontFamily: fonts.body,
          color: colors.text.muted,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 8,
          fontWeight: 600,
        }}
      >
        {actionable.length} action{actionable.length !== 1 ? 's' : ''} pending
      </div>

      {/* Show top card */}
      <ActionCard
        key={actionable[0].id}
        msg={actionable[0]}
        onDismiss={() => handleDismiss(actionable[0].id)}
      />

      {/* Stack indicator for remaining cards */}
      {actionable.length > 1 && (
        <div
          style={{
            height: 6,
            margin: '0 12px',
            background: alpha(colors.bg.card, 0.6),
            border: `1px solid ${colors.border.subtle}`,
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
          }}
        />
      )}
    </div>
  );
}
