import { useEffect, useState, useRef, useCallback } from 'react';
import { wsClient } from '../../ws/ws-client.js';
import { usePanesStore } from '../../stores/panes-store.js';
import { colors, fonts } from '../../theme/tokens.js';
import { SettingsModal } from '../SettingsModal.js';

interface PathSuggestion {
  path: string;
  name: string;
  isDirectory: boolean;
  isGitRepo?: boolean;
}

function usePathAutocomplete(value: string) {
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!value.trim()) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/fs/complete?path=${encodeURIComponent(value)}`);
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      } catch {
        setSuggestions([]);
      }
      setLoading(false);
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value]);

  return { suggestions, loading };
}

function useRecentProjects() {
  const [projects, setProjects] = useState<PathSuggestion[]>([]);

  useEffect(() => {
    fetch('/api/fs/projects')
      .then((r) => r.json())
      .then((data) => setProjects(data.projects || []))
      .catch(() => {});
  }, []);

  return projects;
}

const inputStyle = {
  padding: '10px 12px',
  background: colors.bg.primary,
  border: `1px solid ${colors.border.subtle}`,
  borderRadius: 6,
  color: colors.text.primary,
  fontFamily: fonts.mono,
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box' as const,
};

const labelStyle = {
  color: colors.text.secondary,
  fontSize: 12,
  letterSpacing: 0.5,
};

export function PaneSelector() {
  const panes = usePanesStore((s) => s.panes);
  const [showCreate, setShowCreate] = useState(false);
  const [projectPath, setProjectPath] = useState('');
  const [prompt, setPrompt] = useState('');
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const { suggestions, loading } = usePathAutocomplete(projectPath);
  const recentProjects = useRecentProjects();

  useEffect(() => {
    wsClient.send({ kind: 'panes.list' });
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

  const handleLaunchDirect = () => {
    if (!projectPath.trim() || !label.trim()) return;
    setCreating(true);
    wsClient.send({
      kind: 'agent.start',
      projectPath: projectPath.trim(),
      label: label.trim(),
      ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
    });
  };

  const handleLaunchTmux = () => {
    if (!projectPath.trim()) return;
    setCreating(true);
    wsClient.send({
      kind: 'session.create',
      projectPath: projectPath.trim(),
      ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
      ...(label.trim() ? { sessionName: label.trim() } : {}),
    });
  };

  const selectSuggestion = useCallback((suggestion: PathSuggestion) => {
    const newPath = suggestion.isDirectory ? suggestion.path + '/' : suggestion.path;
    setProjectPath(newPath);
    setShowSuggestions(false);
    setHighlightIdx(-1);
  }, []);

  const handlePathKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Tab') {
        e.preventDefault();
        setShowSuggestions(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (highlightIdx >= 0 && highlightIdx < suggestions.length) {
        e.preventDefault();
        selectSuggestion(suggestions[highlightIdx]);
      } else if (suggestions.length === 1) {
        e.preventDefault();
        selectSuggestion(suggestions[0]);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const canLaunchTmux = !!projectPath.trim() && !creating;
  const canLaunchDirect = !!projectPath.trim() && !!label.trim() && !creating;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: 24,
      overflowY: 'auto',
      padding: '24px 0',
    }}>
      {/* Launch New Agent */}
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
        {showCreate ? 'Cancel' : 'Launch New Agent'}
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
          {/* Recent Projects */}
          {recentProjects.length > 0 && !projectPath.trim() && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ ...labelStyle, marginBottom: 8 }}>RECENT PROJECTS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {recentProjects.slice(0, 5).map((p) => (
                  <button
                    key={p.path}
                    onClick={() => setProjectPath(p.path)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      background: 'transparent',
                      border: `1px solid ${colors.border.subtle}`,
                      borderRadius: 6,
                      color: colors.text.primary,
                      fontFamily: fonts.mono,
                      fontSize: 12,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.15s',
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.background = colors.surface.hover; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ color: p.isGitRepo ? colors.status.successLight : colors.text.muted, flexShrink: 0 }}>
                      {p.isGitRepo ? 'git' : 'dir'}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.path}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Project Path with autocomplete */}
          <label style={labelStyle}>PROJECT FOLDER</label>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Start typing a path or use Tab to autocomplete..."
              value={projectPath}
              onChange={(e) => {
                setProjectPath(e.target.value);
                setShowSuggestions(true);
                setHighlightIdx(-1);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => {
                // Delay to allow clicking a suggestion
                setTimeout(() => setShowSuggestions(false), 200);
              }}
              onKeyDown={handlePathKeyDown}
              style={{
                ...inputStyle,
                borderColor: showSuggestions && suggestions.length > 0 ? colors.accent.blue : colors.border.subtle,
              }}
            />
            {loading && (
              <span style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: colors.text.muted,
                fontSize: 11,
              }}>
                ...
              </span>
            )}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  maxHeight: 200,
                  overflowY: 'auto',
                  background: colors.bg.primary,
                  border: `1px solid ${colors.border.medium}`,
                  borderRadius: '0 0 6px 6px',
                  zIndex: 10,
                }}
              >
                {suggestions.map((s, i) => (
                  <button
                    key={s.path}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSuggestion(s);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '8px 12px',
                      background: i === highlightIdx ? colors.surface.hover : 'transparent',
                      border: 'none',
                      color: colors.text.primary,
                      fontFamily: fonts.mono,
                      fontSize: 12,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{
                      color: s.isGitRepo ? colors.status.successLight : colors.text.muted,
                      fontSize: 11,
                      flexShrink: 0,
                      width: 24,
                    }}>
                      {s.isGitRepo ? 'git' : 'dir'}
                    </span>
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Label (required for headless, optional for tmux) */}
          <label style={labelStyle}>SESSION LABEL <span style={{ color: colors.text.muted }}>(required for headless)</span></label>
          <input
            type="text"
            placeholder="e.g. fix-auth-bug, add-search-feature"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={inputStyle}
            onFocus={(e) => { e.currentTarget.style.borderColor = colors.accent.blue; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = colors.border.subtle; }}
          />

          {/* Initial Prompt */}
          <label style={labelStyle}>INITIAL PROMPT (optional)</label>
          <input
            type="text"
            placeholder="e.g. Fix the failing tests in src/utils"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canLaunchTmux) handleLaunchTmux(); }}
            style={inputStyle}
            onFocus={(e) => { e.currentTarget.style.borderColor = colors.accent.blue; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = colors.border.subtle; }}
          />

          {/* Launch buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={handleLaunchTmux}
              disabled={!canLaunchTmux}
              style={{
                flex: 1,
                padding: '10px 16px',
                background: canLaunchTmux ? colors.accent.blue : colors.surface.hover,
                border: 'none',
                borderRadius: 6,
                color: colors.text.primary,
                fontFamily: fonts.body,
                fontSize: 13,
                cursor: canLaunchTmux ? 'pointer' : 'not-allowed',
                letterSpacing: 0.5,
                opacity: canLaunchTmux ? 1 : 0.5,
                transition: 'opacity 0.2s, background 0.2s',
              }}
            >
              {creating ? 'Starting...' : 'Launch Agent'}
            </button>
            <button
              onClick={handleLaunchDirect}
              disabled={!canLaunchDirect}
              title="Headless mode — no terminal UI, structured output only (requires label)"
              style={{
                padding: '10px 16px',
                background: 'transparent',
                border: `1px solid ${colors.border.subtle}`,
                borderRadius: 6,
                color: colors.text.muted,
                fontFamily: fonts.body,
                fontSize: 13,
                cursor: canLaunchDirect ? 'pointer' : 'not-allowed',
                letterSpacing: 0.5,
                opacity: canLaunchDirect ? 1 : 0.5,
                transition: 'opacity 0.2s',
              }}
            >
              Headless
            </button>
          </div>
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
          Settings
        </button>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
