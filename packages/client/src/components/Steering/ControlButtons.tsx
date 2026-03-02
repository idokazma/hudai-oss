import { wsClient } from '../../ws/ws-client.js';
import { useSessionStore } from '../../stores/session-store.js';
import { colors } from '../../theme/tokens.js';

const btnStyle = (bg: string): React.CSSProperties => ({
  height: 36,
  padding: '0 14px',
  border: 'none',
  borderRadius: 6,
  background: bg,
  color: colors.text.white,
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  cursor: 'pointer',
  opacity: 0.9,
});

export function ControlButtons() {
  const status = useSessionStore((s) => s.session.status);

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {/* Approve / Reject for permission prompts */}
      <button
        onClick={() => wsClient.send({ kind: 'command', command: { type: 'approve' } })}
        style={btnStyle(colors.status.success)}
      >
        Approve
      </button>
      <button
        onClick={() => wsClient.send({ kind: 'command', command: { type: 'reject' } })}
        style={btnStyle(colors.status.error)}
      >
        Reject
      </button>

      {status === 'running' && (
        <button
          onClick={() => wsClient.send({ kind: 'command', command: { type: 'pause' } })}
          style={btnStyle(colors.status.warning)}
        >
          Pause
        </button>
      )}
      {status === 'paused' && (
        <button
          onClick={() => wsClient.send({ kind: 'command', command: { type: 'resume' } })}
          style={btnStyle(colors.accent.blue)}
        >
          Resume
        </button>
      )}
      <button
        onClick={() => wsClient.send({ kind: 'session.detach' })}
        style={btnStyle(colors.text.muted)}
      >
        Detach
      </button>
      <button
        onClick={() => wsClient.send({ kind: 'command', command: { type: 'clear' } })}
        style={btnStyle(colors.text.muted)}
      >
        Clear
      </button>
    </div>
  );
}
