import { useRef, useState, useCallback, useEffect, type KeyboardEvent } from 'react';
import { useForceGraph } from './useForceGraph.js';
import { useGraphStore, type NodeSizeMode, type MapMode, type SemanticZoomTier } from '../../stores/graph-store.js';
import { useDocsStore } from '../../stores/docs-store.js';
import { JourneyPanel } from '../BuildQueue/JourneyPanel.js';
import { PipelineView } from '../PipelineView/PipelineView.js';
import { LibraryPanel } from '../BuildQueue/LibraryPanel.js';
import { useLibraryStore } from '../../stores/library-store.js';
import { wsClient } from '../../ws/ws-client.js';
import { colors, alpha, fonts } from '../../theme/tokens.js';
import { Dropdown } from '../shared/Dropdown.js';
import type { FileNode } from '@hudai/shared';

const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '3px 8px',
  fontSize: 11,
  fontFamily: fonts.mono,
  background: active ? alpha(colors.accent.primary, 0.4) : colors.surface.raised,
  border: `1px solid ${active ? colors.accent.blue : colors.border.subtle}`,
  borderRadius: 3,
  color: active ? colors.text.primary : colors.text.muted,
  cursor: 'pointer',
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
});

function defaultAnalysisPrompt(nodeId: string, isGroup: boolean): string {
  if (isGroup) {
    const modulePath = nodeId.replace('__group__', '');
    return `Analyze the entire \`${modulePath}/\` module: What does it do? Are its tests passing and comprehensive? Are there improvements or refactors we should make according to the current plan? Summarize findings concisely.`;
  }
  const fileName = nodeId.split('/').pop() ?? nodeId;
  return `Analyze the file \`${fileName}\`: Is it passing its tests? Do the tests cover all important paths? Are there improvements we can make according to the current plan? Summarize findings concisely.`;
}

function agentAnalysisPrompt(nodeId: string, isGroup: boolean): string {
  if (isGroup) {
    const modulePath = nodeId.replace('__group__', '');
    return `Use a subagent (Task tool) to thoroughly analyze and improve the \`${modulePath}/\` module. The subagent should: 1) Read all files in the module and their tests, 2) Check test coverage and identify gaps, 3) Suggest concrete improvements aligned with the current plan. Report back with findings.`;
  }
  return `Use a subagent (Task tool) to thoroughly analyze and improve the file \`${nodeId}\`. The subagent should: 1) Read the file and its tests, 2) Check test coverage and identify gaps, 3) Suggest concrete improvements aligned with the current plan. Report back with findings.`;
}

interface ModuleChatBox {
  nodeId: string;
  isGroup: boolean;
  x: number;
  y: number;
}

interface InfoPanel {
  nodeId: string;
  isGroup: boolean;
  x: number;
  y: number;
}

