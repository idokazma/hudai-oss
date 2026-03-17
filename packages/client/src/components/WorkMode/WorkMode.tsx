import { useState, useEffect, useRef, useCallback } from 'react';
import { colors, fonts, alpha } from '../../theme/tokens.js';
import { useSessionStore } from '../../stores/session-store.js';
import { useDensityStore } from '../../stores/density-store.js';
import { usePanesStore } from '../../stores/panes-store.js';
import { useGraphStore } from '../../stores/graph-store.js';
import { useLibraryStore } from '../../stores/library-store.js';
import { useResizablePanel } from '../../hooks/useResizablePanel.js';
import { ResizeHandle } from '../ResizeHandle.js';
import { PanePreview } from '../PanePreview.js';
import { CodebaseMap } from '../CodebaseMap/CodebaseMap.js';
import { BrowserPreview } from '../BrowserPreview.js';
import { usePreviewStore } from '../../stores/preview-store.js';
import { CommanderChat } from '../RightPanel/CommanderChat.js';
import { HumanShell } from '../Mobile/views/HumanShell.js';
import { DeepLeftPanel } from '../DeepDiveMode/DeepLeftPanel.js';
import { ConfigSlideOver } from '../ConfigSlideOver/ConfigSlideOver.js';
import { SpawnModal } from '../shared/SpawnModal.js';
import { ThreadDetailView } from './ThreadDetailView.js';
import { useThreadStore } from '../../stores/thread-store.js';
import { useConfigPanelStore } from '../../stores/config-panel-store.js';
import { wsClient } from '../../ws/ws-client.js';
import type { ServerMessage } from '@hudai/shared';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  idle: { label: 'IDLE', color: colors.status.successLight },
  running: { label: 'WORKING', color: colors.accent.primary },
  paused: { label: 'PAUSED', color: colors.status.warning },
  complete: { label: 'DONE', color: colors.status.successLight },
  error: { label: 'ERROR', color: colors.status.errorLight },
};

