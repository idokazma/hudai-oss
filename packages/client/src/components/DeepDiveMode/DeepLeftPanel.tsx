import React, { useMemo } from 'react';
import { usePlanStore, type PlanTask, type PlanTaskStatus } from '../../stores/plan-store.js';
import { colors, fonts, alpha } from '../../theme/tokens.js';

const STATUS_ICON: Record<PlanTaskStatus, { glyph: string; color: string }> = {
  done: { glyph: '\u2713', color: colors.status.successLight },
  active: { glyph: '\u25CB', color: colors.accent.primary },
  queued: { glyph: '\u25CB', color: colors.text.dimmed },
};

function TaskRow({ task }: { task: PlanTask }) {
  const { glyph, color } = STATUS_ICON[task.status];
  const isActive = task.status === 'active';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '6px 12px',
        background: isActive ? alpha(colors.accent.primary, 0.08) : 'transparent',
        borderLeft: isActive
          ? `2px solid ${colors.accent.primary}`
          : '2px solid transparent',
        transition: 'background 0.15s ease',
      }}
    >
      {/* Status icon */}
      <span
        style={{
          fontSize: 12,
          color,
          flexShrink: 0,
          marginTop: 1,
          fontFamily: fonts.mono,
          width: 14,
          textAlign: 'center',
          ...(task.status === 'active'
            ? { animation: 'spin 1.2s linear infinite' }
            : {}),
        }}
      >
        {task.status === 'active' ? '\u25E0' : glyph}
      </span>

      {/* Task info */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 12,
            fontFamily: fonts.body,
            fontWeight: isActive ? 600 : 400,
            color: isActive ? colors.text.primary : colors.text.secondary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {task.name}
        </div>

        {task.files.length > 0 && (
          <div
            style={{
              fontSize: 10,
              fontFamily: fonts.mono,
              color: colors.text.dimmed,
              marginTop: 2,
            }}
          >
            {task.files.length} file{task.files.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}

export const DeepLeftPanel: React.FC = () => {
  const tasks = usePlanStore((s) => s.tasks);

  const allFiles = useMemo(() => {
    const fileSet = new Set<string>();
    for (const task of tasks) {
      for (const f of task.files) {
        fileSet.add(f);
      }
    }
    return Array.from(fileSet);
  }, [tasks]);

  return (
    <div
      style={{
        background: colors.bg.panel,
        borderRight: `1px solid ${colors.border.subtle}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Section header */}
      <div
        style={{
          padding: '10px 12px 8px',
          fontSize: 10,
          fontFamily: fonts.display,
          fontWeight: 600,
          letterSpacing: '0.1em',
          color: colors.text.muted,
          textTransform: 'uppercase',
          borderBottom: `1px solid ${colors.border.subtle}`,
        }}
      >
        PLAN
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {tasks.length === 0 ? (
          <div
            style={{
              padding: '24px 12px',
              fontSize: 12,
              fontFamily: fonts.body,
              color: colors.text.dimmed,
              textAlign: 'center',
            }}
          >
            No plan detected
          </div>
        ) : (
          tasks.map((task) => <TaskRow key={task.id} task={task} />)
        )}
      </div>

      {/* Files touched section */}
      {allFiles.length > 0 && (
        <div
          style={{
            borderTop: `1px solid ${colors.border.subtle}`,
            maxHeight: '30%',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '8px 12px 6px',
              fontSize: 10,
              fontFamily: fonts.display,
              fontWeight: 600,
              letterSpacing: '0.1em',
              color: colors.text.muted,
              textTransform: 'uppercase',
              flexShrink: 0,
            }}
          >
            FILES TOUCHED ({allFiles.length})
          </div>

          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {allFiles.map((filePath) => {
              const fileName = filePath.split('/').pop() || filePath;
              return (
                <div
                  key={filePath}
                  title={filePath}
                  style={{
                    padding: '3px 12px',
                    fontSize: 11,
                    fontFamily: fonts.mono,
                    color: colors.text.secondary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    direction: 'rtl',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ direction: 'ltr', unicodeBidi: 'bidi-override' }}>
                    {fileName}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