function NodeInfoPanel({
  panel,
  graph,
  content,
  loading,
  error,
  onClose,
}: {
  panel: InfoPanel;
  graph: { nodes: FileNode[]; edges: { source: string; target: string }[] } | null;
  content: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const { nodeId, isGroup, x, y } = panel;

  if (isGroup) {
    const groupPath = nodeId.replace('__group__', '');
    const children = graph?.nodes.filter((n) => n.group === groupPath) ?? [];
    const modifiedCount = children.filter((n) => n.modified).length;

    return (
      <div
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: 320,
          maxHeight: 400,
          background: colors.bg.panel,
          border: `1px solid ${colors.accent.orange}55`,
          borderRadius: 8,
          boxShadow: `${colors.surface.shadow}, 0 0 16px ${colors.accent.orange}15`,
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: `1px solid ${colors.border.subtle}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
            <span style={{ fontSize: 12, color: colors.accent.orange }}>{'◈'}</span>
            <span style={{
              fontSize: 12,
              fontFamily: fonts.mono,
              color: colors.text.primary,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {groupPath}/
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: colors.text.muted,
              cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Meta */}
        <div style={{ padding: '8px 10px', display: 'flex', gap: 12, fontSize: 11, color: colors.text.muted, fontFamily: fonts.mono }}>
          <span>{children.length} files</span>
          {modifiedCount > 0 && <span style={{ color: colors.accent.orangeLight }}>{modifiedCount} modified</span>}
        </div>

        {/* Content: README or file list */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 10px 10px',
          fontSize: 13,
          fontFamily: fonts.mono,
          color: colors.text.secondary,
          lineHeight: 1.5,
        }}>
          {loading ? (
            <span style={{ color: colors.text.muted, fontSize: 12 }}>Loading...</span>
          ) : error || !content ? (
            // No README — show file list
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {children.map((n) => (
                <div key={n.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                  color: n.modified ? colors.accent.orangeLight : n.visited ? colors.accent.blueLight : colors.text.muted,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: n.modified ? colors.accent.orange : n.visited ? colors.accent.blue : colors.border.subtle }} />
                  {n.label}
                </div>
              ))}
            </div>
          ) : (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{content}</pre>
          )}
        </div>
      </div>
    );
  }

  // File node
  const fileNode = graph?.nodes.find((n) => n.id === nodeId);
  const edges = graph?.edges ?? [];
  const connectionCount = edges.filter((e) => e.source === nodeId || e.target === nodeId).length;

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 320,
        maxHeight: 420,
        background: colors.bg.panel,
        border: `1px solid ${colors.accent.blue}55`,
        borderRadius: 8,
        boxShadow: `${colors.surface.shadow}, 0 0 16px ${colors.accent.blue}15`,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 10px',
        borderBottom: `1px solid ${colors.border.subtle}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
          <span style={{ fontSize: 12, color: colors.accent.blue }}>{'◆'}</span>
          <span style={{
            fontSize: 12,
            fontFamily: fonts.mono,
            color: colors.text.primary,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {fileNode?.label ?? nodeId.split('/').pop()}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: colors.text.muted,
            cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Meta row */}
      <div style={{
        padding: '6px 10px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        fontSize: 11,
        color: colors.text.muted,
        fontFamily: fonts.mono,
        borderBottom: `1px solid ${colors.border.subtle}`,
      }}>
        <span title="Path">{nodeId}</span>
      </div>
      <div style={{
        padding: '6px 10px',
        display: 'flex',
        gap: 12,
        fontSize: 11,
        color: colors.text.muted,
        fontFamily: fonts.mono,
      }}>
        {fileNode && <span>{(fileNode.size / 1024).toFixed(1)} KB</span>}
        {fileNode && <span>{fileNode.extension}</span>}
        <span>{connectionCount} connection{connectionCount !== 1 ? 's' : ''}</span>
        {fileNode?.visited && <span style={{ color: colors.accent.blueLight }}>visited</span>}
        {fileNode?.modified && <span style={{ color: colors.accent.orangeLight }}>modified</span>}
      </div>

      {/* File preview */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0 10px 10px',
      }}>
        {loading ? (
          <span style={{ color: colors.text.muted, fontSize: 12, fontFamily: fonts.mono }}>Loading...</span>
        ) : error ? (
          <span style={{ color: colors.status.error, fontSize: 12, fontFamily: fonts.mono }}>{error}</span>
        ) : (
          <pre style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 12,
            fontFamily: fonts.mono,
            color: colors.text.secondary,
            lineHeight: 1.5,
          }}>
            {content.split('\n').slice(0, 50).join('\n')}
            {content.split('\n').length > 50 && `\n\n... (${content.split('\n').length - 50} more lines)`}
          </pre>
        )}
      </div>
    </div>
  );
}

