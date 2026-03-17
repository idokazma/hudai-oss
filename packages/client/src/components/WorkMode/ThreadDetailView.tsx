import { useMemo } from 'react';
import { useThreadStore } from '../../stores/thread-store.js';
import { useEventStore } from '../../stores/event-store.js';
import { colors, fonts, alpha } from '../../theme/tokens.js';
import type { ThreadPhase } from '@hudai/shared';

// ── Constants ──────────────────────────────────────────────

const PHASE_LABELS: Record<ThreadPhase, string> = {
  investigating: 'Investigating',
  implementing: 'Implementing',
  testing: 'Testing',
  done: 'Done',
  error: 'Error',
};

const PHASE_COLORS: Record<ThreadPhase, string> = {
  investigating: '#1abc9c',
  implementing: '#2ecc71',
  testing: '#d4763c',
  done: '#52b788',
  error: '#e74c3c',
};

const FILE_EVENTS = new Set(['file.read', 'file.edit', 'file.create', 'file.delete']);
const ACTION_EVENTS = new Set([
  'file.read', 'file.edit', 'file.create', 'file.delete',
  'search.grep', 'search.glob',
  'shell.run', 'shell.output',
  'think.start',
  'test.run', 'test.result',
  'subagent.start', 'subagent.end',
  'agent.error', 'context.compaction',
]);

type FileAction = 'read' | 'edit' | 'create' | 'delete';

const ACTION_COLORS: Record<string, string> = {
  read: colors.action.read,
  edit: colors.action.edit,
  create: colors.action.create,
  delete: colors.action.delete,
};

const ACTION_ICONS: Record<string, string> = {
  read: '◉',
  edit: '✎',
  create: '+',
  delete: '×',
};

// ── Helpers ────────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(startMs: number, endMs: number | null): string {
  const end = endMs ?? Date.now();
  const secs = Math.round((end - startMs) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
}

// ── Data structures ────────────────────────────────────────

interface FileNode {
  path: string;
  filename: string;
  dir: string;
  action: FileAction;
  visitCount: number;
  firstVisit: number;
  connections: string[]; // paths visited immediately after this one
}

interface ActionEntry {
  type: string;
  label: string;
  timestamp: number;
  color: string;
  icon: string;
  isError?: boolean;
}

function buildFileGraph(events: any[]): { nodes: FileNode[]; actions: ActionEntry[] } {
  const nodeMap = new Map<string, FileNode>();
  const actions: ActionEntry[] = [];
  const actionPriority: Record<string, number> = { delete: 4, create: 3, edit: 2, read: 1 };
  let lastFilePath: string | null = null;

  for (const ev of events) {
    if (!ACTION_EVENTS.has(ev.type)) continue;
    const d = ev.data || {};

    // File events → build graph nodes
    if (FILE_EVENTS.has(ev.type)) {
      const path = d.path;
      if (!path) continue;
      const action = ev.type.split('.')[1] as FileAction;
      const parts = path.split('/');
      const filename = parts.pop() || path;
      const dir = parts.length > 2 ? '.../' + parts.slice(-2).join('/') : parts.join('/');

      let node = nodeMap.get(path);
      if (!node) {
        node = { path, filename, dir, action, visitCount: 0, firstVisit: ev.timestamp, connections: [] };
        nodeMap.set(path, node);
      }
      node.visitCount++;
      if ((actionPriority[action] || 0) > (actionPriority[node.action] || 0)) {
        node.action = action;
      }

      // Track connections
      if (lastFilePath && lastFilePath !== path) {
        const lastNode = nodeMap.get(lastFilePath);
        if (lastNode && !lastNode.connections.includes(path)) {
          lastNode.connections.push(path);
        }
      }
      lastFilePath = path;
      continue;
    }

    // Non-file actions
    if (ev.type === 'think.start') {
      actions.push({ type: 'think', label: (d.summary || 'Thinking...').slice(0, 50), timestamp: ev.timestamp, color: colors.action.think, icon: '◆' });
    } else if (ev.type === 'shell.run') {
      actions.push({ type: 'shell', label: (d.command || '').slice(0, 50), timestamp: ev.timestamp, color: colors.action.bash, icon: '▶' });
    } else if (ev.type === 'shell.output' && d.exitCode !== 0 && d.exitCode !== '0') {
      actions.push({ type: 'shell', label: `Exit ${d.exitCode}`, timestamp: ev.timestamp, color: colors.action.error, icon: '!', isError: true });
    } else if (ev.type === 'test.run') {
      actions.push({ type: 'test', label: 'Test: ' + (d.command || '').slice(0, 40), timestamp: ev.timestamp, color: colors.action.test, icon: '⬡' });
    } else if (ev.type === 'test.result') {
      const failed = d.failed ?? 0;
      actions.push({ type: 'test', label: `${d.passed ?? 0} passed, ${failed} failed`, timestamp: ev.timestamp, color: failed > 0 ? colors.action.error : colors.action.edit, icon: '⬡', isError: failed > 0 });
    } else if (ev.type === 'search.grep') {
      actions.push({ type: 'search', label: `grep "${(d.pattern || '').slice(0, 30)}" → ${d.matchCount ?? '?'}`, timestamp: ev.timestamp, color: colors.action.search, icon: '⌕' });
    } else if (ev.type === 'search.glob') {
      actions.push({ type: 'search', label: `glob "${(d.pattern || '').slice(0, 30)}" → ${d.matchCount ?? '?'}`, timestamp: ev.timestamp, color: colors.action.search, icon: '⌕' });
    } else if (ev.type === 'subagent.start') {
      actions.push({ type: 'subagent', label: `Subagent: ${d.type || d.agentId || ''}`, timestamp: ev.timestamp, color: colors.action.subagent, icon: '◎' });
    } else if (ev.type === 'agent.error') {
      actions.push({ type: 'error', label: (d.message || 'Error').slice(0, 50), timestamp: ev.timestamp, color: colors.action.error, icon: '!', isError: true });
    } else if (ev.type === 'context.compaction') {
      actions.push({ type: 'compaction', label: 'Context compaction', timestamp: ev.timestamp, color: colors.action.compaction, icon: '⟳' });
    }
  }

  // Sort file nodes: edited files first, then by visit count
  const nodes = Array.from(nodeMap.values()).sort((a, b) => {
    const ap = actionPriority[a.action] || 0;
    const bp = actionPriority[b.action] || 0;
    if (ap !== bp) return bp - ap;
    return b.visitCount - a.visitCount;
  });

  return { nodes, actions };
}

