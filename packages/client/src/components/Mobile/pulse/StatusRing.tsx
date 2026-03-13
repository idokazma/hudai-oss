import { useSessionStore } from '../../../stores/session-store.js';
import { usePlanStore } from '../../../stores/plan-store.js';
import { colors, fonts, alpha } from '../../../theme/tokens.js';

const SIZE = 160;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  idle: { label: 'IDLE', color: colors.status.successLight },
  running: { label: 'WORKING', color: colors.accent.primary },
  paused: { label: 'PAUSED', color: colors.status.warning },
  complete: { label: 'DONE', color: colors.status.successLight },
  error: { label: 'ERROR', color: colors.status.errorLight },
};

export function StatusRing() {
  const session = useSessionStore((s) => s.session);
  const tasks = usePlanStore((s) => s.tasks);
  const planSource = usePlanStore((s) => s.planSource);
  const mapped = STATUS_MAP[session.status] ?? STATUS_MAP.idle;

  const total = planSource !== null ? tasks.length : 0;
  const done = planSource !== null ? tasks.filter((t) => t.status === 'done').length : 0;
  const progress = total > 0 ? done / total : 0;
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Background track */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={alpha(colors.text.dimmed, 0.2)}
          strokeWidth={STROKE}
        />
        {/* Progress arc */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={mapped.color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{
            transition: 'stroke-dashoffset 0.6s ease',
            filter: `drop-shadow(0 0 8px ${alpha(mapped.color, 0.4)})`,
          }}
        />
        {/* Status text */}
        <text
          x={SIZE / 2}
          y={SIZE / 2 - 8}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fontSize: 24,
            fontFamily: fonts.display,
            fontWeight: 700,
            fill: mapped.color,
            letterSpacing: '0.08em',
          }}
        >
          {mapped.label}
        </text>
        {total > 0 && (
          <text
            x={SIZE / 2}
            y={SIZE / 2 + 18}
            textAnchor="middle"
            dominantBaseline="central"
            style={{
              fontSize: 13,
              fontFamily: fonts.body,
              fill: colors.text.muted,
            }}
          >
            {done}/{total} tasks
          </text>
        )}
      </svg>

      {/* Current file */}
      {session.agentCurrentFile && (
        <div
          style={{
            fontSize: 12,
            fontFamily: fonts.mono,
            color: colors.text.muted,
            marginTop: 4,
            maxWidth: '80vw',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'center',
          }}
        >
          {session.agentCurrentFile.split('/').pop()}
        </div>
      )}
    </div>
  );
}
