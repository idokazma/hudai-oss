import { useState } from 'react';
import { useGraphStore } from '../../../stores/graph-store.js';
import { usePlanStore, type PlanTask } from '../../../stores/plan-store.js';
import { useJourneyStore, type JourneyEntry } from '../../../stores/journey-store.js';
import { useEventStore } from '../../../stores/event-store.js';
import { wsClient } from '../../../ws/ws-client.js';
import { useChatStore } from '../../../stores/chat-store.js';
import { colors, fonts, alpha, EVENT_COLORS } from '../../../theme/tokens.js';
import type { FileNode } from '@hudai/shared';
import { useEffect } from 'react';

type ViewMode = 'journey' | 'files' | 'pipeline';

const TYPE_ICONS: Record<JourneyEntry['type'], string> = {
  file: '📄',
  shell: '$',
  search: '🔍',
  think: '💭',
  test: '🧪',
  plan: '📋',
  control: '⚡',
};

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

/**
 * Journey view — timeline of agent actions, tappable to ask about / steer
 */
function JourneyView() {
  const entries = useJourneyStore((s) => s.entries);
  const events = useEventStore((s) => s.events);
  const processEvents = useJourneyStore((s) => s.processEvents);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (events.length > 0) processEvents(events);
  }, [events.length]);

  const items = entries.slice(-40).reverse();

  if (items.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, fontFamily: fonts.mono, color: colors.text.dimmed }}>
        No activity yet
      </div>
    );
  }

  return (
    <div style={{ padding: '0 16px' }}>
      {items.map((entry) => {
        const isExpanded = expanded === entry.id;
        const dotColor =
          entry.type === 'file'
            ? (entry.actions.includes('E') || entry.actions.includes('C') ? EVENT_COLORS['file.edit'] : EVENT_COLORS['file.read'])
            : entry.type === 'shell' ? EVENT_COLORS['shell.run']
            : entry.type === 'search' ? EVENT_COLORS['search.grep']
            : entry.type === 'test' ? EVENT_COLORS['test.run']
            : colors.text.dimmed;

        return (
          <div key={entry.id}>
            <div
              onClick={() => setExpanded(isExpanded ? null : entry.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 0',
                borderBottom: `1px solid ${colors.border.subtle}`,
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: dotColor,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontFamily: fonts.mono,
                    color: colors.text.primary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {entry.label}
                </div>
                <div style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.text.dimmed, marginTop: 1 }}>
                  {entry.actions.join(' ')} {entry.visits > 1 ? `×${entry.visits}` : ''}
                </div>
              </div>
              <span style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.text.dimmed, flexShrink: 0 }}>
                {timeAgo(entry.timestamp)}
              </span>
            </div>

            {/* Expanded: action buttons */}
            {isExpanded && (
              <div style={{ padding: '8px 0 8px 18px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {entry.filePath && (
                  <button
                    onClick={() => {
                      wsClient.send({
                        kind: 'chat.send',
                        text: `Tell me about ${entry.filePath} — what did the agent do here?`,
                      });
                    }}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: `1px solid ${colors.border.subtle}`,
                      background: colors.surface.base,
                      color: colors.text.secondary,
                      fontSize: 12,
                      fontFamily: fonts.body,
                      cursor: 'pointer',
                      minHeight: 36,
                    }}
                  >
                    Ask about this
                  </button>
                )}
                {entry.filePath && (
                  <button
                    onClick={() => {
                      wsClient.send({
                        kind: 'command',
                        command: { type: 'focus_file', data: { path: entry.filePath! } },
                      });
                    }}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: `1px solid ${alpha(colors.accent.primary, 0.3)}`,
                      background: alpha(colors.accent.primary, 0.08),
                      color: colors.accent.primary,
                      fontSize: 12,
                      fontFamily: fonts.body,
                      cursor: 'pointer',
                      minHeight: 36,
                    }}
                  >
                    Focus agent here
                  </button>
                )}
                {entry.type === 'test' && (
                  <button
                    onClick={() => {
                      wsClient.send({
                        kind: 'command',
                        command: { type: 'prompt', data: { text: 'Re-run the tests and fix any failures' } },
                      });
                    }}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: `1px solid ${alpha(colors.action.test, 0.3)}`,
                      background: alpha(colors.action.test, 0.08),
                      color: colors.action.test,
                      fontSize: 12,
                      fontFamily: fonts.body,
                      cursor: 'pointer',
                      minHeight: 36,
                    }}
                  >
                    Re-run tests
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Files view — shows codebase files grouped by module, tappable to steer
 */
function FilesView() {
  const graph = useGraphStore((s) => s.graph);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!graph || graph.nodes.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, fontFamily: fonts.mono, color: colors.text.dimmed }}>
        No codemap data — attach to a session
      </div>
    );
  }

  // Group files by their group property (module/directory)
  const groups = new Map<string, FileNode[]>();
  for (const node of graph.nodes) {
    const group = node.group || 'root';
    const existing = groups.get(group) ?? [];
    existing.push(node);
    groups.set(group, existing);
  }

  const sortedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div style={{ padding: '0 16px' }}>
      {sortedGroups.map(([group, nodes]) => {
        const isExpanded = expanded === group;
        const modifiedCount = nodes.filter((n) => n.modified).length;
        const visitedCount = nodes.filter((n) => n.visited).length;

        return (
          <div key={group}>
            <div
              onClick={() => setExpanded(isExpanded ? null : group)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 0',
                borderBottom: `1px solid ${colors.border.subtle}`,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 12, color: colors.accent.primary }}>◈</span>
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  fontFamily: fonts.mono,
                  color: colors.text.primary,
                  fontWeight: 600,
                }}
              >
                {group}/
              </span>
              <span style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.text.dimmed }}>
                {nodes.length} files
              </span>
              {modifiedCount > 0 && (
                <span style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.accent.light }}>
                  {modifiedCount} mod
                </span>
              )}
              <span style={{ fontSize: 12, color: colors.text.dimmed }}>{isExpanded ? '▾' : '▸'}</span>
            </div>

            {isExpanded && (
              <div style={{ padding: '4px 0 4px 20px' }}>
                {nodes.map((node) => (
                  <div
                    key={node.id}
                    onClick={() => {
                      wsClient.send({
                        kind: 'chat.send',
                        text: `Analyze the file \`${node.id}\`: what is its purpose, and what did the agent do with it?`,
                      });
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 0',
                      borderBottom: `1px solid ${alpha(colors.border.subtle, 0.5)}`,
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: node.modified
                          ? colors.accent.primary
                          : node.visited
                            ? colors.accent.light
                            : colors.text.dimmed,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 12,
                        fontFamily: fonts.mono,
                        color: node.modified
                          ? colors.accent.light
                          : node.visited
                            ? colors.text.secondary
                            : colors.text.muted,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                    >
                      {node.label}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: fonts.mono,
                        color: colors.text.dimmed,
                      }}
                    >
                      {(node.size / 1024).toFixed(1)}K
                    </span>
                  </div>
                ))}

                {/* Module-level actions */}
                <div style={{ display: 'flex', gap: 6, padding: '8px 0', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => {
                      wsClient.send({
                        kind: 'chat.send',
                        text: `Analyze the \`${group}/\` module: what does it do, and are there issues?`,
                      });
                    }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: `1px solid ${colors.border.subtle}`,
                      background: colors.surface.base,
                      color: colors.text.secondary,
                      fontSize: 12,
                      fontFamily: fonts.body,
                      cursor: 'pointer',
                      minHeight: 36,
                    }}
                  >
                    Ask about module
                  </button>
                  <button
                    onClick={() => {
                      wsClient.send({
                        kind: 'command',
                        command: {
                          type: 'scope_boundary',
                          data: { files: nodes.map((n) => n.id), label: `${group} scope` },
                        },
                      });
                    }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: `1px solid ${alpha(colors.accent.primary, 0.3)}`,
                      background: alpha(colors.accent.primary, 0.08),
                      color: colors.accent.primary,
                      fontSize: 12,
                      fontFamily: fonts.body,
                      cursor: 'pointer',
                      minHeight: 36,
                    }}
                  >
                    Scope agent here
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Pipeline view — shows pipeline blocks as a list, tappable to steer
 */
function PipelineList() {
  const pipelineLayer = useGraphStore((s) => s.pipelineLayer);
  const pipelines = pipelineLayer?.pipelines ?? [];

  if (pipelines.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, fontFamily: fonts.mono, color: colors.text.dimmed }}>
        No pipeline data
      </div>
    );
  }

  return (
    <div style={{ padding: '0 16px' }}>
      {pipelines.map((pipeline) => (
        <div key={pipeline.id} style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 12,
              fontFamily: fonts.body,
              color: colors.text.muted,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
              marginBottom: 8,
              padding: '4px 0',
              borderBottom: `1px solid ${colors.border.subtle}`,
            }}
          >
            {pipeline.label}
          </div>

          {pipeline.blocks.map((block) => {
            const blockColor =
              block.blockType === 'source' ? colors.block.source
              : block.blockType === 'transform' ? colors.block.transform
              : block.blockType === 'sink' ? colors.block.sink
              : colors.text.dimmed;

            return (
              <div
                key={block.id}
                onClick={() => {
                  const filesCtx = block.files.length > 0
                    ? `\nFiles: ${block.files.join(', ')}`
                    : '';
                  wsClient.send({
                    kind: 'chat.send',
                    text: `Analyze the "${block.label}" block (${block.blockType}${block.technology ? ', ' + block.technology : ''}): what does it do and is it healthy?${filesCtx}`,
                  });
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 0',
                  borderBottom: `1px solid ${alpha(colors.border.subtle, 0.5)}`,
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: blockColor,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontFamily: fonts.mono,
                      color: colors.text.primary,
                      fontWeight: 500,
                    }}
                  >
                    {block.label}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: fonts.mono,
                      color: colors.text.dimmed,
                      marginTop: 1,
                    }}
                  >
                    {block.blockType}
                    {block.technology ? ` · ${block.technology}` : ''}
                    {block.files.length > 0 ? ` · ${block.files.length} files` : ''}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: colors.text.dimmed }}>▸</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function ViewTab() {
  const [mode, setMode] = useState<ViewMode>('journey');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Mode switcher */}
      <div
        style={{
          display: 'flex',
          padding: '8px 16px',
          gap: 4,
          borderBottom: `1px solid ${colors.border.subtle}`,
          flexShrink: 0,
        }}
      >
        {([
          { id: 'journey' as const, label: 'Journey' },
          { id: 'files' as const, label: 'Files' },
          { id: 'pipeline' as const, label: 'Pipeline' },
        ]).map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 6,
              border: 'none',
              background: mode === m.id ? alpha(colors.accent.primary, 0.15) : 'transparent',
              color: mode === m.id ? colors.accent.primary : colors.text.muted,
              fontSize: 13,
              fontFamily: fonts.body,
              fontWeight: mode === m.id ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {mode === 'journey' && <JourneyView />}
        {mode === 'files' && <FilesView />}
        {mode === 'pipeline' && <PipelineList />}
      </div>
    </div>
  );
}