export function WorkMode() {
  const session = useSessionStore((s) => s.session);
  const setMode = useDensityStore((s) => s.setMode);
  const setChatVisible = useDensityStore((s) => s.setChatVisible);
  const setTerminalVisible = useDensityStore((s) => s.setTerminalVisible);
  const toggleConfig = useConfigPanelStore((s) => s.toggle);
  const panes = usePanesStore((s) => s.panes);
  const mapped = STATUS_MAP[session.status] ?? STATUS_MAP.idle;

  const previewUrl = usePreviewStore((s) => s.url);
  const selectedThreadId = useThreadStore((s) => s.selectedThreadId);
  const pipelineAnalyzing = useGraphStore((s) => s.pipelineAnalyzing);
  const libraryBuilding = useLibraryStore((s) => s.isBuilding);
  const libraryProgress = useLibraryStore((s) => s.buildProgress);

  const [showPlanPanel, setShowPlanPanel] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [terminalMode, setTerminalMode] = useState<'raw' | 'human'>('raw');
  const [services, setServices] = useState({ llm: false, telegram: false, library: false });
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const sessionDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      if (msg.kind === 'service.status') setServices(msg.services);
      if (msg.kind === 'settings.keys' || msg.kind === 'settings.saved') {
        setTelegramConnected(!!msg.keys.telegramBotToken);
      }
    });
    return () => { unsub(); };
  }, []);

  // Close session dropdown on outside click
  useEffect(() => {
    if (!sessionDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (sessionDropdownRef.current && !sessionDropdownRef.current.contains(e.target as Node)) {
        setSessionDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sessionDropdownOpen]);

  const openSessionDropdown = useCallback(() => {
    wsClient.send({ kind: 'panes.list' });
    setSessionDropdownOpen((v) => !v);
  }, []);

  const terminal = useResizablePanel({
    direction: 'vertical',
    defaultSize: 180,
    minSize: 80,
    maxSize: 500,
    storageKey: 'density-terminal',
    collapsible: true,
  });

  const sidebar = useResizablePanel({
    direction: 'horizontal',
    defaultSize: 320,
    minSize: 200,
    maxSize: 500,
    storageKey: 'density-sidebar',
    collapsible: true,
  });

  // Auto-toggle preview when URL is set/cleared
  useEffect(() => { setShowPreview(!!previewUrl); }, [previewUrl]);

  // Sync sidebar/terminal visibility to density store (for AgentNotification)
  useEffect(() => { setChatVisible(!sidebar.collapsed); }, [sidebar.collapsed, setChatVisible]);
  useEffect(() => { setTerminalVisible(!terminal.collapsed); }, [terminal.collapsed, setTerminalVisible]);

  // Keyboard shortcuts: P = plan panel, T = terminal, S = sidebar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        setShowPlanPanel((v) => !v);
      }
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        terminal.toggleCollapse();
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        sidebar.toggleCollapse();
      }
      if ((e.key === 'w' || e.key === 'W') && previewUrl) {
        e.preventDefault();
        setShowPreview((v) => !v);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [terminal.toggleCollapse, sidebar.toggleCollapse, previewUrl]);

  // Build grid template
  const cols = [
    showPlanPanel ? '240px' : null,
    '1fr',
    !sidebar.collapsed ? `${sidebar.size}px` : null,
  ].filter(Boolean).join(' ');

  const rows = `40px 1fr 4px ${terminal.collapsed ? '0px' : `${terminal.size}px`}`;

  const totalCols = (showPlanPanel ? 1 : 0) + 1 + (sidebar.collapsed ? 0 : 1);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: cols,
        gridTemplateRows: rows,
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: colors.bg.primary,
      }}
    >
      {/* ── Top bar ── */}
      <div
        style={{
          gridColumn: `1 / -1`,
          height: 40,
          background: colors.bg.secondary,
          borderBottom: `1px solid ${colors.border.subtle}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: 8,
        }}
      >
        {/* Mode switcher */}
        <button
          onClick={() => setMode('glance')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: fonts.display,
            fontSize: 13,
            fontWeight: 700,
            color: colors.text.muted,
            letterSpacing: '0.08em',
            padding: '4px 8px',
          }}
          title="Switch to Glance (1)"
        >
          HUDAI
        </button>

        <div style={{ width: 1, height: 16, background: colors.border.subtle }} />

        {/* Status badge + session dropdown */}
        <div ref={sessionDropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={openSessionDropdown}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 8px',
              borderRadius: 4,
              background: alpha(mapped.color, 0.1),
              border: 'none',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: mapped.color,
                boxShadow: `0 0 6px ${alpha(mapped.color, 0.4)}`,
              }}
            />
            <span
              style={{
                fontSize: 10,
                fontFamily: fonts.display,
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: mapped.color,
              }}
            >
              {session.tmuxTarget || mapped.label}
            </span>
            <span style={{ fontSize: 9, color: colors.text.muted, marginLeft: 2 }}>▾</span>
          </button>

          {sessionDropdownOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 4,
              minWidth: 220,
              background: colors.bg.panel,
              border: `1px solid ${colors.border.medium}`,
              borderRadius: 6,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              zIndex: 200,
              padding: '4px 0',
            }}>
              {panes.map((pane) => {
                const isCurrent = pane.id === session.tmuxTarget;
                return (
                  <button
                    key={pane.id}
                    onClick={() => {
                      if (!isCurrent) {
                        wsClient.send({ kind: 'session.attach', tmuxTarget: pane.id });
                      }
                      setSessionDropdownOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '6px 12px',
                      border: 'none',
                      background: isCurrent ? alpha(colors.accent.blue, 0.12) : 'transparent',
                      color: isCurrent ? colors.accent.blueLight : colors.text.secondary,
                      fontSize: 12,
                      fontFamily: fonts.mono,
                      cursor: isCurrent ? 'default' : 'pointer',
                      textAlign: 'left',
                      outline: 'none',
                    }}
                    onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                    onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: isCurrent ? colors.accent.blue : colors.text.muted,
                    }} />
                    <span style={{ flex: 1 }}>{pane.id}</span>
                    {pane.title && pane.title !== pane.id && (
                      <span style={{ fontSize: 10, color: colors.text.muted }}>{pane.title}</span>
                    )}
                  </button>
                );
              })}
              {panes.length === 0 && (
                <div style={{ padding: '8px 12px', fontSize: 12, color: colors.text.muted, fontFamily: fonts.mono }}>
                  No tmux panes found
                </div>
              )}
              <div style={{ height: 1, background: colors.border.subtle, margin: '4px 0' }} />
              <button
                onClick={() => {
                  setSessionDropdownOpen(false);
                  setSpawnOpen(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 12px',
                  border: 'none',
                  background: 'transparent',
                  color: colors.accent.blueLight,
                  fontSize: 12,
                  fontFamily: fonts.mono,
                  cursor: 'pointer',
                  textAlign: 'left',
                  outline: 'none',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                + New Agent
              </button>
              <button
                onClick={() => {
                  wsClient.send({ kind: 'session.detach' });
                  setSessionDropdownOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 12px',
                  border: 'none',
                  background: 'transparent',
                  color: colors.status.warning,
                  fontSize: 12,
                  fontFamily: fonts.mono,
                  cursor: 'pointer',
                  textAlign: 'left',
                  outline: 'none',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                Detach
              </button>
            </div>
          )}
        </div>

        {/* Task label */}
        {session.taskLabel && session.taskLabel !== 'No active task' && (
          <span
            style={{
              fontSize: 12,
              fontFamily: fonts.body,
              color: colors.text.secondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {session.taskLabel}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Service indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 8 }}>
          {/* LLM */}
          {(() => {
            const llmPaused = !services.llm;
            const isThinking = !llmPaused && session.llmStatus === 'thinking';
            const llmColor = llmPaused ? colors.status.warning
              : isThinking ? colors.accent.blue
              : session.llmStatus === 'connected' ? colors.status.successLight
              : session.llmStatus === 'error' ? colors.status.errorLight
              : colors.text.muted;
            const llmLabel = llmPaused ? 'LLM'
              : session.llmActivity ? session.llmActivity
              : pipelineAnalyzing ? 'Pipelines'
              : isThinking ? 'Thinking...'
              : 'LLM';
            return (
              <button
                onClick={() => wsClient.send({ kind: 'service.toggle', service: 'llm', enabled: !services.llm })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: `${llmColor}12`,
                  border: `1px solid ${llmColor}30`,
                  cursor: 'pointer',
                  outline: 'none',
                  maxWidth: 120,
                  overflow: 'hidden',
                }}
                title={llmPaused ? 'Click to resume LLM' : `Click to pause LLM — ${llmLabel}`}
              >
                <div style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: llmColor,
                  boxShadow: isThinking ? `0 0 6px ${llmColor}` : 'none',
                  animation: isThinking ? 'pulse 1.5s ease-in-out infinite' : 'none',
                  flexShrink: 0,
                }} />
                <span style={{
                  fontSize: 10, fontFamily: fonts.mono, letterSpacing: 0.5,
                  color: llmColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {llmLabel}
                </span>
              </button>
            );
          })()}

          {/* Telegram */}
          {(() => {
            const tgPaused = !services.telegram;
            const tgColor = tgPaused ? colors.status.warning
              : telegramConnected ? colors.status.successLight
              : colors.text.muted;
            return (
              <button
                onClick={() => wsClient.send({ kind: 'service.toggle', service: 'telegram', enabled: !services.telegram })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: `${tgColor}12`,
                  border: `1px solid ${tgColor}30`,
                  cursor: 'pointer',
                  outline: 'none',
                }}
                title={tgPaused ? 'Click to resume Telegram' : 'Click to pause Telegram'}
              >
                <div style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: tgColor,
                  boxShadow: telegramConnected && !tgPaused ? `0 0 4px ${tgColor}` : 'none',
                }} />
                <span style={{
                  fontSize: 10, fontFamily: fonts.mono, letterSpacing: 0.5, color: tgColor,
                }}>
                  TG
                </span>
              </button>
            );
          })()}

          {/* Library */}
          {(() => {
            const libPaused = !services.library;
            const libColor = libPaused ? colors.status.warning
              : libraryBuilding ? colors.accent.blue
              : colors.status.successLight;
            return (
              <button
                onClick={() => wsClient.send({ kind: 'service.toggle', service: 'library', enabled: !services.library })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: `${libColor}12`,
                  border: `1px solid ${libColor}30`,
                  cursor: 'pointer',
                  outline: 'none',
                }}
                title={libPaused ? 'Click to resume Library' : 'Click to pause Library'}
              >
                <div style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: libColor,
                  boxShadow: !libPaused && libraryBuilding ? `0 0 4px ${libColor}` : 'none',
                  animation: !libPaused && libraryBuilding ? 'pulse 1.5s ease-in-out infinite' : 'none',
                }} />
                <span style={{
                  fontSize: 10, fontFamily: fonts.mono, letterSpacing: 0.5, color: libColor,
                }}>
                  {libPaused ? 'Lib'
                    : libraryBuilding && libraryProgress
                    ? `Lib ${libraryProgress.current}/${libraryProgress.total}`
                    : libraryBuilding ? 'Lib...'
                    : 'Lib'}
                </span>
              </button>
            );
          })()}
        </div>

        <div style={{ width: 1, height: 16, background: colors.border.subtle }} />

        {/* Toggle buttons */}
        <ToggleBtn
          label="P"
          title="Plan panel (P)"
          active={showPlanPanel}
          onClick={() => setShowPlanPanel((v) => !v)}
        />
        <ToggleBtn
          label="S"
          title="Sidebar (S)"
          active={!sidebar.collapsed}
          onClick={sidebar.toggleCollapse}
        />
        <ToggleBtn
          label="T"
          title="Terminal (T)"
          active={!terminal.collapsed}
          onClick={terminal.toggleCollapse}
        />
        {previewUrl && (
          <ToggleBtn
            label="W"
            title="Web Preview (W)"
            active={showPreview}
            onClick={() => setShowPreview((v) => !v)}
          />
        )}

        <div style={{ width: 1, height: 16, background: colors.border.subtle }} />

        {/* Gear */}
        <button
          onClick={toggleConfig}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            color: colors.text.muted,
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.text.primary; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.text.muted; }}
          title="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* ── Plan panel (optional left column) ── */}
      {showPlanPanel && <DeepLeftPanel />}

      {/* ── Center viewport ── */}
      <div style={{ overflow: 'hidden', minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          {showPreview && previewUrl ? <BrowserPreview /> : <CodebaseMap />}
        </div>
        {selectedThreadId && <ThreadDetailView />}
      </div>

      {/* ── Right sidebar (optional) — Chat ── */}
      {!sidebar.collapsed && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            background: colors.bg.panel,
            borderLeft: `1px solid ${colors.border.subtle}`,
            overflow: 'hidden',
            width: sidebar.size,
          }}
        >
          <CommanderChat />
        </div>
      )}

      {/* ── Terminal resize handle ── */}
      <ResizeHandle
        direction="vertical"
        onMouseDown={(e) => terminal.startResize(e, true)}
        onCollapse={terminal.toggleCollapse}
        collapsed={terminal.collapsed}
        collapseDirection="down"
        style={{ gridColumn: '1 / -1' }}
      />

      {/* ── Bottom terminal ── */}
      {!terminal.collapsed ? (
        <div style={{
          gridColumn: '1 / -1',
          overflow: 'hidden',
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Mode toggle — top right */}
          <div style={{
            position: 'absolute',
            top: 4,
            right: 12,
            zIndex: 10,
            display: 'flex',
            borderRadius: 4,
            overflow: 'hidden',
            border: `1px solid ${colors.border.subtle}`,
            background: colors.bg.panel,
          }}>
            {(['raw', 'human'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setTerminalMode(m)}
                style={{
                  padding: '3px 10px',
                  fontSize: 10,
                  fontFamily: fonts.mono,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  background: terminalMode === m ? alpha(colors.accent.primary, 0.2) : 'transparent',
                  border: 'none',
                  borderRight: m === 'raw' ? `1px solid ${colors.border.subtle}` : 'none',
                  color: terminalMode === m ? colors.accent.primary : colors.text.muted,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {m === 'raw' ? 'Terminal' : 'Human'}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {terminalMode === 'raw' ? <PanePreview /> : <HumanShell />}
          </div>
        </div>
      ) : (
        <div style={{ gridColumn: '1 / -1', display: 'none' }} />
      )}

      <ConfigSlideOver />
      <SpawnModal open={spawnOpen} onClose={() => setSpawnOpen(false)} />
    </div>
  );
}

function ToggleBtn({ label, title, active, onClick }: {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 24,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
        border: `1px solid ${active ? colors.accent.primary + '55' : colors.border.subtle}`,
        background: active ? alpha(colors.accent.primary, 0.15) : 'transparent',
        color: active ? colors.accent.primary : colors.text.dimmed,
        fontSize: 11,
        fontFamily: fonts.mono,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {label}
    </button>
  );
}