// ── Main Component ─────────────────────────────────────────

export function ThreadDetailView() {
  const selectedId = useThreadStore((s) => s.selectedThreadId);
  const threads = useThreadStore((s) => s.threads);
  const selectThread = useThreadStore((s) => s.selectThread);
  const events = useEventStore((s) => s.events);

  const thread = threads.find((t) => t.threadId === selectedId);

  const threadEvents = useMemo(() => {
    if (!thread) return [];
    const nextThread = threads
      .filter((t) => t.startedAt > thread.startedAt)
      .sort((a, b) => a.startedAt - b.startedAt)[0];
    const nextStart = nextThread ? nextThread.startedAt : Infinity;
    return events.filter(
      (ev) => ev.timestamp >= thread.startedAt && ev.timestamp < nextStart
    );
  }, [thread, threads, events]);

  const { nodes: fileNodes, actions } = useMemo(() => buildFileGraph(threadEvents), [threadEvents]);

  if (!thread) return null;

  const phaseColor = PHASE_COLORS[thread.phase];
  const edits = fileNodes.filter(n => n.action === 'edit' || n.action === 'create').length;
  const reads = fileNodes.filter(n => n.action === 'read').length;
  const deletes = fileNodes.filter(n => n.action === 'delete').length;

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: colors.bg.primary,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 5,
    }}>
      {/* ── Header ── */}
      <div style={{
        padding: '10px 16px',
        borderBottom: `1px solid ${colors.border.subtle}`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 8, fontFamily: fonts.mono, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.05em',
            color: phaseColor, background: alpha(phaseColor, 0.15),
            padding: '2px 6px', borderRadius: 3, flexShrink: 0,
          }}>
            {PHASE_LABELS[thread.phase]}
          </span>
          <span style={{
            fontFamily: fonts.mono, fontSize: 13, fontWeight: 600,
            color: colors.text.primary, flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {thread.prompt}
          </span>
          <span style={{ fontSize: 9, fontFamily: fonts.mono, color: colors.text.dimmed, flexShrink: 0 }}>
            {formatTime(thread.startedAt)} · {formatDuration(thread.startedAt, thread.completedAt)}
          </span>
          <button
            onClick={() => selectThread(null)}
            style={{
              background: alpha(colors.text.dimmed, 0.15), border: 'none', borderRadius: 4,
              color: colors.text.muted, cursor: 'pointer', padding: '3px 8px',
              fontSize: 10, fontFamily: fonts.mono, flexShrink: 0,
            }}
          >
            ✕ Close
          </button>
        </div>
        {thread.summary && (
          <div style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.text.secondary, marginTop: 4, fontStyle: 'italic' }}>
            {thread.summary}
          </div>
        )}
        {/* Stats bar */}
        <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
          <StatBadge label={`${fileNodes.length} files`} color={colors.text.muted} />
          {edits > 0 && <StatBadge label={`${edits} edited`} color={colors.action.edit} />}
          {reads > 0 && <StatBadge label={`${reads} read`} color={colors.action.read} />}
          {deletes > 0 && <StatBadge label={`${deletes} deleted`} color={colors.action.delete} />}
          <StatBadge label={`${actions.length} actions`} color={colors.text.dimmed} />
        </div>
      </div>

      {/* ── Content: Code Map + Actions Timeline ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Left: File Code Map */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: 16,
        }}>
          <div style={{
            fontSize: 9, fontFamily: fonts.mono, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.05em',
            color: colors.text.dimmed, marginBottom: 12,
          }}>
            Code Map — {fileNodes.length} files touched
          </div>

          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8,
            alignContent: 'flex-start',
          }}>
            {fileNodes.map((node) => {
              const c = ACTION_COLORS[node.action] || colors.text.dimmed;
              const icon = ACTION_ICONS[node.action] || '•';
              return (
                <div
                  key={node.path}
                  style={{
                    background: alpha(c, 0.08),
                    border: `1px solid ${alpha(c, 0.25)}`,
                    borderRadius: 6,
                    padding: '8px 12px',
                    minWidth: 120,
                    maxWidth: 200,
                    position: 'relative',
                    transition: 'transform 0.1s ease, box-shadow 0.1s ease',
                    cursor: 'default',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.03)';
                    e.currentTarget.style.boxShadow = `0 0 16px ${alpha(c, 0.2)}`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  title={node.path}
                >
                  {/* Action badge */}
                  <div style={{
                    position: 'absolute', top: -5, right: -5,
                    fontSize: 7, fontFamily: fonts.mono, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    color: c, background: colors.bg.primary,
                    border: `1px solid ${alpha(c, 0.4)}`,
                    padding: '1px 4px', borderRadius: 3,
                  }}>
                    {node.action}
                  </div>

                  {/* Icon + filename */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14, color: c, lineHeight: 1 }}>{icon}</span>
                    <span style={{
                      fontFamily: fonts.mono, fontSize: 11, fontWeight: 600,
                      color: colors.text.primary,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {node.filename}
                    </span>
                  </div>

                  {/* Directory */}
                  {node.dir && (
                    <div style={{
                      fontFamily: fonts.mono, fontSize: 8, color: colors.text.dimmed,
                      marginTop: 2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {node.dir}
                    </div>
                  )}

                  {/* Visit count */}
                  {node.visitCount > 1 && (
                    <div style={{
                      fontFamily: fonts.mono, fontSize: 8, color: alpha(c, 0.7),
                      marginTop: 3,
                    }}>
                      {node.visitCount} visits
                    </div>
                  )}

                  {/* Connection dots */}
                  {node.connections.length > 0 && (
                    <div style={{
                      display: 'flex', gap: 3, marginTop: 4,
                    }}>
                      {node.connections.slice(0, 4).map((conn, i) => {
                        const connNode = fileNodes.find(n => n.path === conn);
                        const connColor = connNode ? ACTION_COLORS[connNode.action] || colors.text.dimmed : colors.text.dimmed;
                        const connName = conn.split('/').pop() || conn;
                        return (
                          <span key={i} style={{
                            fontSize: 7, fontFamily: fonts.mono,
                            color: connColor, background: alpha(connColor, 0.12),
                            padding: '1px 3px', borderRadius: 2,
                          }} title={`→ ${conn}`}>
                            →{connName}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {fileNodes.length === 0 && (
              <div style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.text.dimmed, padding: 20 }}>
                No files touched
              </div>
            )}
          </div>

          {/* Bullets */}
          {thread.bullets && thread.bullets.length > 0 && (
            <div style={{
              marginTop: 20, padding: '10px 14px',
              background: alpha(phaseColor, 0.05),
              border: `1px solid ${alpha(phaseColor, 0.15)}`,
              borderRadius: 6,
            }}>
              <div style={{
                fontSize: 8, fontFamily: fonts.mono, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.05em',
                color: colors.text.dimmed, marginBottom: 6,
              }}>
                Summary
              </div>
              {thread.bullets.map((b, i) => (
                <div key={i} style={{
                  fontFamily: fonts.mono, fontSize: 10, color: colors.text.secondary,
                  display: 'flex', gap: 6, marginBottom: 2,
                }}>
                  <span style={{ color: phaseColor, flexShrink: 0 }}>›</span>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Actions Timeline */}
        <div style={{
          width: 260, borderLeft: `1px solid ${colors.border.subtle}`,
          overflowY: 'auto', padding: '12px 0', flexShrink: 0,
        }}>
          <div style={{
            fontSize: 9, fontFamily: fonts.mono, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.05em',
            color: colors.text.dimmed, padding: '0 12px 8px',
          }}>
            Actions ({actions.length})
          </div>
          {actions.map((a, i) => (
            <div key={i} style={{
              padding: '3px 12px', display: 'flex', gap: 8,
              alignItems: 'flex-start', opacity: a.isError ? 1 : 0.85,
            }}>
              <span style={{
                fontSize: 8, fontFamily: fonts.mono, color: colors.text.dimmed,
                flexShrink: 0, width: 52, textAlign: 'right',
              }}>
                {formatTime(a.timestamp)}
              </span>
              <span style={{ fontSize: 10, color: a.color, flexShrink: 0, lineHeight: 1.3 }}>
                {a.icon}
              </span>
              <span style={{
                fontFamily: fonts.mono, fontSize: 9,
                color: a.isError ? colors.status.errorLight : colors.text.secondary,
                lineHeight: 1.4, wordBreak: 'break-word',
              }}>
                {a.label}
              </span>
            </div>
          ))}
          {actions.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: 10, fontFamily: fonts.mono, color: colors.text.dimmed }}>
              No actions
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatBadge({ label, color }: { label: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
      <span style={{ fontFamily: fonts.mono, fontSize: 9, color }}>{label}</span>
    </div>
  );
}
