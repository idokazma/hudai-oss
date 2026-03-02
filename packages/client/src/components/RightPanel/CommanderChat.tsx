import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useChatStore } from '../../stores/chat-store.js';
import { useSessionStore } from '../../stores/session-store.js';
import { useSwarmStore } from '../../stores/swarm-store.js';
import { wsClient } from '../../ws/ws-client.js';
import { colors, alpha, fonts, SEVERITY_COLOR, SEVERITY_BG } from '../../theme/tokens.js';
import { Dropdown } from '../shared/Dropdown.js';
import type { ChatMessage, AdvisorVerbosity, AdvisorScope, SwarmSnapshot } from '@hudai/shared';

const severityBorderColors: Record<string, string> = {
  info: colors.accent.blue,
  warning: colors.status.warning,
  critical: colors.status.errorLight,
};

const notifTypeColors: Record<string, string> = {
  info: colors.accent.blue,
  warning: colors.status.warning,
  success: colors.status.successLight,
  error: colors.status.errorLight,
};

const notifTypeBg: Record<string, string> = {
  info: SEVERITY_BG.info,
  warning: SEVERITY_BG.warning,
  success: SEVERITY_BG.success,
  error: SEVERITY_BG.error,
};

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function PermissionBubble({ msg }: { msg: ChatMessage }) {
  const resolveMessage = useChatStore((s) => s.resolveMessage);
  const color = notifTypeColors.warning;
  const bg = notifTypeBg.warning;

  return (
    <div style={{ padding: '3px 10px' }}>
      <div style={{
        padding: '8px 12px',
        background: bg,
        borderLeft: `3px solid ${color}`,
        borderRadius: 4,
      }}>
        <span style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 1,
          color,
          display: 'block',
          marginBottom: 4,
          fontWeight: 600,
        }}>
          Approval needed
        </span>
        <div style={{
          fontSize: 13,
          fontFamily: fonts.mono,
          color: colors.text.secondary,
          padding: '4px 6px',
          background: colors.surface.dimmer,
          borderRadius: 3,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          lineHeight: 1.4,
          marginBottom: 6,
        }}>
          {msg.text}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => {
              wsClient.send({ kind: 'command', command: { type: 'approve' } });
              resolveMessage(msg.id);
            }}
            style={{
              flex: 1, height: 28, border: 'none', borderRadius: 4,
              background: colors.status.success, color: colors.text.white,
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Approve
          </button>
          <button
            onClick={() => {
              wsClient.send({ kind: 'command', command: { type: 'reject' } });
              resolveMessage(msg.id);
            }}
            style={{
              flex: 1, height: 28, border: 'none', borderRadius: 4,
              background: colors.status.error, color: colors.text.white,
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Reject
          </button>
        </div>
        <div style={{ fontSize: 10, color: colors.text.muted, marginTop: 4, textAlign: 'right' }}>
          {timeAgo(msg.timestamp)}
        </div>
      </div>
    </div>
  );
}

function QuestionBubble({ msg }: { msg: ChatMessage }) {
  const resolveMessage = useChatStore((s) => s.resolveMessage);
  const [otherText, setOtherText] = useState('');
  const color = notifTypeColors.warning;
  const bg = notifTypeBg.warning;

  const sendOption = (optionNumber: number) => {
    wsClient.send({ kind: 'command', command: { type: 'prompt', data: { text: String(optionNumber) } } });
    resolveMessage(msg.id);
  };

  const sendFreeText = () => {
    const text = otherText.trim();
    if (!text) return;
    wsClient.send({ kind: 'command', command: { type: 'prompt', data: { text } } });
    setOtherText('');
    resolveMessage(msg.id);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendFreeText();
    }
  };

  return (
    <div style={{ padding: '3px 10px' }}>
      <div style={{
        padding: '8px 12px',
        background: bg,
        borderLeft: `3px solid ${color}`,
        borderRadius: 4,
      }}>
        <span style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 1,
          color,
          display: 'block',
          marginBottom: 4,
          fontWeight: 600,
        }}>
          Question
        </span>
        <div style={{
          fontSize: 13,
          fontFamily: fonts.mono,
          color: colors.text.secondary,
          lineHeight: 1.4,
          marginBottom: 6,
        }}>
          {msg.text}
        </div>
        <>
          {msg.options && msg.options.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                {msg.options.map((option, idx) => (
                  <button
                    key={idx}
                    onClick={() => sendOption(idx + 1)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px',
                      background: colors.surface.base,
                      border: `1px solid ${colors.border.subtle}`,
                      borderRadius: 4,
                      color: colors.text.primary,
                      fontSize: 13, fontFamily: fonts.mono, cursor: 'pointer', textAlign: 'left',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = colors.surface.active;
                      e.currentTarget.style.borderColor = colors.accent.blue;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = colors.surface.base;
                      e.currentTarget.style.borderColor = colors.border.subtle;
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, color: colors.accent.blue, minWidth: 14, flexShrink: 0 }}>
                      {idx + 1}.
                    </span>
                    <span>{option}</span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: colors.text.muted, flexShrink: 0, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Other:
              </span>
              <input
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a custom response..."
                style={{
                  flex: 1, height: 24,
                  background: colors.surface.dimmer,
                  border: `1px solid ${colors.border.subtle}`,
                  borderRadius: 3,
                  color: colors.text.primary,
                  fontSize: 12, fontFamily: fonts.mono,
                  padding: '0 6px', outline: 'none',
                }}
              />
              <button
                onClick={sendFreeText}
                disabled={!otherText.trim()}
                style={{
                  padding: '4px 10px', border: 'none', borderRadius: 3,
                  background: otherText.trim() ? colors.accent.blue : colors.border.subtle,
                  color: colors.text.white, fontSize: 11, fontWeight: 600,
                  cursor: otherText.trim() ? 'pointer' : 'default',
                  opacity: otherText.trim() ? 1 : 0.5,
                }}
              >
                Send
              </button>
            </div>
          </>
        <div style={{ fontSize: 10, color: colors.text.muted, marginTop: 4, textAlign: 'right' }}>
          {timeAgo(msg.timestamp)}
        </div>
      </div>
    </div>
  );
}

function NotificationBubble({ msg }: { msg: ChatMessage }) {
  const nType = msg.notificationType || 'info';
  const color = notifTypeColors[nType] || colors.accent.blue;
  const bg = notifTypeBg[nType] || notifTypeBg.info;

  return (
    <div style={{ padding: '2px 10px' }}>
      <div style={{
        padding: '5px 10px',
        background: bg,
        borderTop: `1px solid ${color}40`,
        borderRadius: 3,
        fontSize: 12,
        fontFamily: fonts.mono,
        color: colors.text.secondary,
        lineHeight: 1.4,
      }}>
        {msg.text}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  // Permission prompt
  if (msg.actionable) {
    return <PermissionBubble msg={msg} />;
  }

  // Question prompt
  if (msg.respondable) {
    return <QuestionBubble msg={msg} />;
  }

  // System notification with type (test results, errors, etc.)
  if (msg.role === 'system' && msg.notificationType) {
    return <NotificationBubble msg={msg} />;
  }

  // Plain system message
  if (msg.role === 'system') {
    return (
      <div style={{
        textAlign: 'center',
        padding: '6px 12px',
        fontSize: 11,
        fontFamily: fonts.mono,
        color: colors.text.muted,
        fontStyle: 'italic',
      }}>
        {msg.text}
      </div>
    );
  }

  if (msg.role === 'user') {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        padding: '3px 10px',
      }}>
        <div style={{
          maxWidth: '85%',
          padding: '8px 12px',
          background: alpha(colors.accent.primary, 0.15),
          borderLeft: `3px solid ${colors.accent.blue}`,
          borderRadius: 4,
          fontSize: 13,
          fontFamily: fonts.mono,
          color: colors.text.primary,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {msg.text}
        </div>
      </div>
    );
  }

  // advisor
  const borderColor = msg.proactive && msg.severity
    ? severityBorderColors[msg.severity] || colors.action.think
    : colors.action.think;

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'flex-start',
      padding: '3px 10px',
    }}>
      <div style={{
        maxWidth: '90%',
        padding: '8px 12px',
        background: colors.surface.dimmest,
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: 4,
        fontSize: 13,
        fontFamily: fonts.mono,
        color: colors.text.primary,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {msg.proactive && (
          <span style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: borderColor,
            display: 'block',
            marginBottom: 4,
          }}>
            {msg.severity === 'critical' ? 'Alert' : msg.severity === 'warning' ? 'Warning' : 'Insight'}
          </span>
        )}
        {msg.text}
        <div style={{
          fontSize: 10,
          color: colors.text.muted,
          marginTop: 4,
          textAlign: 'right',
        }}>
          {timeAgo(msg.timestamp)}
        </div>
      </div>
    </div>
  );
}

