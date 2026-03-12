import { useState } from 'react';
import { usePlanStore, type PlanTask } from '../../../stores/plan-store.js';
import { colors, fonts, alpha } from '../../../theme/tokens.js';

const STATUS_DOT: Record<string, { color: string; icon: string }> = {
  done: { color: colors.status.successLight, icon: '✓' },
  active: { color: colors.accent.primary, icon: '▸' },
  queued: { color: colors.text.dimmed, icon: '○' },
};

function StepItem({ task, index }: { task: PlanTask; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const s = STATUS_DOT[task.status] ?? STATUS_DOT.queued;

  return (
    <div
      onClick={() => task.files.length > 0 && setExpanded(!expanded)}
      style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${colors.border.subtle}`,
        cursor: task.files.length > 0 ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {/* Status indicator */}
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            border: `2px solid ${s.color}`,
            background: task.status === 'done' ? s.color : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            color: task.status === 'done' ? colors.bg.primary : s.color,
            flexShrink: 0,
            marginTop: 1,
            animation: task.status === 'active' ? 'mobilePulse 2s ease-in-out infinite' : 'none',
          }}
        >
          {s.icon}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontFamily: fonts.body,
              color: task.status === 'done' ? colors.text.muted : colors.text.primary,
              fontWeight: task.status === 'active' ? 600 : 400,
              textDecoration: task.status === 'done' ? 'line-through' : 'none',
              lineHeight: 1.4,
            }}
          >
            {task.name}
          </div>
          {task.files.length > 0 && (
            <span
              style={{
                fontSize: 10,
                fontFamily: fonts.mono,
                color: colors.text.dimmed,
              }}
            >
              {task.files.length} file{task.files.length !== 1 ? 's' : ''} {expanded ? '▾' : '▸'}
            </span>
          )}
        </div>
      </div>

      {/* Expanded file list */}
      {expanded && task.files.length > 0 && (
        <div style={{ marginTop: 8, marginLeft: 32 }}>
          {task.files.map((f) => (
            <div
              key={f}
              style={{
                fontSize: 11,
                fontFamily: fonts.mono,
                color: colors.text.dimmed,
                padding: '2px 0',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {f.split('/').pop()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StepList() {
  const tasks = usePlanStore((s) => s.tasks);

  if (tasks.length === 0) {
    return (
      <div
        style={{
          padding: '32px 16px',
          textAlign: 'center',
          fontSize: 13,
          fontFamily: fonts.mono,
          color: colors.text.dimmed,
        }}
      >
        No plan steps yet
      </div>
    );
  }

  return (
    <div>
      {tasks.map((task, i) => (
        <StepItem key={task.id} task={task} index={i} />
      ))}
    </div>
  );
}
