import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useThreadStore } from '../../stores/thread-store.js';
import { useEventStore } from '../../stores/event-store.js';
import { useGraphStore } from '../../stores/graph-store.js';
import { colors, alpha, fonts } from '../../theme/tokens.js';
import { formatDuration } from '../../utils/format-time.js';
import type { ThreadSummary, ThreadPhase } from '@hudai/shared';

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

/** Strip XML-like tags, tool IDs, and other artifacts from prompt text */
function stripTags(text: string): string {
  const cleaned = text
    .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/toolu_[a-zA-Z0-9_-]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Filter out non-human content
  if (cleaned.length <= 3) return '';
  if (/^caveat:/i.test(cleaned)) return '';
  if (/^\/\w+/.test(cleaned)) return '';
  if (/^[a-z0-9]{8,}$/i.test(cleaned)) return ''; // bare IDs
  return cleaned;
}

const PHASE_LABELS: Record<ThreadPhase, string> = {
  investigating: 'Investigating',
  implementing: 'Implementing',
  testing: 'Testing',
  done: 'Done',
  error: 'Error',
};

const PHASE_COLORS: Record<ThreadPhase, string> = {
  investigating: colors.action.search,
  implementing: colors.action.edit,
  testing: colors.action.test,
  done: colors.status.successLight,
  error: colors.status.errorLight,
};

const PHASE_ORDER: ThreadPhase[] = ['investigating', 'implementing', 'testing', 'done'];

const FILE_ACTION_PRIORITY: Record<string, number> = {
  'file.read': 1, 'search.grep': 1, 'search.glob': 1,
  'file.edit': 3, 'file.create': 4, 'file.delete': 5,
};

const FILE_ACTION_COLORS: Record<string, string> = {
  read: colors.action.read,
  edit: colors.action.edit,
  create: colors.action.create,
  delete: colors.action.delete,
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}


interface FileTouch {
  path: string;
  fullPath: string;
  action: 'read' | 'edit' | 'create' | 'delete';
  count: number;
}

function buildFileTouches(events: any[], startedAt: number, nextStart: number): FileTouch[] {
  const fileMap = new Map<string, { action: string; priority: number; count: number; fullPath: string }>();

  for (const ev of events) {
    if (ev.timestamp < startedAt || ev.timestamp >= nextStart) continue;
    const priority = FILE_ACTION_PRIORITY[ev.type];
    if (priority === undefined) continue;

    const path: string = (ev as any).data?.path;
    if (!path) continue;

    const existing = fileMap.get(path);
    if (!existing || priority > existing.priority) {
      fileMap.set(path, {
        action: ev.type.startsWith('search') ? 'read' : ev.type.split('.')[1],
        priority,
        count: (existing?.count || 0) + 1,
        fullPath: path,
      });
    } else {
      existing.count++;
    }
  }

  return Array.from(fileMap.entries())
    .map(([, v]) => ({
      path: v.fullPath.split('/').pop() || v.fullPath,
      fullPath: v.fullPath,
      action: v.action as FileTouch['action'],
      count: v.count,
    }))
    .sort((a, b) => {
      const ap = { delete: 4, create: 3, edit: 2, read: 1 }[a.action] || 0;
      const bp = { delete: 4, create: 3, edit: 2, read: 1 }[b.action] || 0;
      return bp - ap;
    });
}

/** Build client-side threads from events when server threads are not available */
function buildClientThreads(events: any[]): ThreadSummary[] {
  const latestTs = events.length > 0 ? events[events.length - 1].timestamp : Date.now();
  const cutoff = latestTs - TWELVE_HOURS;
  const threads: ThreadSummary[] = [];
  let current: ThreadSummary | null = null;

  for (const ev of events) {
    if (ev.timestamp < cutoff) continue;

    if (ev.type === 'task.start') {
      if (current && current.phase !== 'done' && current.phase !== 'error') {
        current.phase = 'done';
        current.completedAt = ev.timestamp;
        current.outcome = { type: 'success' };
      }

      const prompt = stripTags((ev.data?.prompt || '').trim());
      if (!prompt) continue;

      current = {
        threadId: ev.id,
        sessionId: ev.sessionId,
        prompt: prompt.slice(0, 500),
        startedAt: ev.timestamp,
        completedAt: null,
        phase: 'investigating',
        summary: null,
        bullets: null,
        outcome: { type: 'working' },
        eventCount: 1,
      };
      threads.push(current);
      continue;
    }

    if (!current) continue;
    current.eventCount++;

    if (['file.edit', 'file.create', 'file.delete'].includes(ev.type)) {
      if (['investigating'].includes(current.phase)) current.phase = 'implementing';
    } else if (['test.run', 'test.result', 'shell.run'].includes(ev.type)) {
      if (['investigating', 'implementing'].includes(current.phase)) current.phase = 'testing';
    } else if (ev.type === 'agent.error') {
      current.phase = 'error';
      current.outcome = { type: 'error' };
    }
  }

  return threads;
}