const EXAMPLE_PROMPTS = [
  'What is the agent doing right now?',
  'What files were edited?',
  'Are there any test failures?',
];

const VERBOSITY_CYCLE: AdvisorVerbosity[] = ['quiet', 'normal', 'verbose'];
const VERBOSITY_COLORS: Record<AdvisorVerbosity, string> = {
  quiet: colors.status.errorLight,
  normal: '#e2b93d',
  verbose: colors.status.successLight,
};

function statusDotColor(session: SwarmSnapshot): string {
  if (session.status === 'error') return colors.status.errorLight;
  if (session.isAttached) return colors.accent.blueLight;
  if (session.status === 'running') return colors.status.successLight;
  return colors.text.muted; // idle / other
}

function SwarmChip({ session }: { session: SwarmSnapshot }) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startConfirm = () => {
    setConfirming(true);
    timerRef.current = setTimeout(() => setConfirming(false), 3000);
  };

  const cancelConfirm = () => {
    setConfirming(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const confirmKill = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setConfirming(false);
    wsClient.send({ kind: 'session.kill', tmuxTarget: session.projectPath });
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const s = session;

  if (confirming) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '1px 6px',
          fontSize: 10,
          fontFamily: fonts.mono,
          color: colors.status.errorLight,
          background: alpha(colors.status.errorLight, 0.08),
          borderRadius: 3,
          border: `1px solid ${colors.status.errorLight}`,
        }}
      >
        Kill?
        <button
          onClick={confirmKill}
          style={{
            background: 'none', border: 'none', color: colors.status.errorLight,
            fontSize: 10, fontFamily: fonts.mono, cursor: 'pointer', padding: '0 2px',
          }}
        >Yes</button>
        <button
          onClick={cancelConfirm}
          style={{
            background: 'none', border: 'none', color: colors.text.muted,
            fontSize: 10, fontFamily: fonts.mono, cursor: 'pointer', padding: '0 2px',
          }}
        >No</button>
      </span>
    );
  }

  return (
    <span
      title={`${s.projectPath} — ${s.status}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 6px',
        fontSize: 10,
        fontFamily: fonts.mono,
        color: colors.text.secondary,
        background: colors.surface.base,
        borderRadius: 3,
        border: `1px solid ${colors.border.subtle}`,
        transition: 'background 0.15s, border-color 0.15s',
        cursor: 'default',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = colors.surface.active; (e.currentTarget as HTMLElement).style.borderColor = colors.text.muted; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = colors.surface.base; (e.currentTarget as HTMLElement).style.borderColor = colors.border.subtle; }}
    >
      <span style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: statusDotColor(s),
        flexShrink: 0,
      }} />
      {s.projectName.length > 14 ? s.projectName.slice(0, 13) + '\u2026' : s.projectName}
      {s.isAttached && ' \u2605'}
      {!s.isAttached && (
        <button
          onClick={startConfirm}
          title="Kill session"
          style={{
            background: 'none', border: 'none', color: colors.text.muted,
            fontSize: 10, fontFamily: fonts.mono, cursor: 'pointer', padding: '0 1px',
            lineHeight: 1,
          }}
        >\u00d7</button>
      )}
    </span>
  );
}

function SwarmStrip({ sessions }: { sessions: SwarmSnapshot[] }) {
  if (sessions.length < 2) return null;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 4,
      padding: '4px 10px',
      borderBottom: `1px solid ${colors.border.subtle}`,
      flexShrink: 0,
    }}>
      {sessions.map((s) => (
        <SwarmChip key={s.sessionId} session={s} />
      ))}
    </div>
  );
}

export function CommanderChat() {
  const messages = useChatStore((s) => s.messages);
  const typing = useChatStore((s) => s.typing);
  const verbosity = useChatStore((s) => s.verbosity);
  const scope = useChatStore((s) => s.scope);
  const llmStatus = useSessionStore((s) => s.session.llmStatus);
  const swarmSessions = useSwarmStore((s) => s.sessions);
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const disabled = llmStatus === 'unavailable';

  const setVerbosity = (v: AdvisorVerbosity) => {
    wsClient.send({ kind: 'settings.advisor', verbosity: v });
  };

  const setScope = (s: AdvisorScope) => {
    wsClient.send({ kind: 'settings.advisorScope', scope: s });
  };

  // Poll swarm status when scope is global
  useEffect(() => {
    if (scope !== 'global') return;
    wsClient.send({ kind: 'swarm.status' });
    const interval = setInterval(() => {
      wsClient.send({ kind: 'swarm.status' });
    }, 30_000);
    return () => clearInterval(interval);
  }, [scope]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, typing, autoScroll]);

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  };

  const sendMessage = () => {
    const text = input.trim();
    if (!text || disabled) return;
    wsClient.send({ kind: 'chat.send', text });
    setInput('');
    setAutoScroll(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleExampleClick = (prompt: string) => {
    if (disabled) return;
    wsClient.send({ kind: 'chat.send', text: prompt });
    setAutoScroll(true);
  };

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Verbosity + Scope controls */}
      {!disabled && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderBottom: `1px solid ${colors.border.subtle}`,
          flexShrink: 0,
        }}>
          {/* Verbosity: single cycling button */}
          <button
            onClick={() => {
              const idx = VERBOSITY_CYCLE.indexOf(verbosity);
              const next = VERBOSITY_CYCLE[(idx + 1) % VERBOSITY_CYCLE.length];
              setVerbosity(next);
            }}
            title={`Proactive: ${verbosity} (click to cycle)`}
            style={{
              padding: '2px 8px',
              fontSize: 10,
              fontFamily: fonts.mono,
              fontWeight: 600,
              background: `${VERBOSITY_COLORS[verbosity]}15`,
              border: `1px solid ${VERBOSITY_COLORS[verbosity]}60`,
              borderRadius: 3,
              color: VERBOSITY_COLORS[verbosity],
              cursor: 'pointer',
              textTransform: 'lowercase',
            }}
          >
            {verbosity}
          </button>

          <span style={{ flex: 1 }} />

          {/* Scope: dropdown */}
          <Dropdown
            value={scope}
            options={[
              { value: 'session', label: 'session' },
              { value: 'global', label: 'global' },
            ]}
            onChange={(v) => setScope(v as AdvisorScope)}
          />
        </div>
      )}

      {/* Swarm status strip */}
      {!disabled && scope === 'global' && (
        <SwarmStrip sessions={swarmSessions} />
      )}

      {/* Message list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '8px 0',
        }}
      >
        {messages.length === 0 ? (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 20,
          }}>
            <div style={{
              fontSize: 13,
              color: colors.text.muted,
              textAlign: 'center',
              fontFamily: fonts.mono,
              lineHeight: 1.6,
            }}>
              {disabled
                ? 'Set GEMINI_API_KEY in .env to enable the advisor.'
                : 'Ask about the session...'}
            </div>
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
        )}

        {/* Typing indicator */}
        {typing && (
          <div style={{
            padding: '4px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
            <div style={{
              padding: '6px 12px',
              background: colors.surface.dimmer,
              borderLeft: `3px solid ${colors.action.think}`,
              borderRadius: 4,
              fontSize: 13,
              fontFamily: fonts.mono,
              color: colors.text.muted,
              animation: 'pulse 1.5s ease-in-out infinite',
            }}>
              ···
            </div>
          </div>
        )}
      </div>

      {/* Suggested question chips */}
      {!disabled && (
        <div style={{
          flexShrink: 0,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          padding: '4px 10px',
          borderTop: `1px solid ${colors.border.subtle}`,
        }}>
          <button
            onClick={() => wsClient.send({ kind: 'insight.requestSummary' })}
            style={{
              background: alpha(colors.action.think, 0.1),
              border: `1px solid ${colors.action.think}50`,
              borderRadius: 12,
              padding: '3px 10px',
              fontSize: 11,
              fontFamily: fonts.mono,
              color: colors.action.think,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontWeight: 600,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = alpha(colors.action.think, 0.2);
              e.currentTarget.style.borderColor = colors.action.think;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = alpha(colors.action.think, 0.1);
              e.currentTarget.style.borderColor = `${colors.action.think}50`;
            }}
          >
            Catch me up
          </button>
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => handleExampleClick(prompt)}
              style={{
                background: colors.surface.dimmer,
                border: `1px solid ${colors.border.subtle}`,
                borderRadius: 12,
                padding: '3px 10px',
                fontSize: 11,
                fontFamily: fonts.mono,
                color: colors.text.muted,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = alpha(colors.accent.primary, 0.1);
                e.currentTarget.style.borderColor = colors.accent.blue;
                e.currentTarget.style.color = colors.text.secondary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = colors.surface.dimmer;
                e.currentTarget.style.borderColor = colors.border.subtle;
                e.currentTarget.style.color = colors.text.muted;
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div style={{
        flexShrink: 0,
        borderTop: `1px solid ${colors.border.subtle}`,
        padding: '8px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{
          color: disabled ? colors.text.muted : colors.action.think,
          fontSize: 13,
          fontFamily: fonts.mono,
          flexShrink: 0,
        }}>
          &gt;
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={disabled ? 'Advisor unavailable' : 'Ask about the session...'}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: colors.text.primary,
            fontSize: 13,
            fontFamily: fonts.mono,
            opacity: disabled ? 0.4 : 1,
          }}
        />
        <button
          onClick={sendMessage}
          disabled={disabled || !input.trim()}
          style={{
            background: 'none',
            border: 'none',
            color: disabled || !input.trim() ? colors.text.muted : colors.accent.blue,
            fontSize: 14,
            fontFamily: fonts.mono,
            cursor: disabled || !input.trim() ? 'default' : 'pointer',
            padding: '2px 6px',
            flexShrink: 0,
          }}
        >
          ↵
        </button>
      </div>
    </div>
  );
}
