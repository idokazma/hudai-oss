import { useState } from 'react';
import type { AVPEvent } from '@hudai/shared';
import { colors, fonts, alpha, EVENT_COLORS } from '../../theme/tokens.js';
import { AgentBadge } from './AgentBadge.js';
import { ThinkingDetail } from './ThinkingDetail.js';

function getLabel(event: AVPEvent): string {
  switch (event.type) {
    case 'file.read': return event.data.path.split('/').pop() ?? 'Read';
    case 'file.edit': return event.data.path.split('/').pop() ?? 'Edit';
    case 'file.create': return event.data.path.split('/').pop() ?? 'New';
    case 'file.delete': return event.data.path.split('/').pop() ?? 'Del';
    case 'shell.run': {
      const cmd = event.data.command;
      if (cmd.length > 16) return cmd.slice(0, 16) + '…';
      return cmd;
    }
    case 'search.grep': return event.data.pattern.slice(0, 12);
    case 'search.glob': return event.data.pattern.slice(0, 12);
    case 'think.start': {
      const summary = event.data.summary || 'Thinking';
      return summary.slice(0, 12);
    }
    case 'think.end': {
      const secs = Math.round(event.data.durationMs / 1000);
      return secs > 0 ? `${secs}s` : 'done';
    }
    case 'subagent.start': return (event as any).data.agentType;
    case 'subagent.end': return (event as any).data.agentType;
    case 'memory.change': return event.data.path.split('/').pop() ?? 'Memory';
    case 'tool.complete': return event.data.toolName;
    case 'context.compaction': {
      const countBefore = event.data.eventCountBefore;
      return countBefore ? `${countBefore} events` : 'compact';
    }
    case 'loop.warning': return (event as any).data.pattern.split(':')[0];
    case 'task.start': return event.data.prompt.slice(0, 16) + (event.data.prompt.length > 16 ? '…' : '');
    case 'task.complete': return 'Done';
    case 'agent.error': return 'Error';
    case 'permission.prompt': return `${event.data.tool}`;
    case 'test.run': return 'test';
    case 'test.result': return `${event.data.passed}/${event.data.total}`;
    default: return event.type.split('.')[1] ?? event.type;
  }
}

function getTag(event: AVPEvent): string {
  switch (event.type) {
    case 'file.read': return 'R';
    case 'file.edit': return 'E';
    case 'file.create': return 'W';
    case 'file.delete': return 'D';
    case 'shell.run': return '$';
    case 'search.grep': case 'search.glob': return '?';
    case 'think.start': return '~';
    case 'think.end': return '~';
    case 'subagent.start': return '▶';
    case 'subagent.end': return '■';
    case 'memory.change': return 'M';
    case 'tool.complete': return '✓';
    case 'context.compaction': return '⟳';
    case 'loop.warning': return '⟲';
    case 'task.start': return '❯';
    case 'task.complete': return '✓';
    case 'agent.error': return '!';
    case 'permission.prompt': return '⚠';
    case 'test.run': case 'test.result': return 'T';
    default: return '·';
  }
}

/** Estimate duration in ms for height encoding */
function estimateDuration(event: AVPEvent): number {
  if (event.type === 'think.end') return event.data.durationMs;
  if (event.type === 'test.result') return event.data.durationMs;
  if (event.type === 'shell.output') return event.data.durationMs;
  // Default estimates by type
  if (event.type === 'shell.run') return 3000;
  if (event.type === 'think.start') return 2000;
  if (event.type === 'test.run') return 5000;
  return 500;
}

interface TimelineBlockProps {
  event: AVPEvent;
  isLatest: boolean;
}

