import { useSessionStore } from '../../../stores/session-store.js';
import { useConfigStore } from '../../../stores/config-store.js';
import { wsClient } from '../../../ws/ws-client.js';
import { colors, fonts, alpha } from '../../../theme/tokens.js';

function SteeringButtons() {
  const status = useSessionStore((s) => s.session.status);
  const agentActivity = useSessionStore((s) => s.session.agentActivity);

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isWaiting = agentActivity === 'waiting_permission';

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
        Steering
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Pause / Resume */}
        {isRunning && !isPaused && (
          <button
            onClick={() => wsClient.send({ kind: 'command', command: { type: 'pause' } })}
            style={{
              height: 52,
              border: `1px solid ${alpha(colors.status.warning, 0.3)}`,
              borderRadius: 10,
              background: alpha(colors.status.warning, 0.08),
              color: colors.status.warning,
              fontSize: 16,
              fontFamily: fonts.body,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            ⏸ Pause
          </button>
        )}
        {isPaused && (
          <button
            onClick={() => wsClient.send({ kind: 'command', command: { type: 'resume' } })}
            style={{
              height: 52,
              border: `1px solid ${alpha(colors.status.successLight, 0.3)}`,
              borderRadius: 10,
              background: alpha(colors.status.successLight, 0.08),
              color: colors.status.successLight,
              fontSize: 16,
              fontFamily: fonts.body,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            ▶ Resume
          </button>
        )}

        {/* Cancel */}
        {isRunning && (
          <button
            onClick={() => wsClient.send({ kind: 'command', command: { type: 'cancel' } })}
            style={{
              height: 52,
              border: `1px solid ${alpha(colors.status.errorLight, 0.3)}`,
              borderRadius: 10,
              background: alpha(colors.status.errorLight, 0.08),
              color: colors.status.errorLight,
              fontSize: 16,
              fontFamily: fonts.body,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            ✕ Cancel
          </button>
        )}

        {/* Approve / Reject */}
        {isWaiting && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => wsClient.send({ kind: 'command', command: { type: 'approve' } })}
              style={{
                flex: 1,
                height: 52,
                border: 'none',
                borderRadius: 10,
                background: colors.status.success,
                color: colors.text.white,
                fontSize: 16,
                fontFamily: fonts.body,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ✓ Approve
            </button>
            <button
              onClick={() => wsClient.send({ kind: 'command', command: { type: 'reject' } })}
              style={{
                flex: 1,
                height: 52,
                border: 'none',
                borderRadius: 10,
                background: colors.status.error,
                color: colors.text.white,
                fontSize: 16,
                fontFamily: fonts.body,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ✕ Reject
            </button>
          </div>
        )}

        {!isRunning && !isPaused && (
          <div
            style={{
              padding: '16px',
              textAlign: 'center',
              fontSize: 13,
              fontFamily: fonts.mono,
              color: colors.text.dimmed,
            }}
          >
            Agent is {status}
          </div>
        )}
      </div>
    </div>
  );
}

function PermissionToggles() {
  const config = useConfigStore((s) => s.config);
  const suggestions = useConfigStore((s) => s.suggestions);

  if (!config && suggestions.length === 0) return null;

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
        Permission Policies
      </div>

      {suggestions.map((s) => (
        <div
          key={s.tool}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 0',
            borderBottom: `1px solid ${colors.border.subtle}`,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 14,
                fontFamily: fonts.mono,
                color: colors.text.primary,
              }}
            >
              {s.tool}
            </div>
            <div
              style={{
                fontSize: 11,
                fontFamily: fonts.body,
                color: colors.text.dimmed,
                marginTop: 2,
              }}
            >
              Auto-approve this tool
            </div>
          </div>
          <button
            onClick={() =>
              wsClient.send({ kind: 'permission.toggle', tool: s.tool, type: 'allow', enabled: true })
            }
            style={{
              width: 48,
              height: 28,
              borderRadius: 14,
              border: 'none',
              background: colors.surface.active,
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: colors.text.muted,
                position: 'absolute',
                top: 3,
                left: 3,
                transition: 'transform 0.2s',
              }}
            />
          </button>
        </div>
      ))}
    </div>
  );
}

function QuickTemplates() {
  const templates = [
    { label: 'Continue', text: 'continue' },
    { label: 'Run tests', text: 'run the tests' },
    { label: 'Explain', text: 'explain what you just did' },
    { label: 'Summarize', text: 'summarize all changes' },
    { label: 'Commit', text: 'commit your changes' },
  ];

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
        Quick Prompts
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {/* Catch me up — advisor */}
        <button
          onClick={() => wsClient.send({ kind: 'insight.requestSummary' })}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: `1px solid ${alpha(colors.action.think, 0.3)}`,
            background: alpha(colors.action.think, 0.08),
            color: colors.action.think,
            fontSize: 14,
            fontFamily: fonts.body,
            fontWeight: 600,
            cursor: 'pointer',
            minHeight: 44,
          }}
        >
          Catch me up
        </button>

        {templates.map((t) => (
          <button
            key={t.label}
            onClick={() =>
              wsClient.send({ kind: 'command', command: { type: 'prompt', data: { text: t.text } } })
            }
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: `1px solid ${colors.border.subtle}`,
              background: colors.surface.base,
              color: colors.text.secondary,
              fontSize: 14,
              fontFamily: fonts.body,
              cursor: 'pointer',
              minHeight: 44,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ControlsTab() {
  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        paddingTop: 20,
        paddingBottom: 20,
      }}
    >
      <SteeringButtons />
      <PermissionToggles />
      <QuickTemplates />
    </div>
  );
}
