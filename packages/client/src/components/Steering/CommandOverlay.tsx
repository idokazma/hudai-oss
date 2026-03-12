import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { wsClient } from '../../ws/ws-client.js';
import { useSessionStore } from '../../stores/session-store.js';
import { useReplayStore } from '../../stores/replay-store.js';
import { colors, fonts } from '../../theme/tokens.js';

/**
 * Slash commands that map to tmux send-keys.
 * Each sends the literal text (including the /) into the terminal.
 */
const SLASH_COMMANDS = [
  { cmd: '/compact', label: 'Compact context', desc: 'Reduce context window usage' },
  { cmd: '/clear', label: 'Clear conversation', desc: 'Start fresh conversation' },
  { cmd: '/model', label: 'Switch model', desc: 'Change Claude model' },
  { cmd: '/cost', label: 'Show cost', desc: 'Display token usage and costs' },
  { cmd: '/doctor', label: 'Diagnostics', desc: 'Check Claude Code health' },
  { cmd: '/help', label: 'Help', desc: 'Show available commands' },
  { cmd: '/status', label: 'Status', desc: 'Show current status' },
  { cmd: '/config', label: 'Configuration', desc: 'View/edit configuration' },
] as const;

const sendCommand = (type: string, data?: Record<string, any>) => {
  wsClient.send({ kind: 'command', command: { type, ...data ? { data } : {} } as any });
};

const actionBtnStyle = (bg: string, active = true): React.CSSProperties => ({
  height: 30,
  padding: '0 12px',
  border: 'none',
  borderRadius: 5,
  background: active ? bg : colors.surface.hover,
  color: active ? '#fff' : colors.text.muted,
  fontSize: 12,
  fontWeight: 600,
  fontFamily: fonts.body,
  letterSpacing: 0.5,
  cursor: active ? 'pointer' : 'default',
  opacity: active ? 1 : 0.5,
  transition: 'opacity 0.15s, background 0.15s',
  whiteSpace: 'nowrap',
});

export function CommandOverlay() {
  const [input, setInput] = useState('');
  const [showSlash, setShowSlash] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const isReplay = useReplayStore((s) => s.mode) === 'replay';

  const session = useSessionStore((s) => s.session);
  const activity = session.agentActivity;
  const activityDetail = session.agentActivityDetail;
  const activityOptions = session.agentActivityOptions;

  // Filter slash commands
  const filteredSlash = SLASH_COMMANDS.filter((s) =>
    s.cmd.toLowerCase().includes(slashFilter.toLowerCase()) ||
    s.label.toLowerCase().includes(slashFilter.toLowerCase())
  );

  // Reset highlight when filter changes
  useEffect(() => { setHighlightIdx(0); }, [slashFilter]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || isReplay) return;

    // Send as prompt command (which becomes tmux send-keys on the server)
    sendCommand('prompt', { text });
    setInput('');
    setShowSlash(false);
  };

  const handleSlashSelect = (cmd: string) => {
    sendCommand('prompt', { text: cmd });
    setInput('');
    setShowSlash(false);
    setSlashFilter('');
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    if (value.startsWith('/')) {
      setShowSlash(true);
      setSlashFilter(value);
    } else {
      setShowSlash(false);
      setSlashFilter('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (showSlash && filteredSlash.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, filteredSlash.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && highlightIdx >= 0)) {
        e.preventDefault();
        handleSlashSelect(filteredSlash[highlightIdx].cmd);
        return;
      }
      if (e.key === 'Escape') {
        setShowSlash(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setInput('');
    }
  };

  if (isReplay) return null;

  const isWaitingPermission = activity === 'waiting_permission';
  const isWaitingAnswer = activity === 'waiting_answer';
  const isWaitingInput = activity === 'waiting_input';
  const isWorking = activity === 'working' || session.status === 'running';

  return (
    <div style={{
      flexShrink: 0,
      borderTop: `1px solid ${colors.border.medium}`,
      background: colors.bg.secondary,
      position: 'relative',
    }}>
      {/* Slash command palette */}
      {showSlash && filteredSlash.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          right: 0,
          maxHeight: 240,
          overflowY: 'auto',
          background: colors.bg.panel,
          borderTop: `1px solid ${colors.border.medium}`,
          borderLeft: `1px solid ${colors.border.medium}`,
          borderRight: `1px solid ${colors.border.medium}`,
          borderRadius: '6px 6px 0 0',
          boxShadow: '0 -4px 16px rgba(0,0,0,0.3)',
        }}>
          {filteredSlash.map((item, i) => (
            <button
              key={item.cmd}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSlashSelect(item.cmd);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                padding: '8px 14px',
                background: i === highlightIdx ? colors.surface.hover : 'transparent',
                border: 'none',
                color: colors.text.primary,
                fontSize: 13,
                fontFamily: fonts.mono,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ color: colors.accent.primary, fontWeight: 600, minWidth: 80 }}>
                {item.cmd}
              </span>
              <span style={{ color: colors.text.muted, fontSize: 12 }}>
                {item.desc}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Main input row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
      }}>
        {/* Quick actions */}
        {isWorking && (
          <button
            onClick={() => sendCommand('pause')}
            title="Pause agent (Ctrl+C)"
            style={actionBtnStyle(colors.status.warning)}
          >
            Pause
          </button>
        )}
        {session.status === 'paused' && (
          <button
            onClick={() => sendCommand('resume')}
            style={actionBtnStyle(colors.accent.primary)}
          >
            Resume
          </button>
        )}

        {/* Text input */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          background: colors.bg.primary,
          border: `1px solid ${colors.border.subtle}`,
          borderRadius: 6,
          padding: '0 10px',
          transition: 'border-color 0.15s',
        }}>
          <span style={{
            color: isWaitingInput ? colors.accent.primary : colors.text.muted,
            fontFamily: fonts.mono,
            fontSize: 13,
            marginRight: 6,
            userSelect: 'none',
          }}>
            {isWaitingInput ? '>' : '/'}
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={(e) => { e.currentTarget.parentElement!.style.borderColor = colors.accent.primary; }}
            onBlur={(e) => {
              e.currentTarget.parentElement!.style.borderColor = colors.border.subtle;
              // Delay to allow clicking slash items
              setTimeout(() => setShowSlash(false), 200);
            }}
            placeholder={
              isWaitingInput ? 'Send next instruction...'
              : isWaitingPermission ? 'Or type a response...'
              : isWaitingAnswer ? 'Or type your answer...'
              : 'Type a message or / for commands...'
            }
            style={{
              flex: 1,
              height: 30,
              background: 'transparent',
              border: 'none',
              color: colors.text.primary,
              fontSize: 13,
              fontFamily: fonts.mono,
              outline: 'none',
            }}
          />
          {input.trim() && (
            <button
              onClick={handleSubmit}
              style={{
                background: 'none',
                border: 'none',
                color: colors.accent.primary,
                fontSize: 14,
                cursor: 'pointer',
                padding: '0 4px',
                fontFamily: fonts.mono,
              }}
            >
              Enter
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
