import { useRef, useEffect, useMemo } from 'react';
import { useEventStore } from '../../stores/event-store.js';
import { colors, fonts, TOOL_COLORS } from '../../theme/tokens.js';
import type { AVPEvent } from '@hudai/shared';

const LANE_HEIGHT = 22;
const BAR_HEIGHT = 16;
const LEFT_LABEL_WIDTH = 80;
const MIN_BAR_WIDTH = 4;

interface ToolSpan {
  toolName: string;
  toolUseId: string;
  startMs: number;
  durationMs: number;
  agentId: string;
  color: string;
}

export function WaterfallView() {
  const events = useEventStore((s) => s.events);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build tool spans from event pairs
  const { spans, lanes, timeRange } = useMemo(() => {
    const toolStarts = new Map<string, { name: string; ts: number; agentId: string }>();
    const result: ToolSpan[] = [];

    for (const ev of events) {
      // Track tool starts by matching tool_use events
      if (ev.type === 'file.read' || ev.type === 'file.edit' || ev.type === 'file.create' ||
          ev.type === 'shell.run' || ev.type === 'search.grep' || ev.type === 'search.glob') {
        // Use event id as a stand-in for tool_use_id since we don't have it
        toolStarts.set(ev.id, { name: ev.type.split('.')[0], ts: ev.timestamp, agentId: ev.agentId || 'root' });
      }

      // Match tool.complete events
      if (ev.type === 'tool.complete') {
        const data = (ev as any).data;
        result.push({
          toolName: data.toolName,
          toolUseId: data.toolUseId,
          startMs: ev.timestamp - data.durationMs,
          durationMs: data.durationMs,
          agentId: ev.agentId || 'root',
          color: TOOL_COLORS[data.toolName] || colors.action.control,
        });
      }

      // Add thinking blocks as translucent spans
      if (ev.type === 'think.start') {
        const data = (ev as any).data;
        // Estimate thinking duration from fullLength or default 2s
        const estimatedDuration = data.fullLength ? Math.min(data.fullLength * 2, 10000) : 2000;
        result.push({
          toolName: 'think',
          toolUseId: ev.id,
          startMs: ev.timestamp,
          durationMs: estimatedDuration,
          agentId: ev.agentId || 'root',
          color: colors.action.think,
        });
      }
    }

    // Compute lanes (unique agent IDs)
    const laneSet = new Set<string>();
    for (const s of result) laneSet.add(s.agentId);
    const laneArr = ['root', ...Array.from(laneSet).filter((l) => l !== 'root')];

    // Time range
    let minTs = Infinity, maxTs = -Infinity;
    for (const s of result) {
      minTs = Math.min(minTs, s.startMs);
      maxTs = Math.max(maxTs, s.startMs + s.durationMs);
    }
    if (!isFinite(minTs)) { minTs = 0; maxTs = 1000; }

    return { spans: result, lanes: laneArr, timeRange: { min: minTs, max: maxTs } };
  }, [events]);

  // Auto-scroll right
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [spans.length]);

  const totalDuration = Math.max(timeRange.max - timeRange.min, 1000);
  // 1 pixel per 50ms, minimum 600px
  const timelineWidth = Math.max(600, totalDuration / 50);

  if (spans.length === 0) {
    return (
      <div style={{ color: colors.text.muted, fontSize: 13, padding: '16px' }}>
        Waiting for tool completions to show waterfall...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Lane labels */}
      <div style={{
        width: LEFT_LABEL_WIDTH,
        flexShrink: 0,
        borderRight: `1px solid ${colors.border.subtle}`,
        paddingTop: 2,
      }}>
        {lanes.map((lane) => (
          <div
            key={lane}
            style={{
              height: LANE_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 8,
              fontSize: 11,
              fontFamily: fonts.mono,
              color: lane === 'root' ? colors.text.secondary : colors.action.subagent,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {lane === 'root' ? 'Main' : lane.slice(0, 8)}
          </div>
        ))}
      </div>

      {/* Scrollable timeline area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
      >
        <div style={{
          width: timelineWidth,
          position: 'relative',
          minHeight: lanes.length * LANE_HEIGHT,
        }}>
          {/* Lane grid lines */}
          {lanes.map((lane, i) => (
            <div
              key={`grid-${lane}`}
              style={{
                position: 'absolute',
                top: i * LANE_HEIGHT,
                left: 0,
                right: 0,
                height: LANE_HEIGHT,
                borderBottom: `1px solid ${colors.surface.base}`,
              }}
            />
          ))}

          {/* Time markers */}
          {Array.from({ length: Math.ceil(totalDuration / 5000) + 1 }, (_, i) => {
            const ms = i * 5000;
            const x = (ms / totalDuration) * timelineWidth;
            return (
              <div key={`time-${i}`} style={{
                position: 'absolute',
                top: 0,
                left: x,
                height: '100%',
                borderLeft: `1px solid ${colors.surface.hover}`,
              }}>
                <span style={{
                  position: 'absolute',
                  top: -1,
                  left: 4,
                  fontSize: 10,
                  fontFamily: fonts.mono,
                  color: colors.text.dimmed,
                }}>
                  {(ms / 1000).toFixed(0)}s
                </span>
              </div>
            );
          })}

          {/* Tool spans */}
          {spans.map((span) => {
            const laneIndex = lanes.indexOf(span.agentId);
            if (laneIndex < 0) return null;
            const left = ((span.startMs - timeRange.min) / totalDuration) * timelineWidth;
            const width = Math.max(MIN_BAR_WIDTH, (span.durationMs / totalDuration) * timelineWidth);
            const top = laneIndex * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2;
            const isThinking = span.toolName === 'think';

            return (
              <div
                key={span.toolUseId}
                title={`${span.toolName} — ${span.durationMs}ms`}
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width,
                  height: BAR_HEIGHT,
                  borderRadius: 3,
                  background: isThinking ? `${span.color}44` : `${span.color}aa`,
                  border: `1px solid ${span.color}`,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: 4,
                }}
              >
                {width > 30 && (
                  <span style={{
                    fontSize: 10,
                    fontFamily: fonts.mono,
                    color: colors.text.white,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {span.toolName}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
