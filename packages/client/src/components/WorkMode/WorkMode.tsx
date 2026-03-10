import { useState, useEffect } from 'react';
import { colors, fonts, alpha } from '../../theme/tokens.js';
import { useSessionStore } from '../../stores/session-store.js';
import { useDensityStore } from '../../stores/density-store.js';
import { useResizablePanel } from '../../hooks/useResizablePanel.js';
import { ResizeHandle } from '../ResizeHandle.js';
import { PanePreview } from '../PanePreview.js';
import { CodebaseMap } from '../CodebaseMap/CodebaseMap.js';
import { CurrentActionWidget } from '../RightPanel/CurrentActionWidget.js';
import { CommanderChat } from '../RightPanel/CommanderChat.js';
import { DeepLeftPanel } from '../DeepDiveMode/DeepLeftPanel.js';
import { ConfigSlideOver } from '../ConfigSlideOver/ConfigSlideOver.js';
import { useConfigPanelStore } from '../../stores/config-panel-store.js';

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
  const toggleConfig = useConfigPanelStore((s) => s.toggle);
  const mapped = STATUS_MAP[session.status] ?? STATUS_MAP.idle;

  const [showPlanPanel, setShowPlanPanel] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);

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
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [terminal.toggleCollapse, sidebar.toggleCollapse]);

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

        {/* Status badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 8px',
            borderRadius: 4,
            background: alpha(mapped.color, 0.1),
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
            {mapped.label}
          </span>
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

      {/* ── Center viewport (CodebaseMap includes its own Pipeline/Journey/etc dropdown) ── */}
      <div style={{ overflow: 'hidden', minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <CodebaseMap />
        </div>
      </div>

      {/* ── Right sidebar (optional) ── */}
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
          {/* Activity feed */}
          <div style={{ flex: 1, overflow: 'hidden', borderBottom: `1px solid ${colors.border.subtle}`, minHeight: 0 }}>
            <CurrentActionWidget />
          </div>

          {/* Chat */}
          <div style={{ flex: '0 0 40%', overflow: 'hidden', minHeight: 0 }}>
            <CommanderChat />
          </div>
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
        }}>
          <PanePreview />
        </div>
      ) : (
        <div style={{ gridColumn: '1 / -1', display: 'none' }} />
      )}

      <ConfigSlideOver />
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