export function CodebaseMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nodeSizeMode = useGraphStore((s) => s.nodeSizeMode);
  const setNodeSizeMode = useGraphStore((s) => s.setNodeSizeMode);
  const mapMode = useGraphStore((s) => s.mapMode);
  const setMapMode = useGraphStore((s) => s.setMapMode);
  const sessionFileCount = useGraphStore((s) => s.sessionTouchedFiles.size);
  const semanticZoom = useGraphStore((s) => s.semanticZoom);
  const hasArchitecture = useGraphStore((s) => !!s.architecture);
  const [scopeNodes, setScopeNodes] = useState<string[]>([]);
  const [chatBox, setChatBox] = useState<ModuleChatBox | null>(null);
  const [chatText, setChatText] = useState('');
  const [infoPanel, setInfoPanel] = useState<InfoPanel | null>(null);
  const graph = useGraphStore((s) => s.graph);
  const docsContent = useDocsStore((s) => s.content);
  const docsLoading = useDocsStore((s) => s.loading);
  const docsError = useDocsStore((s) => s.error);
  const docsSelectedFile = useDocsStore((s) => s.selectedFile);

  // Click on the map background (empty space, no node) closes any open panels
  const handleMapBackgroundClick = useCallback(() => {
    setChatBox(null);
    setChatText('');
    setInfoPanel(null);
  }, []);

  const onScopeChange = useCallback((nodeIds: string[]) => {
    setScopeNodes(nodeIds);
  }, []);

  const onNodeRightClick = useCallback((nodeId: string, isGroup: boolean, screenX: number, screenY: number) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const x = containerRect ? Math.min(screenX, containerRect.width - 320) : screenX;
    const y = containerRect ? Math.min(screenY, containerRect.height - 200) : screenY;
    setChatBox({ nodeId, isGroup, x: Math.max(8, x), y: Math.max(8, y) });
    setChatText(defaultAnalysisPrompt(nodeId, isGroup));
    setInfoPanel(null);
  }, []);

  const onNodeClick = useCallback((nodeId: string, isGroup: boolean, screenX: number, screenY: number) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const x = containerRect ? Math.min(screenX, containerRect.width - 340) : screenX;
    const y = containerRect ? Math.min(screenY, containerRect.height - 300) : screenY;
    setInfoPanel({ nodeId, isGroup, x: Math.max(8, x), y: Math.max(8, y) });
    setChatBox(null);

    if (isGroup) {
      const groupPath = nodeId.replace('__group__', '');
      // Try to load README.md for this directory
      wsClient.send({ kind: 'file.read', path: groupPath + '/README.md' });
      useDocsStore.getState().selectFile(groupPath + '/README.md');
    } else {
      wsClient.send({ kind: 'file.read', path: nodeId });
      useDocsStore.getState().selectFile(nodeId);
    }
  }, []);

  useForceGraph(canvasRef, containerRef, onScopeChange, onNodeRightClick, onNodeClick, handleMapBackgroundClick);

  // Focus textarea when chat box opens
  useEffect(() => {
    if (chatBox && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [chatBox]);

  const handleSetScope = () => {
    if (scopeNodes.length === 0) return;
    wsClient.send({
      kind: 'command',
      command: { type: 'scope_boundary', data: { files: scopeNodes, label: 'User scope' } },
    });
  };

  const handleSendChat = () => {
    const text = chatText.trim();
    if (!text || !chatBox) return;
    wsClient.send({
      kind: 'command',
      command: { type: 'prompt', data: { text } },
    });
    setChatBox(null);
    setChatText('');
  };

  const handleSendAgent = () => {
    if (!chatBox) return;
    wsClient.send({
      kind: 'command',
      command: { type: 'prompt', data: { text: agentAnalysisPrompt(chatBox.nodeId, chatBox.isGroup) } },
    });
    setChatBox(null);
    setChatText('');
  };

  const handleChatKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
    if (e.key === 'Escape') {
      setChatBox(null);
      setChatText('');
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: colors.bg.primary,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', opacity: mapMode === 'journey' || mapMode === 'pipeline' || mapMode === 'library' ? 0.15 : 1 }} />

      {/* Architecture mode zoom tier selector */}
      {mapMode === 'architecture' && (
        <div style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          gap: 4,
          alignItems: 'center',
          padding: '4px 8px',
          background: colors.bg.panel,
          border: `1px solid ${colors.border.subtle}`,
          borderRadius: 4,
          zIndex: 10,
        }}>
          <span style={{ fontSize: 10, color: colors.text.muted, fontFamily: fonts.mono, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Level:
          </span>
          {([
            { tier: 'container' as const, label: 'C2 Containers', color: colors.accent.orange },
            { tier: 'module' as const, label: 'C3 Modules', color: colors.accent.blueLight },
            { tier: 'file' as const, label: 'C4 Files', color: colors.text.secondary },
          ]).map(({ tier, label, color }) => (
            <button
              key={tier}
              onClick={() => useGraphStore.getState().setSemanticZoom(tier)}
              style={{
                padding: '2px 6px',
                fontSize: 11,
                fontFamily: fonts.mono,
                fontWeight: semanticZoom === tier ? 600 : 400,
                background: semanticZoom === tier ? alpha(colors.accent.primary, 0.3) : 'transparent',
                border: `1px solid ${semanticZoom === tier ? color : 'transparent'}`,
                borderRadius: 3,
                color: semanticZoom === tier ? color : colors.text.muted,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Journey overlay */}
      {mapMode === 'journey' && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 5,
          overflow: 'hidden',
        }}>
          <JourneyPanel />
        </div>
      )}

      {/* Pipeline overlay */}
      {mapMode === 'pipeline' && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 5,
          overflow: 'hidden',
        }}>
          <PipelineView />
        </div>
      )}

      {/* Library overlay */}
      {mapMode === 'library' && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 5,
          overflow: 'hidden',
        }}>
          <LibraryPanel />
        </div>
      )}

      {/* Top-left: View mode dropdown + Size mode (map only) */}
      <div style={{
        position: 'absolute',
        top: 8,
        left: 8,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        zIndex: 10,
      }}>
        <Dropdown
          value={mapMode}
          options={[
            { value: 'pipeline' as MapMode, label: 'Pipeline' },
            { value: 'full' as MapMode, label: 'Full Map' },
            { value: 'session' as MapMode, label: `Session${sessionFileCount > 0 ? ` (${sessionFileCount})` : ''}` },
            { value: 'journey' as MapMode, label: 'Journey' },
            { value: 'architecture' as MapMode, label: 'C4' },
            { value: 'library' as MapMode, label: 'Library' },
          ]}
          onChange={(mode) => {
            setMapMode(mode);
            if (mode === 'library') {
              const libStore = useLibraryStore.getState();
              if (libStore.modules.length === 0 && !libStore.isBuilding) {
                wsClient.send({ kind: 'library.request' });
              }
            }
          }}
        />

        {/* Size mode — only visible in map modes */}
        {(mapMode === 'full' || mapMode === 'session' || mapMode === 'architecture') && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button
              onClick={() => setNodeSizeMode('filesize')}
              style={toggleBtnStyle(nodeSizeMode === 'filesize')}
            >
              File Size
            </button>
            <button
              onClick={() => setNodeSizeMode('connectivity')}
              style={toggleBtnStyle(nodeSizeMode === 'connectivity')}
            >
              Connections
            </button>
          </div>
        )}
      </div>

      {/* Module chat box — appears on file double-click */}
      {chatBox && (
        <div
          style={{
            position: 'absolute',
            left: chatBox.x,
            top: chatBox.y,
            width: 300,
            background: colors.bg.panel,
            border: `1px solid ${colors.accent.blue}55`,
            borderRadius: 8,
            boxShadow: `${colors.surface.shadow}, 0 0 16px ${colors.accent.blue}15`,
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 10px',
            borderBottom: `1px solid ${colors.border.subtle}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
              <span style={{ fontSize: 12, color: chatBox.isGroup ? colors.accent.orange : colors.accent.blue }}>
                {chatBox.isGroup ? '◈' : '◆'}
              </span>
              <span style={{
                fontSize: 12,
                fontFamily: fonts.mono,
                color: colors.text.primary,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {chatBox.isGroup
                  ? (chatBox.nodeId.replace('__group__', '') + '/')
                  : chatBox.nodeId.split('/').pop()}
              </span>
            </div>
            <button
              onClick={() => { setChatBox(null); setChatText(''); }}
              style={{
                background: 'none',
                border: 'none',
                color: colors.text.muted,
                cursor: 'pointer',
                fontSize: 14,
                padding: '0 2px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          {/* Editable prompt */}
          <textarea
            ref={inputRef}
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={handleChatKeyDown}
            style={{
              padding: '8px 10px',
              background: 'transparent',
              border: 'none',
              color: colors.text.primary,
              fontSize: 13,
              fontFamily: fonts.mono,
              lineHeight: 1.5,
              resize: 'none',
              outline: 'none',
              minHeight: 72,
              maxHeight: 120,
            }}
          />

          {/* Actions */}
          <div style={{
            display: 'flex',
            gap: 6,
            padding: '6px 10px 8px',
            borderTop: `1px solid ${colors.border.subtle}`,
          }}>
            <button
              onClick={handleSendChat}
              style={{
                flex: 1,
                padding: '6px 0',
                border: 'none',
                borderRadius: 4,
                background: colors.accent.blue,
                color: colors.text.white,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Send ↵
            </button>
            <button
              onClick={handleSendAgent}
              style={{
                flex: 1,
                padding: '6px 0',
                border: `1px solid ${colors.accent.orange}66`,
                borderRadius: 4,
                background: `${colors.accent.orange}15`,
                color: colors.accent.orangeLight,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Send a subagent to analyze and improve this module"
            >
              Send Agent
            </button>
          </div>

          {/* Hint */}
          <div style={{
            padding: '0 10px 6px',
            fontSize: 10,
            color: colors.text.muted,
            fontFamily: fonts.mono,
          }}>
            Enter to send · Shift+Enter for newline · Esc to close
          </div>
        </div>
      )}

      {/* Node info panel — appears on single click */}
      {infoPanel && (
        <NodeInfoPanel
          panel={infoPanel}
          graph={graph}
          content={docsSelectedFile === (infoPanel.isGroup ? infoPanel.nodeId.replace('__group__', '') + '/README.md' : infoPanel.nodeId) ? docsContent : ''}
          loading={docsSelectedFile === (infoPanel.isGroup ? infoPanel.nodeId.replace('__group__', '') + '/README.md' : infoPanel.nodeId) && docsLoading}
          error={docsSelectedFile === (infoPanel.isGroup ? infoPanel.nodeId.replace('__group__', '') + '/README.md' : infoPanel.nodeId) ? docsError : null}
          onClose={() => setInfoPanel(null)}
        />
      )}

      {/* Bottom-left: Scope controls */}
      {scopeNodes.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          background: colors.bg.panel,
          border: `1px solid ${colors.status.successLight}44`,
          borderRadius: 6,
          zIndex: 10,
        }}>
          <span style={{
            fontSize: 12,
            fontFamily: fonts.mono,
            color: colors.status.successLight,
          }}>
            {scopeNodes.length} file{scopeNodes.length > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={handleSetScope}
            style={{
              padding: '4px 12px',
              border: 'none',
              borderRadius: 4,
              background: colors.status.success,
              color: colors.text.white,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Set Scope
          </button>
        </div>
      )}

      {/* Bottom-right: Help hint */}
      <div style={{
        position: 'absolute',
        bottom: 8,
        right: 8,
        fontSize: 11,
        color: colors.text.muted,
        fontFamily: fonts.mono,
        opacity: 0.5,
        zIndex: 10,
      }}>
        {mapMode === 'architecture'
          ? 'scroll: zoom levels (C2→C3→C4) | click: inspect | double-click: expand'
          : 'click: inspect | shift+click: scope | double-click: expand | right-click: analyze'}
      </div>
    </div>
  );
}
