import { useState, useEffect } from 'react';
import { usePlanStore, type PlanTask } from '../../stores/plan-store.js';
import type { PlanFileSummary } from '@hudai/shared';
import { useReplayStore } from '../../stores/replay-store.js';
import { DocsPanel } from './DocsPanel.js';
import { ConfigPanel } from './ConfigPanel.js';
import { wsClient } from '../../ws/ws-client.js';
import { colors, alpha, fonts } from '../../theme/tokens.js';

type LeftTab = 'queue' | 'docs' | 'config';

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '6px 0',
  fontSize: 11,
  fontFamily: fonts.mono,
  background: active ? alpha(colors.accent.primary, 0.15) : 'transparent',
  border: 'none',
  borderBottom: active ? `2px solid ${colors.accent.blue}` : '2px solid transparent',
  color: active ? colors.text.primary : colors.text.muted,
  cursor: 'pointer',
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
  transition: 'background 0.15s, color 0.15s',
});

function TaskItem({ task }: { task: PlanTask }) {
  const isDone = task.status === 'done';
  const isActive = task.status === 'active';

  return (
    <div style={{
      padding: '8px 12px',
      borderLeft: `3px solid ${isActive ? colors.accent.blue : isDone ? colors.status.success + '44' : colors.border.subtle}`,
      background: isActive ? alpha(colors.accent.primary, 0.08) : 'transparent',
      opacity: isDone ? 0.5 : 1,
      transition: 'all 0.3s',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        {/* Status indicator */}
        <div style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          ...(isDone ? {
            background: colors.status.success + '33',
            border: `1px solid ${colors.status.success}`,
            color: colors.status.successLight,
          } : isActive ? {
            background: colors.accent.blue + '33',
            border: `1px solid ${colors.accent.blue}`,
            color: colors.accent.blueLight,
            boxShadow: `0 0 6px ${colors.accent.blue}44`,
          } : {
            background: colors.surface.base,
            border: `1px solid ${colors.border.subtle}`,
            color: colors.text.muted,
          }),
        }}>
          {isDone ? '✓' : isActive ? '▸' : '·'}
        </div>

        {/* Task name */}
        <span style={{
          fontSize: 13,
          fontFamily: fonts.mono,
          color: isDone ? colors.text.muted : isActive ? colors.text.primary : colors.text.secondary,
          textDecoration: isDone ? 'line-through' : 'none',
          lineHeight: 1.3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {task.name}
        </span>
      </div>

      {/* File list for active task */}
      {isActive && task.files.length > 0 && (
        <div style={{
          marginTop: 4,
          marginLeft: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}>
          {task.files.slice(-3).map((f) => (
            <span key={f} style={{
              fontSize: 11,
              fontFamily: fonts.mono,
              color: colors.text.muted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {f.split('/').pop()}
            </span>
          ))}
        </div>
      )}

      {/* Progress bar for active task */}
      {isActive && (
        <div style={{
          marginTop: 6,
          marginLeft: 22,
          height: 2,
          background: colors.surface.hover,
          borderRadius: 1,
          overflow: 'hidden',
        }}>
          <div style={{
            width: '60%',
            height: '100%',
            background: colors.accent.blue,
            borderRadius: 1,
            animation: 'pulse-width 2s ease-in-out infinite',
          }} />
        </div>
      )}
    </div>
  );
}

function formatRelativeDate(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function PlanItem({ plan, onLoad }: { plan: PlanFileSummary; onLoad: (filename: string) => void }) {
  const isNew = Date.now() - plan.modifiedAt < 30 * 60 * 1000;

  return (
    <div
      onClick={() => onLoad(plan.filename)}
      style={{
        padding: '6px 12px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        transition: 'background 0.15s',
        background: isNew ? alpha(colors.accent.primary, 0.06) : 'transparent',
        borderLeft: isNew ? `2px solid ${colors.accent.blue}` : '2px solid transparent',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = alpha(colors.accent.primary, 0.12); }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = isNew ? alpha(colors.accent.primary, 0.06) : 'transparent'; }}
      title={plan.filename}
    >
      <span style={{
        fontSize: 12,
        fontFamily: fonts.mono,
        color: isNew ? colors.text.primary : colors.text.secondary,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
      }}>
        {plan.title}
      </span>
      <span style={{
        fontSize: 10,
        color: isNew ? colors.accent.blueLight : colors.text.muted,
        flexShrink: 0,
        opacity: isNew ? 1 : 0.7,
      }}>
        {isNew ? 'new' : formatRelativeDate(plan.modifiedAt)}
      </span>
    </div>
  );
}

function PlanBrowser() {
  const plans = usePlanStore((s) => s.availablePlans);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    wsClient.send({ kind: 'plans.list' });
    const interval = setInterval(() => {
      wsClient.send({ kind: 'plans.list' });
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    wsClient.send({ kind: 'plans.list' });
  };

  const handleLoad = (filename: string) => {
    wsClient.send({ kind: 'plans.load', filename });
  };

  return (
    <div style={{
      borderTop: `1px solid ${colors.border.subtle}`,
      flexShrink: 0,
    }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          cursor: 'pointer',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 1,
          color: colors.text.muted,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{
            fontSize: 9,
            transition: 'transform 0.2s',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            display: 'inline-block',
          }}>
            ▼
          </span>
          Plans
          {plans.length > 0 && (
            <span style={{
              fontSize: 10,
              color: colors.text.muted,
              opacity: 0.7,
            }}>
              ({plans.length})
            </span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
          style={{
            background: 'none',
            border: 'none',
            color: colors.text.muted,
            cursor: 'pointer',
            fontSize: 12,
            padding: '2px 4px',
            borderRadius: 3,
          }}
          title="Refresh plan list"
        >
          ↻
        </button>
      </div>

      {/* Plan list */}
      {!collapsed && (
        <div style={{
          maxHeight: 200,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}>
          {plans.length === 0 ? (
            <div style={{
              padding: '8px 12px',
              fontSize: 11,
              color: colors.text.muted,
              fontStyle: 'italic',
            }}>
              No plans found
            </div>
          ) : (<>
            {/* Project plans */}
            {plans.some((p) => p.source === 'project') && (
              <div style={{
                padding: '4px 12px 2px',
                fontSize: 9,
                textTransform: 'uppercase',
                letterSpacing: 1,
                color: colors.accent.blue,
                opacity: 0.7,
              }}>
                Project
              </div>
            )}
            {plans.filter((p) => p.source === 'project').map((plan) => (
              <PlanItem key={plan.filename} plan={plan} onLoad={handleLoad} />
            ))}
            {/* Separator + global plans */}
            {plans.some((p) => p.source === 'global') && (
              <div style={{
                padding: '4px 12px 2px',
                fontSize: 9,
                textTransform: 'uppercase',
                letterSpacing: 1,
                color: colors.text.muted,
                opacity: 0.5,
                ...(plans.some((p) => p.source === 'project') ? {
                  marginTop: 4,
                  borderTop: `1px solid ${colors.border.subtle}`,
                  paddingTop: 6,
                } : {}),
              }}>
                Global
              </div>
            )}
            {plans.filter((p) => p.source === 'global').map((plan) => (
              <PlanItem key={plan.filename} plan={plan} onLoad={handleLoad} />
            ))}
          </>)}
        </div>
      )}
    </div>
  );
}

export function BuildQueue() {
  const tasks = usePlanStore((s) => s.tasks);
  const hasExplicitPlan = usePlanStore((s) => s.hasExplicitPlan);
  const replayMode = useReplayStore((s) => s.mode);
  const [activeTab, setActiveTab] = useState<LeftTab>('queue');

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: colors.surface.dimmer,
      borderRight: `1px solid ${colors.border.subtle}`,
    }}>
      {/* Tab strip */}
      <div style={{
        display: 'flex',
        borderBottom: `1px solid ${colors.border.subtle}`,
        flexShrink: 0,
      }}>
        <button onClick={() => setActiveTab('queue')} style={tabBtnStyle(activeTab === 'queue')}>
          {replayMode === 'replay' ? 'Replay' : hasExplicitPlan ? 'Todo' : 'Queue'}
        </button>
        <button onClick={() => setActiveTab('docs')} style={tabBtnStyle(activeTab === 'docs')}>
          Docs
        </button>
        <button onClick={() => setActiveTab('config')} style={tabBtnStyle(activeTab === 'config')}>
          Config
        </button>
      </div>

      {/* Docs tab */}
      {activeTab === 'docs' && <DocsPanel />}

      {/* Config tab */}
      {activeTab === 'config' && <ConfigPanel />}

      {/* Queue tab — Task list */}
      {activeTab === 'queue' && (<>
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}>
        {tasks.length === 0 ? (
          <div style={{
            padding: '20px 12px',
            fontSize: 12,
            color: colors.text.muted,
            textAlign: 'center',
            lineHeight: 1.6,
          }}>
            Waiting for agent tasks...
            <br />
            <span style={{ fontSize: 11 }}>Tasks auto-populate as the agent works</span>
          </div>
        ) : (
          [...tasks].reverse().map((task) => <TaskItem key={task.id} task={task} />)
        )}
      </div>

      {/* Plan browser footer */}
      <PlanBrowser />

      </>)}

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse-width {
          0%, 100% { width: 30%; opacity: 0.6; }
          50% { width: 80%; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
