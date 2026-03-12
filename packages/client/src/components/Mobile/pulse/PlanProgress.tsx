import { usePlanStore, type PlanTask } from '../../../stores/plan-store.js';
import { colors, fonts, alpha } from '../../../theme/tokens.js';

function StepRow({ task }: { task: PlanTask }) {
  const isDone = task.status === 'done';
  const isActive = task.status === 'active';
  const dotColor = isDone
    ? colors.status.successLight
    : isActive
      ? colors.accent.primary
      : colors.text.dimmed;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 0',
      }}
    >
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: `2px solid ${dotColor}`,
          background: isDone ? dotColor : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          color: isDone ? colors.bg.primary : dotColor,
          flexShrink: 0,
          animation: isActive ? 'mobilePulse 2s ease-in-out infinite' : 'none',
        }}
      >
        {isDone ? '✓' : isActive ? '▸' : ''}
      </div>
      <span
        style={{
          fontSize: 13,
          fontFamily: fonts.body,
          color: isDone ? colors.text.muted : colors.text.primary,
          fontWeight: isActive ? 600 : 400,
          textDecoration: isDone ? 'line-through' : 'none',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {task.name}
      </span>
    </div>
  );
}

export function PlanProgress() {
  const tasks = usePlanStore((s) => s.tasks);
  const hasExplicitPlan = usePlanStore((s) => s.hasExplicitPlan);

  // Only show when there's an actual agent plan (from TodoWrite / plan.update),
  // not auto-inferred phases like "Analyzing", "Modifying", etc.
  if (!hasExplicitPlan || tasks.length === 0) return null;

  const done = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;

  return (
    <div style={{ padding: '0 16px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: fonts.body,
            color: colors.text.muted,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontWeight: 600,
          }}
        >
          Agent Plan
        </span>
        <span
          style={{
            fontSize: 12,
            fontFamily: fonts.mono,
            color: colors.accent.primary,
            fontWeight: 600,
          }}
        >
          {done}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: alpha(colors.text.dimmed, 0.2),
          marginBottom: 10,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${total > 0 ? (done / total) * 100 : 0}%`,
            background: colors.accent.primary,
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      {/* Steps */}
      {tasks.map((task) => (
        <StepRow key={task.id} task={task} />
      ))}
    </div>
  );
}
