import { useState, useEffect, useCallback, useRef } from 'react';
import { useSessionStore } from '../../stores/session-store.js';
import { useDensityStore } from '../../stores/density-store.js';
import { wsClient } from '../../ws/ws-client.js';
import { colors, alpha, fonts } from '../../theme/tokens.js';

type NotificationType = 'permission' | 'question' | null;

function getNotificationType(activity?: string): NotificationType {
  if (activity === 'waiting_permission') return 'permission';
  if (activity === 'waiting_answer') return 'question';
  return null;
}

const ACCENT = {
  permission: colors.status.warning,
  question: colors.action.think,
} as const;

export function AgentNotification() {
  const session = useSessionStore((s) => s.session);
  const chatVisible = useDensityStore((s) => s.chatVisible);
  const terminalVisible = useDensityStore((s) => s.terminalVisible);
  const type = getNotificationType(session.agentActivity);
  const detail = session.agentActivityDetail ?? '';
  const options = session.agentActivityOptions ?? [];

  const [visible, setVisible] = useState(false);
  const [answer, setAnswer] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (type) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
    setAnswer('');
  }, [type, detail]);

  const approve = useCallback(() => {
    wsClient.send({ kind: 'command', command: { type: 'approve' } });
  }, []);

  const reject = useCallback(() => {
    wsClient.send({ kind: 'command', command: { type: 'reject' } });
  }, []);

  const sendAnswer = useCallback((text: string) => {
    if (!text.trim()) return;
    wsClient.send({ kind: 'command', command: { type: 'prompt', data: { text: text.trim() } } });
    setAnswer('');
  }, []);

  useEffect(() => {
    if (!type) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (type === 'permission' && !isInput) {
        if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          approve();
        } else if (e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          reject();
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [type, approve, reject]);

  // Don't show popup when chat or terminal is visible — user can see/handle it there
  if (!type || chatVisible || terminalVisible) return null;

  const accent = ACCENT[type];
  const label = type === 'permission' ? 'PERMISSION REQUEST' : 'QUESTION';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 80,
        right: 24,
        zIndex: 9000,
        width: 380,
        transform: visible ? 'translateX(0)' : 'translateX(420px)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <div
        style={{
          background: colors.bg.panel,
          border: `1px solid ${alpha(accent, 0.4)}`,
          borderRadius: 10,
          boxShadow: `0 0 20px ${alpha(accent, 0.15)}, ${colors.surface.shadow}`,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '8px 14px',
            background: alpha(accent, 0.12),
            borderBottom: `1px solid ${alpha(accent, 0.2)}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: accent,
              boxShadow: `0 0 6px ${accent}`,
              animation: 'pulse 2s infinite',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: fonts.display,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1.5,
              color: accent,
              textTransform: 'uppercase',
            }}
          >
            {label}
          </span>
        </div>

        <div style={{ padding: '12px 14px' }}>
          <p
            style={{
              margin: 0,
              fontFamily: fonts.mono,
              fontSize: 12,
              lineHeight: 1.5,
              color: colors.text.primary,
              wordBreak: 'break-word',
            }}
          >
            {detail || (type === 'permission' ? 'Tool requires approval' : 'Agent is asking a question')}
          </p>
        </div>

        <div
          style={{
            padding: '0 14px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {type === 'permission' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={approve} style={btnStyle(accent, true)}>
                Approve
                <kbd style={kbdStyle}>Y</kbd>
              </button>
              <button onClick={reject} style={btnStyle(accent, false)}>
                Reject
                <kbd style={kbdStyle}>N</kbd>
              </button>
            </div>
          )}

          {type === 'question' && (
            <>
              {options.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {options.map((opt, i) => (
                    <button
                      key={opt}
                      onClick={() => sendAnswer(opt)}
                      style={btnStyle(accent, i === 0)}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') sendAnswer(answer);
                  }}
                  placeholder="Type an answer..."
                  style={{
                    flex: 1,
                    background: colors.surface.base,
                    border: `1px solid ${alpha(accent, 0.25)}`,
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontFamily: fonts.mono,
                    fontSize: 12,
                    color: colors.text.primary,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => sendAnswer(answer)}
                  style={btnStyle(accent, true)}
                >
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

function btnStyle(accent: string, primary: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 6,
    border: primary ? 'none' : `1px solid ${alpha(accent, 0.3)}`,
    background: primary ? alpha(accent, 0.25) : 'transparent',
    color: primary ? colors.text.primary : colors.text.secondary,
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    transition: 'background 0.15s',
  };
}

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 5px',
  borderRadius: 3,
  background: 'rgba(255,255,255,0.08)',
  fontFamily: fonts.mono,
  fontSize: 10,
  color: colors.text.muted,
};
