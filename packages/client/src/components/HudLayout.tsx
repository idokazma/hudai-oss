import { useSessionStore } from '../stores/session-store.js';
import { useReplayStore } from '../stores/replay-store.js';
import { useReplayEngine } from '../hooks/useReplayEngine.js';
import { useResizablePanel } from '../hooks/useResizablePanel.js';
import { ResourceBar } from './ResourceBar.js';
import { BuildQueue } from './BuildQueue/BuildQueue.js';
import { RightPanel } from './RightPanel/RightPanel.js';
import { PaneSelector } from './Steering/PaneSelector.js';
import { CodebaseMap } from './CodebaseMap/CodebaseMap.js';
import { BrowserPreview } from './BrowserPreview.js';
import { PanePreview } from './PanePreview.js';
import { ResizeHandle } from './ResizeHandle.js';
import { usePreviewStore } from '../stores/preview-store.js';
import { colors, fonts } from '../theme/tokens.js';

export function HudLayout() {
  const status = useSessionStore((s) => s.session.status);
  const replayMode = useReplayStore((s) => s.mode);
  useReplayEngine();
  const isAttached = status !== 'idle' || replayMode === 'replay';
  const previewUrl = usePreviewStore((s) => s.url);
  const centerTab = usePreviewStore((s) => s.centerTab);
  const setCenterTab = usePreviewStore((s) => s.setCenterTab);

  const left = useResizablePanel({
    direction: 'horizontal',
    defaultSize: 260,
    minSize: 180,
    maxSize: 400,
    storageKey: 'hudai-left-panel',
    collapsible: true,
  });

  const right = useResizablePanel({
    direction: 'horizontal',
    defaultSize: 320,
    minSize: 200,
    maxSize: 500,
    storageKey: 'hudai-right-panel',
    collapsible: true,
  });

  const bottom = useResizablePanel({
    direction: 'vertical',
    defaultSize: 200,
    minSize: 100,
    maxSize: 500,
    storageKey: 'hudai-bottom-panel',
    collapsible: true,
  });

  // When attached: 5 columns (left | handle | center | handle | right), 4 rows (bar | content | handle | terminal)
  // When collapsed, panel column/row becomes 0px
  const gridTemplateColumns = isAttached
    ? `${left.collapsed ? '0px' : `${left.size}px`} 4px 1fr 4px ${right.collapsed ? '0px' : `${right.size}px`}`
    : '1fr';

  const gridTemplateRows = isAttached
    ? `64px 1fr 4px ${bottom.collapsed ? '0px' : `${bottom.size}px`}`
    : '64px 1fr';

  return (
    <div style={{
      display: 'grid',
      gridTemplateRows,
      gridTemplateColumns,
      height: '100vh',
      width: '100vw',
      background: colors.bg.primary,
      fontFamily: fonts.body,
      color: colors.text.primary,
    }}>
      {/* Row 1: ResourceBar — spans full width */}
      <div style={{ gridColumn: '1 / -1' }}>
        <ResourceBar />
      </div>

      {isAttached ? (
        <>
          {/* Row 2, Col 1: Build Queue */}
          {!left.collapsed && (
            <BuildQueue />
          )}
          {left.collapsed && <div style={{ display: 'none' }} />}

          {/* Row 2: Left resize handle (col 2) */}
          <ResizeHandle
            direction="horizontal"
            onMouseDown={(e) => left.startResize(e)}
            onCollapse={left.toggleCollapse}
            collapsed={left.collapsed}
            collapseDirection="right"
          />

          {/* Row 2, Col 3: Codebase Map or Browser Preview */}
          <div style={{ overflow: 'hidden', gridColumn: 3, display: 'flex', flexDirection: 'column' }}>
            {previewUrl && (
              <div style={{
                display: 'flex',
                gap: 0,
                borderBottom: `1px solid ${colors.border.subtle}`,
                background: colors.bg.panel,
                flexShrink: 0,
              }}>
                {(['map', 'preview'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setCenterTab(tab)}
                    style={{
                      padding: '6px 16px',
                      fontSize: 11,
                      fontFamily: fonts.mono,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      background: centerTab === tab ? colors.bg.primary : 'transparent',
                      color: centerTab === tab ? colors.text.primary : colors.text.muted,
                      border: 'none',
                      borderBottom: centerTab === tab ? `2px solid ${colors.accent.blue}` : '2px solid transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            )}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {previewUrl && centerTab === 'preview' ? <BrowserPreview /> : <CodebaseMap />}
            </div>
          </div>

          {/* Row 2: Right resize handle (col 4) */}
          <ResizeHandle
            direction="horizontal"
            onMouseDown={(e) => right.startResize(e, true)}
            onCollapse={right.toggleCollapse}
            collapsed={right.collapsed}
            collapseDirection="left"
          />

          {/* Row 2, Col 5: Right Panel */}
          {!right.collapsed && (
            <RightPanel />
          )}
          {right.collapsed && <div style={{ display: 'none' }} />}

          {/* Row 3: Bottom resize handle — spans full width */}
          <ResizeHandle
            direction="vertical"
            onMouseDown={(e) => bottom.startResize(e, true)}
            onCollapse={bottom.toggleCollapse}
            collapsed={bottom.collapsed}
            collapseDirection="down"
            style={{
              gridColumn: '1 / -1',
              borderTop: `1px solid ${colors.border.focus}`,
              borderBottom: `1px solid ${colors.border.focus}`,
            }}
          />

          {/* Row 4: Live Terminal — spans full width */}
          {!bottom.collapsed ? (
            <div style={{
              gridColumn: '1 / -1',
              overflow: 'hidden',
              minHeight: 0,
            }}>
              {replayMode !== 'replay' ? (
                <PanePreview />
              ) : (
                <div style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: colors.text.muted,
                  fontSize: 12,
                  fontFamily: fonts.mono,
                }}>
                  Terminal not available in replay mode
                </div>
              )}
            </div>
          ) : (
            <div style={{ gridColumn: '1 / -1', display: 'none' }} />
          )}
        </>
      ) : (
        /* Idle: Show pane selector */
        <PaneSelector />
      )}
    </div>
  );
}
