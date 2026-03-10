import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { wsClient } from '../../ws/ws-client.js';
import { colors, fonts, alpha } from '../../theme/tokens.js';

const QUICK_ACTIONS = [
  { label: 'Approve', command: { type: 'approve' as const }, color: colors.status.success },
  { label: 'Reject', command: { type: 'reject' as const }, color: colors.status.error },
  { label: 'Continue', prompt: 'continue', color: colors.accent.primary },
];

interface Props {
  onClose: () => void;
}

export function PromptOverlay({ onClose }: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    wsClient.send({ kind: 'command', command: { type: 'prompt', data: { text: trimmed } } });
    setText('');
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: 'relative',
          background: colors.bg.secondary,
          borderTop: `1px solid ${colors.border.medium}`,
          borderRadius: '16px 16px 0 0',
          padding: '16px 16px calc(16px + env(safe-area-inset-bottom))',
          animation: 'mobileSlideUp 0.25s ease-out',
        }}
      >
        {/* Handle */}
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: colors.text.dimmed,
            margin: '0 auto 16px',
          }}
        />

        {/* Quick actions */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => {
                if (action.command) {
                  wsClient.send({ kind: 'command', command: action.command as any });
                } else if (action.prompt) {
                  wsClient.send({ kind: 'command', command: { type: 'prompt', data: { text: action.prompt } } });
                }
                onClose();
              }}
              style={{
                flex: 1,
                height: 44,
                border: `1px solid ${alpha(action.color, 0.3)}`,
                borderRadius: 8,
                background: alpha(action.color, 0.1),
                color: action.color,
                fontSize: 14,
                fontFamily: fonts.body,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {action.label}
            </button>
          ))}
        </div>

        {/* Text input */}
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a prompt to the agent..."
            rows={2}
            style={{
              flex: 1,
              background: colors.surface.dimmer,
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: 8,
              color: colors.text.primary,
              fontSize: 15,
              fontFamily: fonts.mono,
              padding: '10px 12px',
              resize: 'none',
              outline: 'none',
            }}
          />
          <button
            onClick={send}
            disabled={!text.trim()}
            style={{
              width: 48,
              borderRadius: 8,
              border: 'none',
              background: text.trim() ? colors.accent.primary : colors.surface.dimmer,
              color: colors.text.white,
              fontSize: 18,
              cursor: text.trim() ? 'pointer' : 'default',
              opacity: text.trim() ? 1 : 0.4,
              alignSelf: 'stretch',
            }}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
