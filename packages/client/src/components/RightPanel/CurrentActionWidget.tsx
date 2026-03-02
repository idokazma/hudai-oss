import { useMemo, useState, useEffect, useRef } from 'react';
import { useEventStore } from '../../stores/event-store.js';
import { colors, fonts } from '../../theme/tokens.js';
import type { AVPEvent } from '@hudai/shared';

interface ActionInfo {
  id: string;
  tool: string;
  color: string;
  glyph: string;
  target: string;
  detail: string | null;
  /** Expandable extra info (command output, file path, etc.) */
  extra: string | null;
  inProgress: boolean;
  startedAt: number;
  /** Batch count when consecutive same-tool events are merged */
  batchCount?: number;
  /** Individual targets in a batch */
  batchItems?: string[];
}

/** Tools that get batched when they appear consecutively */
const BATCHABLE_TOOLS = new Set(['READ', 'GREP', 'GLOB']);

function batchActions(actions: ActionInfo[]): ActionInfo[] {
  const result: ActionInfo[] = [];
  for (const action of actions) {
    const prev = result[result.length - 1];
    if (
      prev &&
      BATCHABLE_TOOLS.has(action.tool) &&
      prev.tool === action.tool &&
      !action.inProgress
    ) {
      // Merge into previous
      prev.batchCount = (prev.batchCount ?? 1) + 1;
      if (!prev.batchItems) prev.batchItems = [prev.target];
      prev.batchItems.push(action.target);
      prev.target = `${prev.batchCount} files`;
      prev.extra = prev.batchItems.join('\n');
      prev.detail = null;
    } else {
      result.push({ ...action });
    }
  }
  return result;
}

function eventToAction(event: AVPEvent): ActionInfo | null {
  const ts = event.timestamp;
  const id = event.id;

  switch (event.type) {
    case 'file.read':
      return {
        id, tool: 'READ', color: colors.action.read, glyph: '◆',
        target: shortenPath(event.data.path),
        detail: null, extra: event.data.path,
        inProgress: false, startedAt: ts,
      };
    case 'file.edit': {
      const d = event.data;
      const diff = (d.additions || d.deletions)
        ? `+${d.additions ?? 0} / -${d.deletions ?? 0}`
        : null;
      return {
        id, tool: 'EDIT', color: colors.action.edit, glyph: '●',
        target: shortenPath(d.path),
        detail: diff, extra: d.path,
        inProgress: false, startedAt: ts,
      };
    }
    case 'file.create':
      return {
        id, tool: 'CREATE', color: colors.action.edit, glyph: '+',
        target: shortenPath(event.data.path),
        detail: `${event.data.lineCount ?? 0} lines`, extra: event.data.path,
        inProgress: false, startedAt: ts,
      };
    case 'file.delete':
      return {
        id, tool: 'DELETE', color: colors.action.error, glyph: '×',
        target: shortenPath(event.data.path),
        detail: null, extra: event.data.path,
        inProgress: false, startedAt: ts,
      };
    case 'shell.run':
      return {
        id, tool: 'BASH', color: colors.action.bash, glyph: '▶',
        target: truncate(event.data.command, 40),
        detail: null, extra: event.data.command,
        inProgress: true, startedAt: ts,
      };
    case 'shell.output': {
      const d = event.data;
      const exitBadge = d.exitCode === 0 ? 'exit 0' : `exit ${d.exitCode}`;
      const dur = d.durationMs ? `${Math.round(d.durationMs / 1000)}s` : '';
      return {
        id, tool: 'BASH', color: d.exitCode === 0 ? colors.action.bash : colors.action.error,
        glyph: d.exitCode === 0 ? '✓' : '✕',
        target: exitBadge,
        detail: dur || null, extra: d.stderr ? truncate(d.stderr, 200) : d.stdout ? truncate(d.stdout, 200) : null,
        inProgress: false, startedAt: ts,
      };
    }
    case 'think.start':
      return {
        id, tool: 'THINK', color: colors.action.think, glyph: '◎',
        target: event.data.summary ? truncate(event.data.summary, 40) : 'Reasoning...',
        detail: null, extra: event.data.summary ?? null,
        inProgress: true, startedAt: ts,
      };
    case 'think.end':
      return {
        id, tool: 'THINK', color: colors.action.think, glyph: '◎',
        target: event.data.summary ? truncate(event.data.summary, 40) : 'Done thinking',
        detail: event.data.durationMs ? `${Math.round(event.data.durationMs / 1000)}s` : null,
        extra: event.data.summary ?? null,
        inProgress: false, startedAt: ts,
      };
    case 'search.grep':
      return {
        id, tool: 'GREP', color: colors.action.search, glyph: '⊕',
        target: truncate(event.data.pattern, 30),
        detail: `${event.data.matchCount ?? 0} matches`, extra: event.data.pattern,
        inProgress: false, startedAt: ts,
      };
    case 'search.glob':
      return {
        id, tool: 'GLOB', color: colors.action.search, glyph: '⊕',
        target: truncate(event.data.pattern, 30),
        detail: `${event.data.matchCount ?? 0} files`, extra: event.data.pattern,
        inProgress: false, startedAt: ts,
      };
    case 'test.run':
      return {
        id, tool: 'TEST', color: colors.action.test, glyph: '▷',
        target: truncate(event.data.command ?? 'Running tests', 40),
        detail: null, extra: event.data.command ?? null,
        inProgress: true, startedAt: ts,
      };
    case 'test.result': {
      const d = event.data;
      const ok = d.failed === 0;
      return {
        id, tool: 'TEST', color: ok ? colors.action.test : colors.action.error,
        glyph: ok ? '✓' : '✕',
        target: ok ? `${d.passed}/${d.total} passed` : `${d.failed} failed`,
        detail: d.durationMs ? `${Math.round(d.durationMs / 1000)}s` : null,
        extra: d.failures?.map((f: any) => f.name || f.file).join(', ') ?? null,
        inProgress: false, startedAt: ts,
      };
    }
    case 'permission.prompt':
      return {
        id, tool: 'APPROVE', color: colors.status.warning, glyph: '⚠',
        target: `${event.data.tool}: ${truncate(event.data.command, 30)}`,
        detail: 'Waiting for approval',
        extra: `${event.data.tool}: ${event.data.command}`,
        inProgress: true, startedAt: ts,
      };
    case 'agent.error':
      return {
        id, tool: 'ERROR', color: colors.action.error, glyph: '!',
        target: truncate(event.data.message, 40),
        detail: null, extra: event.data.message,
        inProgress: false, startedAt: ts,
      };
    default:
      return null;
  }
}