export function TimelineBlock({ event, isLatest }: TimelineBlockProps) {
  const [showDetail, setShowDetail] = useState(false);
  const color = EVENT_COLORS[event.type] ?? colors.text.muted;
  const label = getLabel(event);
  const tag = getTag(event);
  const durationMs = estimateDuration(event);
  const isThinking = event.type === 'think.start';
  const isCompaction = event.type === 'context.compaction';
  const hasPopover = isThinking || isCompaction;

  // Height: min 36px, max 100px based on duration (0-10s scale)
  const heightPx = Math.max(36, Math.min(100, 36 + (durationMs / 10000) * 64));

  return (
    <div
      title={hasPopover ? undefined : `${event.type}: ${label} (${Math.round(durationMs / 1000)}s)`}
      onMouseEnter={hasPopover ? () => setShowDetail(true) : undefined}
      onMouseLeave={hasPopover ? () => setShowDetail(false) : undefined}
      style={{
        width: 32,
        height: heightPx,
        borderRadius: 4,
        background: isLatest ? `${color}cc` : `${color}22`,
        borderTop: `3px solid ${color}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: 4,
        fontSize: 10,
        fontFamily: fonts.mono,
        color: isLatest ? colors.text.white : colors.text.muted,
        cursor: 'pointer',
        flexShrink: 0,
        boxShadow: isLatest ? `0 0 10px ${color}55` : 'none',
        transition: 'all 0.15s',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Tag at top */}
      <span style={{
        fontWeight: 700,
        fontSize: 11,
        color: isLatest ? colors.text.white : color,
        lineHeight: 1,
      }}>
        {tag}
      </span>

      {/* Vertical label */}
      {heightPx > 50 && (
        <span style={{
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
          fontSize: 10,
          marginTop: 4,
          color: isLatest ? alpha(colors.text.white, 0.8) : colors.text.muted,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxHeight: heightPx - 30,
          lineHeight: 1,
          letterSpacing: 0.3,
        }}>
          {label}
        </span>
      )}

      {/* Agent badge */}
      {event.agentId && (
        <div style={{
          position: 'absolute',
          bottom: 2,
          left: 1,
          maxWidth: 30,
          overflow: 'hidden',
        }}>
          <AgentBadge agentType={
            event.type === 'subagent.start' ? (event as any).data.agentType :
            event.type === 'subagent.end' ? (event as any).data.agentType :
            'sub'
          } />
        </div>
      )}

      {/* Permission status dot */}
      {event.permission && (
        <div style={{
          position: 'absolute',
          bottom: 2,
          right: 2,
          width: 6,
          height: 6,
          borderRadius: '50%',
          background:
            event.permission.status === 'allowed' ? colors.status.success :
            event.permission.status === 'prompted' ? colors.accent.muted :
            colors.status.error,
          boxShadow: `0 0 3px ${
            event.permission.status === 'allowed' ? colors.status.success :
            event.permission.status === 'prompted' ? colors.accent.muted :
            colors.status.error
          }`,
        }} />
      )}

      {/* Thinking detail popover */}
      {isThinking && showDetail && (
        <ThinkingDetail
          summary={event.data.summary || ''}
          fullLength={event.data.fullLength}
        />
      )}

      {/* Compaction detail popover */}
      {isCompaction && showDetail && event.data.eventDistribution && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: 8,
          background: colors.bg.card,
          border: `1px solid ${colors.border.subtle}`,
          borderRadius: 6,
          padding: '10px 12px',
          width: 220,
          zIndex: 100,
          boxShadow: colors.surface.shadow,
          pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: colors.action.compaction, fontWeight: 600, marginBottom: 6 }}>
            Compaction — {event.data.eventCountBefore ?? '?'} events
          </div>
          {Object.entries(event.data.eventDistribution)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 8)
            .map(([type, count]) => (
              <div key={type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontFamily: fonts.mono, color: colors.text.secondary, lineHeight: 1.6 }}>
                <span style={{ color: EVENT_COLORS[type] || colors.text.muted }}>{type}</span>
                <span>{count}</span>
              </div>
            ))
          }
          <div style={{
            position: 'absolute', bottom: -5, left: '50%',
            transform: 'translateX(-50%) rotate(45deg)',
            width: 8, height: 8, background: colors.bg.card,
            borderRight: `1px solid ${colors.border.subtle}`,
            borderBottom: `1px solid ${colors.border.subtle}`,
          }} />
        </div>
      )}

      {/* Active glow overlay */}
      {isLatest && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(180deg, ${color}33 0%, transparent 100%)`,
          borderRadius: 4,
          animation: 'glow-pulse 1.5s ease-in-out infinite',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}

/** Color legend categories */
export const TIMELINE_LEGEND: { label: string; color: string }[] = [
  { label: 'Read', color: colors.action.read },
  { label: 'Edit', color: colors.action.edit },
  { label: 'Think', color: colors.action.think },
  { label: 'Test', color: colors.action.test },
  { label: 'Bash', color: colors.action.bash },
  { label: 'Search', color: colors.action.search },
];
