import { useState, useEffect, useRef, useCallback } from 'react';
import { wsClient } from '../../ws/ws-client.js';
import { colors, fonts } from '../../theme/tokens.js';

interface PathSuggestion {
  path: string;
  name: string;
  isDirectory: boolean;
  isGitRepo?: boolean;
}

function usePathAutocomplete(value: string) {
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!value.trim()) { setSuggestions([]); return; }
      try {
        const res = await fetch(`/api/fs/complete?path=${encodeURIComponent(value)}`);
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      } catch { setSuggestions([]); }
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value]);

  return suggestions;
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

export function SpawnModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [projectPath, setProjectPath] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const backdropRef = useRef<HTMLDivElement>(null);

  const suggestions = usePathAutocomplete(projectPath);
  const recentProjects = useRecentProjects();

  // Reset on open
  useEffect(() => {
    if (open) {
      setProjectPath('');
      setSessionName('');
      setCreating(false);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const selectSuggestion = useCallback((s: PathSuggestion) => {
    setProjectPath(s.isDirectory ? s.path + '/' : s.path);
    setShowSuggestions(false);
    setHighlightIdx(-1);
  }, []);

  const handlePathKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Tab') { e.preventDefault(); setShowSuggestions(true); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Tab' || e.key === 'Enter') {
      if (highlightIdx >= 0) { e.preventDefault(); selectSuggestion(suggestions[highlightIdx]); }
      else if (suggestions.length === 1) { e.preventDefault(); selectSuggestion(suggestions[0]); }
    }
    else if (e.key === 'Escape') setShowSuggestions(false);
  };

  const handleLaunch = () => {
    if (!projectPath.trim() || creating) return;
    setCreating(true);
    wsClient.send({
      kind: 'session.create',
      projectPath: projectPath.trim(),
      ...(sessionName.trim() ? { sessionName: sessionName.trim() } : {}),
    });
    setTimeout(() => onClose(), 500);
  };

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    padding: '8px 10px',
    background: colors.bg.primary,
    border: `1px solid ${colors.border.subtle}`,
    borderRadius: 6,
    color: colors.text.primary,
    fontFamily: fonts.mono,
    fontSize: 12,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{
        width: 420,
        background: colors.bg.panel,
        border: `1px solid ${colors.border.medium}`,
        borderRadius: 10,
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{
            fontSize: 14,
            fontFamily: fonts.display,
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: colors.text.primary,
          }}>
            Launch Agent
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text.muted,
              fontSize: 18,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Recent projects */}
        {recentProjects.length > 0 && !projectPath.trim() && (
          <div>
            <div style={{ fontSize: 10, color: colors.text.muted, letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' }}>
              Recent Projects
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {recentProjects.slice(0, 4).map((p) => (
                <button
                  key={p.path}
                  onClick={() => setProjectPath(p.path)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    background: 'transparent',
                    border: `1px solid ${colors.border.subtle}`,
                    borderRadius: 4,
                    color: colors.text.primary,
                    fontFamily: fonts.mono,
                    fontSize: 11,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = colors.surface.hover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ color: p.isGitRepo ? colors.status.successLight : colors.text.muted, flexShrink: 0, fontSize: 10 }}>
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

        {/* Project path */}
        <div>
          <div style={{ fontSize: 10, color: colors.text.muted, letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' }}>
            Project Folder
          </div>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Type a path or Tab to autocomplete..."
              value={projectPath}
              autoFocus
              onChange={(e) => { setProjectPath(e.target.value); setShowSuggestions(true); setHighlightIdx(-1); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              onKeyDown={handlePathKeyDown}
              style={{
                ...inputStyle,
                borderColor: showSuggestions && suggestions.length > 0 ? colors.accent.blue : colors.border.subtle,
              }}
            />
            {showSuggestions && suggestions.length > 0 && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                maxHeight: 160,
                overflowY: 'auto',
                background: colors.bg.primary,
                border: `1px solid ${colors.border.medium}`,
                borderRadius: '0 0 6px 6px',
                zIndex: 10,
              }}>
                {suggestions.map((s, i) => (
                  <button
                    key={s.path}
                    onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '6px 10px',
                      background: i === highlightIdx ? colors.surface.hover : 'transparent',
                      border: 'none',
                      color: colors.text.primary,
                      fontFamily: fonts.mono,
                      fontSize: 11,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ color: s.isGitRepo ? colors.status.successLight : colors.text.muted, fontSize: 10, width: 20, flexShrink: 0 }}>
                      {s.isGitRepo ? 'git' : 'dir'}
                    </span>
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Session name */}
        <div>
          <div style={{ fontSize: 10, color: colors.text.muted, letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' }}>
            Session Name <span style={{ color: colors.text.dimmed }}>(optional)</span>
          </div>
          <input
            type="text"
            placeholder="e.g. fix-auth, add-search"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLaunch(); }}
            style={inputStyle}
          />
        </div>

        {/* Launch button */}
        <button
          onClick={handleLaunch}
          disabled={!projectPath.trim() || creating}
          style={{
            padding: '10px 16px',
            background: projectPath.trim() && !creating ? colors.accent.blue : colors.surface.hover,
            border: 'none',
            borderRadius: 6,
            color: colors.text.primary,
            fontFamily: fonts.body,
            fontSize: 13,
            cursor: projectPath.trim() && !creating ? 'pointer' : 'not-allowed',
            letterSpacing: 0.5,
            opacity: projectPath.trim() && !creating ? 1 : 0.5,
            marginTop: 4,
          }}
        >
          {creating ? 'Starting...' : 'Launch Agent'}
        </button>
      </div>
    </div>
  );
}