function PhasePipeline({ phase }: { phase: ThreadPhase }) {
  const activeIdx = phase === 'error' ? -1 : PHASE_ORDER.indexOf(phase);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {PHASE_ORDER.slice(0, 3).map((p, i) => {
        const reached = phase === 'error' ? false : i <= activeIdx;
        const isCurrent = phase !== 'done' && phase !== 'error' && i === activeIdx;
        const color = reached ? PHASE_COLORS[p] : colors.text.dimmed;
        return (
          <div key={p} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && <div style={{ width: 12, height: 1, background: reached ? color : alpha(colors.text.dimmed, 0.3) }} />}
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: reached ? color : 'transparent',
              border: `1.5px solid ${color}`,
              boxShadow: isCurrent ? `0 0 6px ${color}` : 'none',
            }} title={PHASE_LABELS[p]} />
          </div>
        );
      })}
      <span style={{
        marginLeft: 6, fontSize: 8, fontFamily: fonts.mono,
        color: PHASE_COLORS[phase], textTransform: 'uppercase',
        letterSpacing: '0.04em', fontWeight: 600,
      }}>
        {PHASE_LABELS[phase]}
      </span>
    </div>
  );
}

function JourneyTaskCard({
  thread,
  isActive,
  isSelected,
  files,
  onHoverStart,
  onHoverEnd,
  onClick,
}: {
  thread: ThreadSummary;
  isActive: boolean;
  isSelected: boolean;
  files: FileTouch[];
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onClick: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isComplete = thread.phase === 'done' || thread.phase === 'error';

  const borderColor = isSelected
    ? colors.accent.blue
    : isActive
      ? colors.accent.primary
      : isComplete
        ? (thread.phase === 'error' ? colors.status.error : colors.status.success)
        : colors.text.dimmed;

  const edits = files.filter(f => f.action === 'edit' || f.action === 'create').length;
  const reads = files.filter(f => f.action === 'read').length;

  return (
    <div
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      style={{
        borderLeft: `2px solid ${borderColor}`,
        marginBottom: 4,
        background: isSelected
          ? alpha(colors.accent.blue, 0.1)
          : isActive ? alpha(colors.accent.primary, 0.06) : alpha(colors.bg.card, 0.5),
        borderRadius: 3,
        overflow: 'hidden',
        transition: 'background 0.15s ease',
      }}
    >
      {/* Header */}
      <div
        onClick={() => { setExpanded(!expanded); onClick(); }}
        style={{
          padding: '5px 8px 3px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 6,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 8, color: colors.text.dimmed, flexShrink: 0, marginTop: 2 }}>
            {expanded ? '▾' : '▸'}
          </span>
          <span style={{
            fontFamily: fonts.mono, fontSize: 10, fontWeight: 600,
            color: colors.text.primary, wordBreak: 'break-word',
            flex: 1, lineHeight: 1.4,
          }}>
            {(() => { const p = stripTags(thread.prompt); return p.length > 80 ? p.slice(0, 80) + '...' : p; })()}
          </span>
        </div>
        <span style={{
          fontSize: 8, fontFamily: fonts.mono,
          color: colors.text.dimmed, whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {formatTime(thread.startedAt)}
        </span>
      </div>

      {/* Collapsed: phase + file counts */}
      {!expanded && (
        <div style={{
          padding: '1px 8px 4px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <PhasePipeline phase={thread.phase} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {edits > 0 && (
              <span style={{ fontSize: 7, fontFamily: fonts.mono, color: colors.action.edit }}>
                {edits} edited
              </span>
            )}
            {reads > 0 && (
              <span style={{ fontSize: 7, fontFamily: fonts.mono, color: colors.action.read }}>
                {reads} read
              </span>
            )}
            <span style={{ fontSize: 7, fontFamily: fonts.mono, color: colors.text.dimmed }}>
              {formatDuration(thread.startedAt, thread.completedAt)}
            </span>
          </div>
        </div>
      )}

      {/* Expanded */}
      {expanded && (
        <div style={{ padding: '0 8px 5px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0 4px' }}>
            <PhasePipeline phase={thread.phase} />
            <span style={{ fontSize: 8, fontFamily: fonts.mono, color: colors.text.dimmed }}>
              {formatDuration(thread.startedAt, thread.completedAt)}
            </span>
          </div>

          {/* Summary */}
          {thread.summary && (
            <div style={{
              fontFamily: fonts.mono, fontSize: 9, color: colors.text.secondary,
              lineHeight: 1.4, padding: '0 0 3px 14px', fontStyle: 'italic',
            }}>
              {thread.summary}
            </div>
          )}

          {/* Bullets */}
          {thread.bullets && thread.bullets.length > 0 && (
            <div style={{ padding: '2px 0 3px 14px' }}>
              {thread.bullets.map((b, i) => (
                <div key={i} style={{
                  fontFamily: fonts.mono, fontSize: 9, color: colors.text.secondary,
                  lineHeight: 1.5, display: 'flex', gap: 4,
                }}>
                  <span style={{ color: colors.text.dimmed, flexShrink: 0 }}>-</span>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          )}

          {/* File touches */}
          {files.length > 0 && (
            <div style={{ padding: '3px 0 2px', display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {files.slice(0, 12).map((f, i) => (
                <span
                  key={i}
                  title={`${f.fullPath} (${f.action} x${f.count})`}
                  style={{
                    fontSize: 7, fontFamily: fonts.mono,
                    color: FILE_ACTION_COLORS[f.action] || colors.text.dimmed,
                    background: alpha(FILE_ACTION_COLORS[f.action] || colors.text.dimmed, 0.12),
                    padding: '1px 4px', borderRadius: 2,
                    borderLeft: `2px solid ${FILE_ACTION_COLORS[f.action] || colors.text.dimmed}`,
                    whiteSpace: 'nowrap', maxWidth: 90,
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {f.path}
                </span>
              ))}
              {files.length > 12 && (
                <span style={{ fontSize: 7, fontFamily: fonts.mono, color: colors.text.dimmed }}>
                  +{files.length - 12}
                </span>
              )}
            </div>
          )}

          {/* Event count */}
          <div style={{ fontSize: 8, fontFamily: fonts.mono, color: colors.text.dimmed, marginTop: 2 }}>
            {thread.eventCount} events
          </div>
        </div>
      )}
    </div>
  );
}

export function JourneyPanel() {
  const serverThreads = useThreadStore((s) => s.threads);
  const events = useEventStore((s) => s.events);
  const setJourney = useGraphStore((s) => s.setJourney);
  const clearJourney = useGraphStore((s) => s.clearJourney);
  const pathToId = useGraphStore((s) => s.pathToId);
  const nodeMap = useGraphStore((s) => s.nodeMap);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const autoExpandedGroupsRef = useRef<Set<string>>(new Set());

  const threads = useMemo(() => {
    if (serverThreads.length > 0) return serverThreads;
    return buildClientThreads(events);
  }, [serverThreads, events]);

  // Build per-thread file touches
  const threadFiles = useMemo(() => {
    const map = new Map<string, FileTouch[]>();
    for (let i = 0; i < threads.length; i++) {
      const thread = threads[i];
      const nextStart = i + 1 < threads.length ? threads[i + 1].startedAt : Infinity;
      map.set(thread.threadId, buildFileTouches(events, thread.startedAt, nextStart));
    }
    return map;
  }, [threads, events]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [threads.length]);

  // Clear highlights on unmount
  useEffect(() => {
    return () => {
      clearJourney();
      // Collapse auto-expanded groups on unmount
      if (autoExpandedGroupsRef.current.size > 0) {
        const { expandedGroups } = useGraphStore.getState();
        const next = new Set(expandedGroups);
        for (const g of autoExpandedGroupsRef.current) next.delete(g);
        autoExpandedGroupsRef.current.clear();
        useGraphStore.setState({ expandedGroups: next });
      }
    };
  }, [clearJourney]);

  const collapseAutoExpanded = useCallback(() => {
    if (autoExpandedGroupsRef.current.size === 0) return;
    const { expandedGroups } = useGraphStore.getState();
    const next = new Set(expandedGroups);
    for (const g of autoExpandedGroupsRef.current) next.delete(g);
    autoExpandedGroupsRef.current.clear();
    useGraphStore.setState({ expandedGroups: next });
  }, []);

  const highlightTask = useCallback((threadId: string) => {
    const files = threadFiles.get(threadId);
    if (!files || files.length === 0) {
      return;
    }

    // Collapse any previously auto-expanded groups first
    collapseAutoExpanded();

    const highlights = new Map<string, 'read' | 'edit' | 'create' | 'delete'>();
    const trail: string[] = [];

    // Use fresh store state to avoid stale closures
    const { nodeMap: freshNodeMap, pathToId: freshPathToId, expandedGroups } = useGraphStore.getState();
    const groupsToExpand = new Set<string>();

    for (const f of files) {
      const nodeId = freshNodeMap.has(f.fullPath) ? f.fullPath : freshPathToId.get(f.fullPath);
      if (nodeId) {
        highlights.set(nodeId, f.action);
        trail.push(nodeId);
        // Check if this file's group needs expanding
        const fileNode = freshNodeMap.get(nodeId);
        if (fileNode) {
          const parts = fileNode.group.split('/');
          let current = '';
          for (let i = 0; i < parts.length; i++) {
            current = i === 0 ? parts[i] : current + '/' + parts[i];
            if (!expandedGroups.has(current)) {
              groupsToExpand.add(current);
            }
          }
        }
      }
    }

    // Auto-expand groups so file nodes are visible on the map
    if (groupsToExpand.size > 0) {
      const next = new Set(expandedGroups);
      for (const g of groupsToExpand) {
        next.add(g);
        autoExpandedGroupsRef.current.add(g);
      }
      useGraphStore.setState({ expandedGroups: next });
    }

    if (highlights.size > 0) {
      setJourney(trail, highlights);
    }
  }, [threadFiles, setJourney, collapseAutoExpanded]);

  const handleHoverStart = useCallback((threadId: string) => {
    if (selectedTaskId) return; // don't override pinned selection
    highlightTask(threadId);
  }, [selectedTaskId, highlightTask]);

  const handleHoverEnd = useCallback(() => {
    if (selectedTaskId) return; // keep pinned selection
    clearJourney();
    collapseAutoExpanded();
  }, [selectedTaskId, clearJourney, collapseAutoExpanded]);

  const handleClick = useCallback((threadId: string) => {
    if (selectedTaskId === threadId) {
      // Deselect
      setSelectedTaskId(null);
      clearJourney();
      collapseAutoExpanded();
    } else {
      setSelectedTaskId(threadId);
      highlightTask(threadId);
    }
  }, [selectedTaskId, highlightTask, clearJourney, collapseAutoExpanded]);

  const activeThreadId = threads.length > 0 && !threads[threads.length - 1].completedAt
    ? threads[threads.length - 1].threadId
    : null;

  // Auto-select the latest thread by default and track it live
  const latestThreadId = threads.length > 0 ? threads[threads.length - 1].threadId : null;
  useEffect(() => {
    if (!latestThreadId) return;
    // Auto-select if nothing is selected, or if the selected task is the previous latest (follow mode)
    const prevSelected = selectedTaskId;
    if (!prevSelected || prevSelected !== latestThreadId) {
      setSelectedTaskId(latestThreadId);
      highlightTask(latestThreadId);
    }
  }, [latestThreadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-highlight when files change for the selected task (live update)
  useEffect(() => {
    if (selectedTaskId) {
      highlightTask(selectedTaskId);
    }
  }, [threadFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      paddingTop: 36,
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 10px',
        borderBottom: `1px solid ${colors.border.subtle}`,
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{
            fontSize: 10,
            fontFamily: fonts.display,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: colors.text.muted,
            textTransform: 'uppercase',
          }}>
            Tasks
          </span>
          <span style={{
            fontSize: 10,
            fontFamily: fonts.mono,
            color: colors.text.dimmed,
          }}>
            {threads.length} tasks
          </span>
        </div>
      </div>

      {/* Task cards */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '4px 4px',
        }}
      >
        {threads.length === 0 ? (
          <div style={{
            padding: '20px 12px',
            fontSize: 11,
            color: colors.text.muted,
            textAlign: 'center',
            fontFamily: fonts.mono,
          }}>
            No tasks yet
          </div>
        ) : (
          [...threads].reverse().filter((t) => stripTags(t.prompt).length > 0).map((thread) => (
            <JourneyTaskCard
              key={thread.threadId}
              thread={thread}
              isActive={thread.threadId === activeThreadId}
              isSelected={thread.threadId === selectedTaskId}
              files={threadFiles.get(thread.threadId) || []}
              onHoverStart={() => handleHoverStart(thread.threadId)}
              onHoverEnd={handleHoverEnd}
              onClick={() => handleClick(thread.threadId)}
            />
          ))
        )}
      </div>
    </div>
  );
}
