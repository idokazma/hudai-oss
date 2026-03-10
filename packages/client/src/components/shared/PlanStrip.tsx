import React from 'react';
import { usePlanStore } from '../../stores/plan-store.js';
import { useDensityStore } from '../../stores/density-store.js';
import { colors, fonts, alpha } from '../../theme/tokens.js';

const DOT_COLORS: Record<string, string> = {
  done: '#2ecc71',
  active: colors.accent.primary,
  queued: colors.text.dimmed,
};

export const PlanStrip: React.FC = () => {
  const tasks = usePlanStore((s) => s.tasks);
  const setMode = useDensityStore((s) => s.setMode);

  const done = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  const progress = total > 0 ? (done / total) * 100 : 0;

  return (
    <div
      onClick={() => setMode('work')}
      style={{
        padding: '8px 12px',
        maxHeight: 60,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontFamily: fonts.display,
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: colors.text.muted,
            textTransform: 'uppercase',
          }}
        >
          Plan
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: fonts.mono,
            color: colors.text.secondary,
          }}
        >
          {done}/{total} tasks
        </span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 3,
          borderRadius: 2,
          background: colors.surface.base,
          marginBottom: 6,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            borderRadius: 2,
            background: colors.accent.primary,
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      {/* Task dots */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {tasks.map((task) => (
          <div
            key={task.id}
            title={task.name}
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: DOT_COLORS[task.status] ?? colors.text.dimmed,
              boxShadow:
                task.status === 'active'
                  ? `0 0 6px ${alpha(colors.accent.primary, 0.6)}`
                  : 'none',
              transition: 'background 0.2s ease',
            }}
          />
        ))}
      </div>
    </div>
  );
};
