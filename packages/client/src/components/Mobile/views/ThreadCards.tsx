import { useState, useEffect, useRef, useMemo } from 'react';
import { useThreadStore } from '../../../stores/thread-store.js';
import { useEventStore } from '../../../stores/event-store.js';
import { colors, fonts, alpha, EVENT_COLORS } from '../../../theme/tokens.js';
import { formatDuration } from '../../../utils/format-time.js';
import type { ThreadSummary, ThreadPhase } from '@hudai/shared';

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

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

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}


/** Build client-side threads from events when server threads are not available */
function buildClientThreads(events: any[]): ThreadSummary[] {
  // Use latest event as anchor — "last active 12 hours" not "last 12 clock hours"
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

      const prompt = (ev.data?.prompt || '').trim();
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

    // Detect phase from event type
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
            {i > 0 && (
              <div
                style={{
                  width: 16,
                  height: 1,
                  background: reached ? color : alpha(colors.text.dimmed, 0.3),
                }}
              />
            )}
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: reached ? color : 'transparent',
                border: `1.5px solid ${color}`,
                boxShadow: isCurrent ? `0 0 6px ${color}` : 'none',
                animation: isCurrent ? 'threadPulse 2s ease-in-out infinite' : 'none',
              }}
              title={PHASE_LABELS[p]}
            />
          </div>
        );
      })}
      <span
        style={{
          marginLeft: 8,
          fontSize: 9,
          fontFamily: fonts.mono,
          color: PHASE_COLORS[phase],
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          fontWeight: 600,
        }}
      >
        {PHASE_LABELS[phase]}
      </span>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: ThreadSummary['outcome'] }) {
  if (!outcome || outcome.type === 'working') return null;

  const bg = outcome.type === 'success'
    ? alpha(colors.status.success, 0.2)
    : alpha(colors.status.error, 0.2);
  const color = outcome.type === 'success'
    ? colors.status.successLight
    : colors.status.errorLight;

  return (
    <span
      style={{
        fontSize: 8,
        fontFamily: fonts.mono,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color,
        background: bg,
        padding: '1px 5px',
        borderRadius: 3,
        whiteSpace: 'nowrap',
      }}
    >
      {outcome.label || outcome.type}
    </span>
  );
}

// File touch types and their priority (higher = more significant action)
const FILE_ACTION_PRIORITY: Record<string, number> = {
  'file.read': 1,
  'search.grep': 1,
  'search.glob': 1,
  'file.edit': 3,
  'file.create': 4,
  'file.delete': 5,
};

const FILE_ACTION_COLORS: Record<string, string> = {
  read: colors.action.read,
  edit: colors.action.edit,
  create: colors.action.create,
  delete: colors.action.delete,
};

interface FileTouch {
  path: string;        // short filename
  fullPath: string;    // full relative path
  action: 'read' | 'edit' | 'create' | 'delete';
  count: number;       // times touched
}

/** Extract file touches from events in a thread's time window */
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

  // Convert to array, sort: edits/creates first, then reads
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

/** Count non-file actions (shell, think, test) */
function buildActionCounts(events: any[], startedAt: number, nextStart: number): { shell: number; think: number; test: number } {
  let shell = 0, think = 0, test = 0;
  for (const ev of events) {
    if (ev.timestamp < startedAt || ev.timestamp >= nextStart) continue;
    if (ev.type === 'shell.run') shell++;
    else if (ev.type === 'think.start') think++;
    else if (ev.type === 'test.run') test++;
  }
  return { shell, think, test };
}