function shortenPath(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 2) return path;
  return '.../' + parts.slice(-2).join('/');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function DurationTicker({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span>{elapsed}s</span>;
}

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 5) return 'now';
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}

const MAX_FEED_ITEMS = 30;

export function CurrentActionWidget() {
  const events = useEventStore((s) => s.events);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Build action feed from recent events, batching consecutive same-type reads
  const actions = useMemo(() => {
    const raw: ActionInfo[] = [];
    // Scan last N events for actionable items
    const start = Math.max(0, events.length - MAX_FEED_ITEMS * 3);
    for (let i = start; i < events.length; i++) {
      const a = eventToAction(events[i]);
      if (a) raw.push(a);
    }
    // Batch consecutive READ/GREP/GLOB, then trim
    return batchActions(raw).slice(-MAX_FEED_ITEMS);
  }, [events]);

  const latestAction = actions.length > 0 ? actions[actions.length - 1] : null;

  // Auto-scroll to bottom when new actions arrive
  useEffect(() => {
    if (feedRef.current && autoScrollRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [actions.length]);

  const handleScroll = () => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40;
  };

  if (actions.length === 0) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        borderBottom: `1px solid ${colors.border.subtle}`,
      }}>
        {/* Header */}
        <div style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderBottom: `1px solid ${colors.border.subtle}`,
        }}>
          <span style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: colors.text.muted,
          }}>
            Activity Feed
          </span>
        </div>
        <div style={{
          height: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: colors.text.muted,
          fontSize: 12,
          fontFamily: fonts.mono,
        }}>
          Waiting for agent activity...
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      overflow: 'hidden',
    }}>
      {/* Live action header — always shows latest */}
      {latestAction && (
        <div style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderBottom: `1px solid ${colors.border.subtle}`,
          background: `${latestAction.color}08`,
          flexShrink: 0,
        }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 700,
            background: `${latestAction.color}22`,
            border: `2px solid ${latestAction.color}55`,
            color: latestAction.color,
            flexShrink: 0,
            boxShadow: latestAction.inProgress ? `0 0 10px ${latestAction.color}33` : 'none',
          }}>
            {latestAction.glyph}
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 12,
                fontFamily: fonts.mono,
                fontWeight: 700,
                letterSpacing: 1.5,
                color: latestAction.color,
              }}>
                {latestAction.tool}
              </span>
              {latestAction.inProgress && (
                <span style={{ fontSize: 10, fontFamily: fonts.mono, color: latestAction.color, opacity: 0.7 }}>
                  <DurationTicker startedAt={latestAction.startedAt} />
                </span>
              )}
              {latestAction.detail && (
                <span style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.text.muted }}>
                  {latestAction.detail}
                </span>
              )}
            </div>
            <div style={{
              fontSize: 12,
              fontFamily: fonts.mono,
              color: colors.text.secondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {latestAction.target}
            </div>
          </div>
        </div>
      )}

      {/* Scrollable feed */}
      <div
        ref={feedRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {actions.map((action) => {
          const isExpanded = expandedId === action.id;
          const isHovered = hoveredId === action.id;
          const isLatest = action === latestAction;

          return (
            <div
              key={action.id}
              onClick={() => setExpandedId(isExpanded ? null : action.id)}
              onMouseEnter={() => setHoveredId(action.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '5px 12px',
                cursor: action.extra ? 'pointer' : 'default',
                background: isHovered ? colors.surface.base : isLatest ? `${action.color}05` : 'transparent',
                borderBottom: `1px solid ${colors.surface.base}`,
                transition: 'background 0.15s',
              }}
            >
              {/* Glyph */}
              <span
                style={{
                  fontSize: 12,
                  color: action.color,
                  opacity: isLatest ? 1 : 0.6,
                  width: 14,
                  textAlign: 'center',
                  flexShrink: 0,
                  marginTop: 2,
                }}
                title={action.tool}
              >
                {action.glyph}
              </span>

              {/* Content */}
              <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    fontSize: 11,
                    fontFamily: fonts.mono,
                    fontWeight: 600,
                    color: action.color,
                    opacity: isLatest ? 1 : 0.7,
                    letterSpacing: 0.5,
                  }}>
                    {action.tool}
                    {action.batchCount && action.batchCount > 1 && (
                      <span style={{ opacity: 0.6, marginLeft: 2 }}>×{action.batchCount}</span>
                    )}
                  </span>
                  <span style={{
                    fontSize: 11,
                    fontFamily: fonts.mono,
                    color: colors.text.secondary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}>
                    {action.target}
                  </span>
                  {action.detail && (
                    <span style={{
                      fontSize: 10,
                      fontFamily: fonts.mono,
                      color: colors.text.muted,
                      flexShrink: 0,
                    }}>
                      {action.detail}
                    </span>
                  )}
                  {action.inProgress && (
                    <span style={{
                      fontSize: 10,
                      fontFamily: fonts.mono,
                      color: action.color,
                      flexShrink: 0,
                    }}>
                      <DurationTicker startedAt={action.startedAt} />
                    </span>
                  )}
                </div>

                {/* Expanded detail */}
                {isExpanded && action.extra && (
                  <div style={{
                    marginTop: 4,
                    padding: '4px 6px',
                    background: colors.surface.base,
                    borderRadius: 3,
                    border: `1px solid ${colors.border.subtle}`,
                    fontSize: 11,
                    fontFamily: fonts.mono,
                    color: colors.text.secondary,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: 80,
                    overflowY: 'auto',
                  }}>
                    {action.extra}
                  </div>
                )}

                {/* Hover tooltip-like inline detail */}
                {isHovered && !isExpanded && action.extra && action.extra !== action.target && (
                  <div style={{
                    marginTop: 2,
                    fontSize: 10,
                    fontFamily: fonts.mono,
                    color: colors.text.muted,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {truncate(action.extra, 60)}
                  </div>
                )}
              </div>

              {/* Timestamp */}
              <span style={{
                fontSize: 10,
                fontFamily: fonts.mono,
                color: colors.text.muted,
                flexShrink: 0,
                marginTop: 3,
                opacity: 0.6,
              }}>
                {timeAgo(action.startedAt)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
