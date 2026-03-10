import { usePlanStore } from '../../../stores/plan-store.js';
import { colors, fonts, alpha } from '../../../theme/tokens.js';

const SIZE = 120;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ProgressHero() {
  const tasks = usePlanStore((s) => s.tasks);
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const progress = total > 0 ? done / total : 0;
  const percent = Math.round(progress * 100);
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0' }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={alpha(colors.text.dimmed, 0.2)}
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={progress >= 1 ? colors.status.successLight : colors.accent.primary}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{
            transition: 'stroke-dashoffset 0.6s ease',
            filter: `drop-shadow(0 0 6px ${alpha(colors.accent.primary, 0.3)})`,
          }}
        />
        <text
          x={SIZE / 2}
          y={SIZE / 2}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fontSize: 28,
            fontFamily: fonts.display,
            fontWeight: 700,
            fill: colors.text.primary,
          }}
        >
          {total > 0 ? `${percent}%` : '—'}
        </text>
      </svg>
      <div
        style={{
          fontSize: 12,
          fontFamily: fonts.body,
          color: colors.text.muted,
          marginTop: 4,
        }}
      >
        {total > 0 ? `${done} of ${total} steps complete` : 'No plan active'}
      </div>
    </div>
  );
}
