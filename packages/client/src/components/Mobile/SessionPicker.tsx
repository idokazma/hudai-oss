import { useEffect, useState } from 'react';
import { usePanesStore } from '../../stores/panes-store.js';
import { wsClient } from '../../ws/ws-client.js';
import { colors, fonts, alpha } from '../../theme/tokens.js';

export function SessionPicker() {
  const panes = usePanesStore((s) => s.panes);
  const [showCreate, setShowCreate] = useState(false);
  const [projectPath, setProjectPath] = useState('');
  const [label, setLabel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    wsClient.send({ kind: 'panes.list' });
    const interval = setInterval(() => wsClient.send({ kind: 'panes.list' }), 3000);
    return () => clearInterval(interval);
  }, []);

  const handleAttach = (paneId: string) => {
    wsClient.send({ kind: 'session.attach', tmuxTarget: paneId });
  };

  const handleCreate = () => {
    if (!projectPath.trim() || !label.trim()) return;
    setCreating(true);
    wsClient.send({
      kind: 'agent.start',
      projectPath: projectPath.trim(),
      label: label.trim(),
      ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
    });
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        gap: 20,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* Title */}
      <div
        style={{
          fontSize: 20,
          fontFamily: fonts.display,
          fontWeight: 700,
          color: colors.text.primary,
          letterSpacing: '0.06em',
        }}
      >
        HUDAI
      </div>
      <div
        style={{
          fontSize: 13,
          fontFamily: fonts.body,
          color: colors.text.muted,
          textAlign: 'center',
        }}
      >
        Connect to a running agent session
      </div>

      {/* Pane list */}
      {panes.length > 0 ? (
        <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {panes.map((pane) => (
            <button
              key={pane.id}
              onClick={() => handleAttach(pane.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '14px 16px',
                background: colors.bg.card,
                border: `1px solid ${colors.border.subtle}`,
                borderRadius: 10,
                color: colors.text.primary,
                fontFamily: fonts.mono,
                fontSize: 14,
                cursor: 'pointer',
                textAlign: 'left',
                minHeight: 56,
              }}
            >
              <span style={{ color: colors.accent.light, fontWeight: 600 }}>{pane.id}</span>
              <span style={{ color: colors.text.dimmed, fontSize: 12 }}>{pane.command}</span>
            </button>
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: '20px',
            background: colors.bg.card,
            borderRadius: 10,
            border: `1px solid ${colors.border.subtle}`,
            fontSize: 13,
            fontFamily: fonts.mono,
            color: colors.text.muted,
            textAlign: 'center',
            width: '100%',
            maxWidth: 400,
          }}
        >
          No tmux panes found.
          <br />
          <span style={{ color: colors.accent.light }}>tmux new -s claude</span>
        </div>
      )}

      {/* Divider */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          maxWidth: 400,
        }}
      >
        <div style={{ flex: 1, height: 1, background: colors.border.subtle }} />
        <span style={{ color: colors.text.dimmed, fontSize: 11, letterSpacing: '0.06em' }}>
          OR CREATE NEW
        </span>
        <div style={{ flex: 1, height: 1, background: colors.border.subtle }} />
      </div>

      {/* Create form */}
      {!showCreate ? (
        <button
          onClick={() => setShowCreate(true)}
          style={{
            width: '100%',
            maxWidth: 400,
            padding: '14px',
            borderRadius: 10,
            border: `1px solid ${alpha(colors.accent.primary, 0.3)}`,
            background: alpha(colors.accent.primary, 0.08),
            color: colors.accent.primary,
            fontSize: 15,
            fontFamily: fonts.body,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Launch New Agent
        </button>
      ) : (
        <div
          style={{
            width: '100%',
            maxWidth: 400,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <input
            type="text"
            placeholder="/path/to/project"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            style={{
              height: 44,
              padding: '0 14px',
              background: colors.surface.dimmer,
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: 8,
              color: colors.text.primary,
              fontSize: 14,
              fontFamily: fonts.mono,
              outline: 'none',
            }}
          />
          <input
            type="text"
            placeholder="Session label (required)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={{
              height: 44,
              padding: '0 14px',
              background: colors.surface.dimmer,
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: 8,
              color: colors.text.primary,
              fontSize: 14,
              fontFamily: fonts.mono,
              outline: 'none',
            }}
          />
          <input
            type="text"
            placeholder="Initial prompt (optional)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            style={{
              height: 44,
              padding: '0 14px',
              background: colors.surface.dimmer,
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: 8,
              color: colors.text.primary,
              fontSize: 14,
              fontFamily: fonts.mono,
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setShowCreate(false)}
              style={{
                flex: 1,
                height: 44,
                borderRadius: 8,
                border: `1px solid ${colors.border.subtle}`,
                background: 'transparent',
                color: colors.text.muted,
                fontSize: 14,
                fontFamily: fonts.body,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!projectPath.trim() || !label.trim() || creating}
              style={{
                flex: 1,
                height: 44,
                borderRadius: 8,
                border: 'none',
                background: projectPath.trim() && label.trim() && !creating ? colors.accent.primary : colors.surface.dimmer,
                color: colors.text.white,
                fontSize: 14,
                fontFamily: fonts.body,
                fontWeight: 600,
                cursor: projectPath.trim() && label.trim() && !creating ? 'pointer' : 'default',
                opacity: projectPath.trim() && label.trim() && !creating ? 1 : 0.4,
              }}
            >
              {creating ? 'Starting...' : 'Launch'}
            </button>
          </div>
        </div>
      )}

      {/* Refresh */}
      <button
        onClick={() => wsClient.send({ kind: 'panes.list' })}
        style={{
          padding: '8px 16px',
          background: 'transparent',
          border: `1px solid ${colors.border.subtle}`,
          borderRadius: 8,
          color: colors.text.dimmed,
          fontSize: 12,
          fontFamily: fonts.body,
          cursor: 'pointer',
        }}
      >
        Refresh
      </button>
    </div>
  );
}
