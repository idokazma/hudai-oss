import React from 'react';
import { usePlanStore } from '../../stores/plan-store.js';
import { useDensityStore } from '../../stores/density-store.js';
import { colors, fonts, alpha } from '../../theme/tokens.js';

const SIZE = 140;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export const TaskRing: React.FC = () => {
  const tasks = usePlanStore((s) => s.tasks);
  const setMode = useDensityStore((s) => s.setMode);

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const progress = total > 0 ? done / total : 0;
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        marginBottom: 28,
        cursor: 'pointer',
      }}
      onClick={() => setMode('work')}
      title="Switch to Monitor mode"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Background track */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={alpha(colors.text.dimmed, 0.25)}
          strokeWidth={STROKE}
        />
        {/* Progress arc */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={colors.accent.primary}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{
            transition: 'stroke-dashoffset 0.6s ease',
            filter: `drop-shadow(0 0 6px ${alpha(colors.accent.primary, 0.4)})`,
          }}
        />
        {/* Center text */}
        <text
          x={SIZE / 2}
          y={SIZE / 2 - 8}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fontSize: 28,
            fontFamily: fonts.display,
            fontWeight: 700,
            fill: colors.text.primary,
          }}
        >
          {done}/{total}
        </text>
        <text
          x={SIZE / 2}
          y={SIZE / 2 + 16}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fontSize: 11,
            fontFamily: fonts.body,
            fill: colors.text.muted,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          tasks
        </text>
      </svg>
    </div>
  );
};
