import { useEffect, useState } from 'react';
import { wsClient } from '../../ws/ws-client.js';
import { usePanesStore } from '../../stores/panes-store.js';
import { colors, fonts } from '../../theme/tokens.js';
import { SettingsModal } from '../SettingsModal.js';

export function PaneSelector() {
  const panes = usePanesStore((s) => s.panes);
  const [showCreate, setShowCreate] = useState(false);
  const [projectPath, setProjectPath] = useState('');
  const [prompt, setPrompt] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    // Request pane list on mount
    wsClient.send({ kind: 'panes.list' });
    // Refresh every 3 seconds
    const interval = setInterval(() => {
      wsClient.send({ kind: 'panes.list' });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleAttach = (paneId: string) => {
    wsClient.send({ kind: 'session.attach', tmuxTarget: paneId });
  };

  const handleRefresh = () => {
    wsClient.send({ kind: 'panes.list' });
  };

  const handleCreate = () => {
    if (!projectPath.trim()) return;
    setCreating(true);
    wsClient.send({
      kind: 'session.create',
      projectPath: projectPath.trim(),
      ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
      ...(sessionName.trim() ? { sessionName: sessionName.trim() } : {}),
    });
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: 24,
    }}>
      {/* Create New Agent section */}
      <button
        onClick={() => setShowCreate(!showCreate)}
        style={{
          padding: '12px 28px',
          background: showCreate ? colors.surface.hover : colors.accent.blue,
          border: `1px solid ${colors.accent.blue}`,
          borderRadius: 8,
          color: colors.text.primary,
          fontFamily: fonts.body,
          fontSize: 14,
          cursor: 'pointer',
          letterSpacing: 1,
          textTransform: 'uppercase',
          transition: 'background 0.2s',
        }}
      >
        {showCreate ? 'Cancel' : 'Create New Agent'}
      </button>

      {showCreate && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          maxWidth: 500,
          width: '100%',
          padding: '16px 20px',
          background: colors.bg.secondary,
          borderRadius: 8,
          border: `1px solid ${colors.border.medium}`,
        }}>
          <label style={{ color: colors.text.secondary, fontSize: 12, letterSpacing: 0.5 }}>
            PROJECT PATH
          </label>
          <input
            type="text"
            placeholder="/home/user/my-project"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            style={{
              padding: '10px 12px',
              background: colors.bg.primary,
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: 6,
              color: colors.text.primary,
              fontFamily: fonts.mono,
              fontSize: 13,
              outline: 'none',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = colors.accent.blue; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = colors.border.subtle; }}
          />

          <label style={{ color: colors.text.secondary, fontSize: 12, letterSpacing: 0.5 }}>
            SESSION NAME (optional)
          </label>
          <input
            type="text"
            placeholder="e.g. my-feature-agent"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            style={{
              padding: '10px 12px',
              background: colors.bg.primary,
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: 6,
              color: colors.text.primary,
              fontFamily: fonts.mono,
              fontSize: 13,
              outline: 'none',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = colors.accent.blue; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = colors.border.subtle; }}
          />

          <label style={{ color: colors.text.secondary, fontSize: 12, letterSpacing: 0.5 }}>
            INITIAL PROMPT (optional)
          </label>
          <input
            type="text"
            placeholder="e.g. Fix the failing tests in src/utils"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            style={{
              padding: '10px 12px',
              background: colors.bg.primary,
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: 6,
              color: colors.text.primary,
              fontFamily: fonts.mono,
              fontSize: 13,
              outline: 'none',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = colors.accent.blue; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = colors.border.subtle; }}
          />

          <button
            onClick={handleCreate}
            disabled={!projectPath.trim() || creating}
            style={{
              padding: '10px 16px',
              background: !projectPath.trim() || creating ? colors.surface.hover : colors.accent.blue,
              border: 'none',
              borderRadius: 6,
              color: colors.text.primary,
              fontFamily: fonts.body,
              fontSize: 13,
              cursor: !projectPath.trim() || creating ? 'not-allowed' : 'pointer',
              letterSpacing: 0.5,
              opacity: !projectPath.trim() || creating ? 0.5 : 1,
              transition: 'opacity 0.2s, background 0.2s',
            }}
          >
            {creating ? 'Starting Claude...' : 'Launch Agent'}
          </button>
        </div>
      )}

      {/* Divider */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        maxWidth: 500,
      }}>
        <div style={{ flex: 1, height: 1, background: colors.border.subtle }} />
        <span style={{ color: colors.text.muted, fontSize: 13, letterSpacing: 1 }}>OR ATTACH TO EXISTING</span>
        <div style={{ flex: 1, height: 1, background: colors.border.subtle }} />
      </div>

      <div style={{
        fontSize: 12,
        color: colors.text.muted,
        marginBottom: 8,
      }}>
        Select a running tmux pane to monitor
      </div>

      {panes.length === 0 ? (
        <div style={{
          color: colors.text.muted,
          fontSize: 13,
          padding: '20px 24px',
          background: colors.bg.secondary,
          borderRadius: 8,
          border: `1px solid ${colors.border.subtle}`,
        }}>
          No tmux panes found. Start tmux first: <code style={{ color: colors.accent.blue }}>tmux new -s claude</code>
        </div>
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxWidth: 500,
          width: '100%',
        }}>
          {panes.map((pane) => (
            <button
              key={pane.id}
              onClick={() => handleAttach(pane.id)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                background: colors.bg.secondary,
                border: `1px solid ${colors.border.subtle}`,
                borderRadius: 8,
                color: colors.text.primary,
                fontFamily: fonts.mono,
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color 0.2s, background 0.2s',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = colors.accent.blue;
                e.currentTarget.style.background = colors.surface.hover;
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = colors.border.subtle;
                e.currentTarget.style.background = colors.bg.secondary;
              }}
            >
              <span style={{ color: colors.accent.blueLight }}>{pane.id}</span>
              <span style={{ color: colors.text.muted, fontSize: 13 }}>{pane.command}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          onClick={handleRefresh}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: 6,
            color: colors.text.muted,
            fontSize: 13,
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          Refresh
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: 6,
            color: colors.text.muted,
            fontSize: 13,
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          ⚙ Settings
        </button>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