function MiniCodeMap({ files, actionCounts }: { files: FileTouch[]; actionCounts: { shell: number; think: number; test: number } }) {
  if (files.length === 0 && !actionCounts.shell && !actionCounts.think && !actionCounts.test) return null;

  const MAX_FILES = 12;
  const shown = files.slice(0, MAX_FILES);
  const remaining = files.length - MAX_FILES;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* File dots */}
      {shown.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
          {shown.map((f, i) => (
            <span
              key={i}
              title={`${f.fullPath} (${f.action} x${f.count})`}
              style={{
                fontSize: 8,
                fontFamily: fonts.mono,
                color: FILE_ACTION_COLORS[f.action] || colors.text.dimmed,
                background: alpha(FILE_ACTION_COLORS[f.action] || colors.text.dimmed, 0.12),
                padding: '1px 4px',
                borderRadius: 2,
                borderLeft: `2px solid ${FILE_ACTION_COLORS[f.action] || colors.text.dimmed}`,
                whiteSpace: 'nowrap',
                maxWidth: 100,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {f.path}
            </span>
          ))}
          {remaining > 0 && (
            <span style={{ fontSize: 8, fontFamily: fonts.mono, color: colors.text.dimmed }}>
              +{remaining}
            </span>
          )}
        </div>
      )}
      {/* Non-file action badges */}
      {(actionCounts.shell > 0 || actionCounts.think > 0 || actionCounts.test > 0) && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {actionCounts.think > 0 && (
            <span style={{ fontSize: 7, fontFamily: fonts.mono, color: colors.action.think, opacity: 0.7 }}>
              think x{actionCounts.think}
            </span>
          )}
          {actionCounts.shell > 0 && (
            <span style={{ fontSize: 7, fontFamily: fonts.mono, color: colors.action.bash, opacity: 0.7 }}>
              shell x{actionCounts.shell}
            </span>
          )}
          {actionCounts.test > 0 && (
            <span style={{ fontSize: 7, fontFamily: fonts.mono, color: colors.action.test, opacity: 0.7 }}>
              test x{actionCounts.test}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ThreadCard({
  thread,
  isActive,
  expandedContent,
  files,
  actionCounts,
}: {
  thread: ThreadSummary;
  isActive: boolean;
  expandedContent: string[];
  files: FileTouch[];
  actionCounts: { shell: number; think: number; test: number };
}) {
  const [expanded, setExpanded] = useState(false);
  const [proseExpanded, setProseExpanded] = useState(false);
  const isComplete = thread.phase === 'done' || thread.phase === 'error';

  const borderColor = isActive
    ? colors.accent.primary
    : isComplete
      ? (thread.phase === 'error' ? colors.status.error : colors.status.success)
      : colors.text.dimmed;

  return (
    <div
      style={{
        borderLeft: `2px solid ${borderColor}`,
        marginBottom: 6,
        background: isActive ? alpha(colors.accent.primary, 0.06) : alpha(colors.bg.card, 0.5),
        borderRadius: 3,
        overflow: 'hidden',
        animation: isActive ? 'threadBorderPulse 3s ease-in-out infinite' : 'none',
      }}
    >
      {/* Header: prompt + time (click to expand, double-click to open detail) */}
      <div
        onClick={() => setExpanded(!expanded)}
        onDoubleClick={() => useThreadStore.getState().selectThread(thread.threadId)}
        style={{
          padding: '6px 10px 4px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: 9,
              color: colors.text.dimmed,
              flexShrink: 0,
              marginTop: 2,
            }}
          >
            {expanded ? '▾' : '▸'}
          </span>
          <span
            style={{
              fontFamily: fonts.mono,
              fontSize: 11,
              fontWeight: 600,
              color: colors.text.primary,
              wordBreak: 'break-word',
              flex: 1,
              lineHeight: 1.4,
            }}
          >
            {thread.prompt.length > 120 ? thread.prompt.slice(0, 120) + '...' : thread.prompt}
          </span>
        </div>
        <span
          style={{
            fontSize: 9,
            fontFamily: fonts.mono,
            color: colors.text.dimmed,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {formatTime(thread.startedAt)}
        </span>
      </div>

      {/* Mini code map — always visible */}
      {(files.length > 0 || actionCounts.shell > 0 || actionCounts.think > 0 || actionCounts.test > 0) && (
        <div style={{ padding: '0 10px 4px' }}>
          <MiniCodeMap files={files} actionCounts={actionCounts} />
        </div>
      )}

      {/* Collapsed footer: phase + outcome + duration */}
      {!expanded && (
        <div
          style={{
            padding: '2px 10px 5px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PhasePipeline phase={thread.phase} />
            <OutcomeBadge outcome={thread.outcome} />
          </div>
          <span style={{ fontSize: 9, fontFamily: fonts.mono, color: colors.text.dimmed }}>
            {formatDuration(thread.startedAt, thread.completedAt)}
          </span>
        </div>
      )}

      {/* Level 1 expand: LLM summary + bullets */}
      {expanded && (
        <div style={{ padding: '0 10px 6px' }}>
          {/* Phase pipeline */}
          <div style={{ padding: '2px 0 6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <PhasePipeline phase={thread.phase} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <OutcomeBadge outcome={thread.outcome} />
                <span style={{ fontSize: 9, fontFamily: fonts.mono, color: colors.text.dimmed }}>
                  {formatDuration(thread.startedAt, thread.completedAt)}
                </span>
              </div>
            </div>
          </div>

          {/* Summary line */}
          {thread.summary && (
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                color: colors.text.secondary,
                lineHeight: 1.4,
                padding: '0 0 4px 16px',
                fontStyle: 'italic',
              }}
            >
              {thread.summary}
            </div>
          )}

          {/* Bullet summary */}
          {thread.bullets && thread.bullets.length > 0 && (
            <div style={{ padding: '2px 0 4px 16px' }}>
              {thread.bullets.map((bullet, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 10,
                    color: colors.text.secondary,
                    lineHeight: 1.5,
                    display: 'flex',
                    gap: 5,
                  }}
                >
                  <span style={{ color: colors.text.dimmed, flexShrink: 0 }}>-</span>
                  <span>{bullet}</span>
                </div>
              ))}
            </div>
          )}

          {/* No summary yet */}
          {!thread.summary && !thread.bullets && (
            <div style={{ padding: '0 0 4px 16px', fontFamily: fonts.mono, fontSize: 10, color: colors.text.dimmed }}>
              {isActive ? '...' : 'No summary available'}
            </div>
          )}

          {/* Event count + expand prose toggle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0 0' }}>
            <span style={{ fontSize: 9, fontFamily: fonts.mono, color: colors.text.dimmed }}>
              {thread.eventCount} events
            </span>
            {expandedContent.length > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setProseExpanded(!proseExpanded); }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '1px 4px',
                  fontSize: 9,
                  fontFamily: fonts.mono,
                  color: colors.text.muted,
                }}
              >
                {proseExpanded ? '▲ Hide' : '▼ Show'} agent prose ({expandedContent.length})
              </button>
            )}
          </div>

          {/* Level 2 expand: raw agent prose */}
          {proseExpanded && expandedContent.length > 0 && (
            <div
              style={{
                borderTop: `1px solid ${alpha(colors.border.subtle, 0.5)}`,
                marginTop: 4,
                padding: '4px 0 2px',
                overflowY: 'auto',
              }}
            >
              {expandedContent.map((text, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 10,
                    color: colors.text.secondary,
                    lineHeight: 1.4,
                    padding: '2px 0',
                    borderBottom: i < expandedContent.length - 1
                      ? `1px solid ${alpha(colors.border.subtle, 0.3)}`
                      : 'none',
                  }}
                >
                  {text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ThreadCards() {
  const serverThreads = useThreadStore((s) => s.threads);
  const events = useEventStore((s) => s.events);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Merge server threads with client-side fallback
  const threads = useMemo(() => {
    if (serverThreads.length > 0) return serverThreads;
    return buildClientThreads(events);
  }, [serverThreads, events]);

  // Build per-thread maps: expanded content, file touches, and action counts
  const { expandedMap, filesMap, actionCountsMap } = useMemo(() => {
    const expanded = new Map<string, string[]>();
    const files = new Map<string, FileTouch[]>();
    const counts = new Map<string, { shell: number; think: number; test: number }>();
    if (threads.length === 0) return { expandedMap: expanded, filesMap: files, actionCountsMap: counts };

    for (let i = 0; i < threads.length; i++) {
      const thread = threads[i];
      const nextStart = i + 1 < threads.length ? threads[i + 1].startedAt : Infinity;
      const texts: string[] = [];

      for (const ev of events) {
        if (ev.timestamp < thread.startedAt || ev.timestamp >= nextStart) continue;
        if (ev.type === 'raw.output') {
          const text = ((ev as any).data?.text || '').trim();
          if (text && text.length >= 10) {
            texts.push(text);
          }
        }
      }
      expanded.set(thread.threadId, texts);
      files.set(thread.threadId, buildFileTouches(events, thread.startedAt, nextStart));
      counts.set(thread.threadId, buildActionCounts(events, thread.startedAt, nextStart));
    }
    return { expandedMap: expanded, filesMap: files, actionCountsMap: counts };
  }, [threads, events]);

  // Auto-scroll on new threads
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threads.length, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  };

  // Find active thread (last one without completedAt)
  const activeThreadId = threads.length > 0 && !threads[threads.length - 1].completedAt
    ? threads[threads.length - 1].threadId
    : null;

  return (
    <>
      <style>{`
        @keyframes threadPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes threadBorderPulse {
          0%, 100% { border-left-color: ${colors.accent.primary}; }
          50% { border-left-color: ${alpha(colors.accent.primary, 0.4)}; }
        }
      `}</style>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '4px 4px',
          minHeight: 0,
        }}
      >
        {threads.length === 0 ? (
          <div
            style={{
              padding: 20,
              textAlign: 'center',
              color: colors.text.dimmed,
              fontSize: 11,
              fontFamily: fonts.mono,
            }}
          >
            Waiting for tasks...
          </div>
        ) : (
          threads.map((thread) => (
            <ThreadCard
              key={thread.threadId}
              thread={thread}
              isActive={thread.threadId === activeThreadId}
              expandedContent={expandedMap.get(thread.threadId) || []}
              files={filesMap.get(thread.threadId) || []}
              actionCounts={actionCountsMap.get(thread.threadId) || { shell: 0, think: 0, test: 0 }}
            />
          ))
        )}
      </div>
    </>
  );
}
