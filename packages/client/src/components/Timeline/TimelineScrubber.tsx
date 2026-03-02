import { useCallback, useRef, useState } from 'react';
import { useReplayStore } from '../../stores/replay-store.js';
import { DecisionReplayView } from './DecisionReplayView.js';
import { colors, fonts, alpha } from '../../theme/tokens.js';

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

const SPEEDS = [1, 2, 4, 8];

export function TimelineScrubber() {
  const events = useReplayStore((s) => s.events);
  const cursor = useReplayStore((s) => s.cursor);
  const playing = useReplayStore((s) => s.playing);
  const speed = useReplayStore((s) => s.speed);
  const decisions = useReplayStore((s) => s.decisions);
  const setCursor = useReplayStore((s) => s.setCursor);
  const play = useReplayStore((s) => s.play);
  const pause = useReplayStore((s) => s.pause);
  const setSpeed = useReplayStore((s) => s.setSpeed);
  const stepForward = useReplayStore((s) => s.stepForward);
  const stepBackward = useReplayStore((s) => s.stepBackward);
  const stepDecisionForward = useReplayStore((s) => s.stepDecisionForward);
  const stepDecisionBackward = useReplayStore((s) => s.stepDecisionBackward);
  const [decisionMode, setDecisionMode] = useState(false);

  const trackRef = useRef<HTMLDivElement>(null);

  const progress = events.length > 1 ? cursor / (events.length - 1) : 0;
  const currentTs = events[cursor]?.timestamp;
  const totalDurationMs = events.length > 1 ? events[events.length - 1].timestamp - events[0].timestamp : 0;
  const totalDurationSec = Math.round(totalDurationMs / 1000);

  const handleTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current || events.length === 0) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    const index = Math.round(percent * (events.length - 1));
    setCursor(index);
  }, [events.length, setCursor]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!trackRef.current || events.length === 0) return;

    const track = trackRef.current;

    const onMove = (ev: MouseEvent) => {
      const rect = track.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const percent = Math.max(0, Math.min(1, x / rect.width));
      const index = Math.round(percent * (events.length - 1));
      setCursor(index);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [events.length, setCursor]);

  if (events.length === 0) return null;

  const btnStyle: React.CSSProperties = {
    background: 'none',
    border: `1px solid ${colors.border.subtle}`,
    borderRadius: 3,
    color: colors.text.secondary,
    cursor: 'pointer',
    fontSize: 12,
    width: 28,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    lineHeight: 1,
  };

  return (
    <>
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 16px',
      background: colors.bg.panel,
      borderTop: `1px solid ${colors.border.subtle}`,
      flexShrink: 0,
    }}>
      {/* Decision mode toggle */}
      {decisions.length > 0 && (
        <button
          onClick={() => setDecisionMode(!decisionMode)}
          style={{
            ...btnStyle,
            width: 'auto',
            paddingInline: 6,
            fontSize: 10,
            fontFamily: fonts.mono,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            background: decisionMode ? alpha(colors.action.think, 0.2) : 'none',
            borderColor: decisionMode ? colors.action.think : colors.border.subtle,
            color: decisionMode ? colors.action.think : colors.text.muted,
          }}
          title="Toggle decision-level navigation"
        >
          Dec
        </button>
      )}

      {/* Transport controls */}
      <button onClick={() => setCursor(0)} style={btnStyle} title="Start">
        ⏮
      </button>
      <button onClick={decisionMode ? stepDecisionBackward : stepBackward} style={btnStyle} title={decisionMode ? 'Previous decision' : 'Step back'}>
        ◀
      </button>
      <button
        onClick={playing ? pause : play}
        style={{
          ...btnStyle,
          width: 32,
          background: playing ? colors.accent.blue + '22' : 'none',
          borderColor: playing ? colors.accent.blue : colors.border.subtle,
          color: playing ? colors.accent.blueLight : colors.text.secondary,
        }}
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <button onClick={decisionMode ? stepDecisionForward : stepForward} style={btnStyle} title={decisionMode ? 'Next decision' : 'Step forward'}>
        ▶
      </button>
      <button onClick={() => setCursor(events.length - 1)} style={btnStyle} title="End">
        ⏭
      </button>

      {/* Progress track */}
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        style={{
          flex: 1,
          height: 12,
          background: colors.surface.hover,
          borderRadius: 6,
          position: 'relative',
          cursor: 'pointer',
          minWidth: 80,
        }}
      >
        {/* Filled portion */}
        <div style={{
          width: `${progress * 100}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${colors.accent.blue}88, ${colors.accent.blue})`,
          borderRadius: 6,
          transition: playing ? 'none' : 'width 0.15s ease',
        }} />
        {/* Playhead knob */}
        <div
          onMouseDown={handleDragStart}
          style={{
            position: 'absolute',
            top: -2,
            left: `calc(${progress * 100}% - 8px)`,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: colors.accent.blueLight,
            border: `2px solid ${colors.accent.blue}`,
            boxShadow: `0 0 6px ${colors.accent.blue}66`,
            cursor: 'grab',
            transition: playing ? 'none' : 'left 0.15s ease',
          }}
        />
      </div>

      {/* Time info */}
      <span style={{
        fontSize: 11,
        fontFamily: fonts.mono,
        color: colors.text.muted,
        flexShrink: 0,
        minWidth: 60,
        textAlign: 'right',
      }}>
        {currentTs ? formatTimestamp(currentTs) : '--:--:--'}
      </span>
      <span style={{
        fontSize: 11,
        fontFamily: fonts.mono,
        color: colors.text.muted,
        flexShrink: 0,
      }}>
        {cursor + 1}/{events.length}
      </span>

      {/* Speed selector */}
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            style={{
              ...btnStyle,
              width: 24,
              fontSize: 11,
              fontFamily: fonts.mono,
              background: speed === s ? colors.accent.blue + '33' : 'none',
              borderColor: speed === s ? colors.accent.blue : colors.border.subtle,
              color: speed === s ? colors.accent.blueLight : colors.text.muted,
            }}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* Duration */}
      <span style={{
        fontSize: 11,
        fontFamily: fonts.mono,
        color: colors.text.muted,
        flexShrink: 0,
      }}>
        {totalDurationSec}s
      </span>
    </div>

    {/* Decision replay panel */}
    {decisionMode && decisions.length > 0 && (
      <div style={{
        borderTop: `1px solid ${colors.border.subtle}`,
        background: colors.bg.panel,
        height: 160,
        display: 'flex',
      }}>
        <DecisionReplayView />
      </div>
    )}
    </>
  );
}
