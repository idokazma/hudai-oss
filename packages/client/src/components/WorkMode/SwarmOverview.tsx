import { useState, useEffect } from 'react';
import { colors, fonts, alpha } from '../../theme/tokens.js';
import { wsClient } from '../../ws/ws-client.js';
import { formatDurationMs } from '../../utils/format-time.js';
import type { SwarmSnapshot, AgentActivity } from '@hudai/shared';

const ACTIVITY_CONFIG: Record<AgentActivity | 'unknown', { label: string; color: string; icon: string; bg: string }> = {
  working: { label: 'Working', color: colors.accent.primary, icon: '⟳', bg: alpha(colors.accent.primary, 0.08) },
  waiting_input: { label: 'Idle', color: colors.text.muted, icon: '◦', bg: 'rgba(255,255,255,0.02)' },
  waiting_permission: { label: 'Needs Permission', color: colors.status.warning, icon: '⚠', bg: alpha(colors.status.warning, 0.06) },
  waiting_answer: { label: 'Has Question', color: colors.accent.blueLight, icon: '?', bg: alpha(colors.accent.blueLight, 0.06) },
  unknown: { label: 'Unknown', color: colors.text.dimmed, icon: '·', bg: 'transparent' },
};

function formatTokens(n: number | undefined): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${n}`;
}

function getModelShort(model: string | undefined): string {
  if (!model) return '—';
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  const parts = model.split('-');
  return parts.length > 2 ? parts.slice(-2).join('-') : model;
}


function formatAge(ts: number | undefined): string {
  if (!ts) return '—';
  const ago = Date.now() - ts;
  return formatDurationMs(ago) + ' ago';
}

/** Inline panel — rendered inside the center viewport (replaces CodebaseMap) */
export function SwarmOverview({ onClose }: { onClose: () => void }) {
  const [agents, setAgents] = useState<SwarmSnapshot[]>([]);

  useEffect(() => {
    const unsubscribe = wsClient.onMessage((msg: any) => {
      if (msg.kind === 'swarm.status') {
        setAgents(msg.sessions || []);
      }
    });
    wsClient.send({ kind: 'swarm.status' });
    const interval = setInterval(() => {
      wsClient.send({ kind: 'swarm.status' });
    }, 3000);
    return () => { clearInterval(interval); unsubscribe(); };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const switchTo = (agent: SwarmSnapshot) => {
    wsClient.send({ kind: 'session.attach', tmuxTarget: agent.tmuxTarget || agent.projectPath });
    onClose();
  };

  const killSession = (agent: SwarmSnapshot) => {
    wsClient.send({ kind: 'session.kill', tmuxTarget: agent.tmuxTarget || agent.projectPath });
  };

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: colors.bg.primary,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 10,
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 20px',
        borderBottom: `1px solid ${colors.border.subtle}`,
        gap: 12,
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 12,
          fontFamily: fonts.display,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: colors.text.primary,
        }}>
          SWARM
        </span>
        <span style={{
          fontSize: 11,
          fontFamily: fonts.mono,
          color: colors.text.dimmed,
        }}>
          {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: 4,
            padding: '3px 10px',
            fontSize: 10,
            fontFamily: fonts.mono,
            color: colors.text.muted,
            cursor: 'pointer',
          }}
        >
          Back to Map
        </button>
      </div>

      {/* Cards grid */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 20,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
        gap: 12,
        alignContent: 'start',
      }}>
        {agents.map((agent) => (
          <AgentCard
            key={agent.sessionId || agent.projectPath}
            agent={agent}
            onSwitch={() => switchTo(agent)}
            onKill={() => killSession(agent)}
          />
        ))}
        {agents.length === 0 && (
          <div style={{
            gridColumn: '1 / -1',
            padding: 60,
            fontSize: 13,
            color: colors.text.muted,
            fontFamily: fonts.mono,
            textAlign: 'center',
          }}>
            No active agents found
          </div>
        )}
      </div>
    </div>
  );
}

function InlineNotification({ agent }: { agent: SwarmSnapshot }) {
  const activity = agent.activity;
  const [answer, setAnswer] = useState('');
  const options = agent.activityOptions ?? [];

  if (activity !== 'waiting_permission' && activity !== 'waiting_answer') return null;

  const sendCommand = (command: any) => {
    if (agent.isAttached) {
      wsClient.send({ kind: 'command', command });
    } else if (agent.tmuxTarget) {
      wsClient.send({ kind: 'swarm.command', tmuxTarget: agent.tmuxTarget, command });
    }
  };

  const accent = activity === 'waiting_permission' ? colors.status.warning : colors.action.think;

  return (
    <div style={{
      padding: '10px 16px',
      borderBottom: `1px solid ${colors.border.subtle}`,
      background: alpha(accent, 0.04),
    }}>
      {activity === 'waiting_permission' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={(e) => { e.stopPropagation(); sendCommand({ type: 'approve' }); }}
            style={swarmBtnStyle(accent, true)}
          >
            Approve
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); sendCommand({ type: 'reject' }); }}
            style={swarmBtnStyle(accent, false)}
          >
            Reject
          </button>
        </div>
      )}

      {activity === 'waiting_answer' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {options.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {options.map((opt, i) => (
                <button
                  key={opt}
                  onClick={(e) => { e.stopPropagation(); sendCommand({ type: 'prompt', data: { text: opt } }); }}
                  style={swarmBtnStyle(accent, i === 0)}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && answer.trim()) {
                  sendCommand({ type: 'prompt', data: { text: answer.trim() } });
                  setAnswer('');
                }
              }}
              onClick={(e) => e.stopPropagation()}
              placeholder="Type an answer..."
              style={{
                flex: 1,
                background: colors.surface.base,
                border: `1px solid ${alpha(accent, 0.25)}`,
                borderRadius: 4,
                padding: '5px 8px',
                fontFamily: fonts.mono,
                fontSize: 11,
                color: colors.text.primary,
                outline: 'none',
              }}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (answer.trim()) {
                  sendCommand({ type: 'prompt', data: { text: answer.trim() } });
                  setAnswer('');
                }
              }}
              style={swarmBtnStyle(accent, true)}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function swarmBtnStyle(accent: string, primary: boolean): React.CSSProperties {
  return {
    padding: '5px 12px',
    borderRadius: 4,
    border: primary ? 'none' : `1px solid ${alpha(accent, 0.3)}`,
    background: primary ? alpha(accent, 0.25) : 'transparent',
    color: primary ? colors.text.primary : colors.text.secondary,
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s',
  };
}

function AgentCard({ agent, onSwitch, onKill }: {
  agent: SwarmSnapshot;
  onSwitch: () => void;
  onKill: () => void;
}) {
  const activity = agent.activity || (agent.status as AgentActivity) || 'unknown';
  const config = ACTIVITY_CONFIG[activity] || ACTIVITY_CONFIG.unknown;
  const [hovered, setHovered] = useState(false);
  const canSwitch = !!agent.tmuxTarget || agent.source !== 'jsonl';
  const fileName = agent.currentFile?.split('/').pop();

  const stats: Array<{ label: string; value: string | number }> = [];
  if (agent.turnCount) stats.push({ label: 'Turns', value: agent.turnCount });
  if (agent.toolCount) stats.push({ label: 'Tools', value: agent.toolCount });
  stats.push({ label: 'Tokens', value: formatTokens(agent.tokensUsed) });
  stats.push({ label: 'Model', value: getModelShort(agent.model) });
  if (agent.startedAt > 0) stats.push({ label: 'Uptime', value: formatDurationMs(Date.now() - agent.startedAt) });
  if (agent.lastEventAt) stats.push({ label: 'Last Active', value: formatAge(agent.lastEventAt) });
  if (agent.eventCount > 0) stats.push({ label: 'Events', value: agent.eventCount });

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        border: agent.isAttached
          ? `1px solid ${alpha(colors.accent.blue, 0.4)}`
          : hovered
            ? `1px solid rgba(255,255,255,0.35)`
            : `1px solid transparent`,
        borderRadius: 8,
        background: colors.bg.panel,
        overflow: 'hidden',
        transition: 'border-color 0.15s',
      }}
    >
      {/* Card header — colored accent bar + name + badge */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
        background: config.bg,
        borderBottom: `1px solid ${alpha(config.color, 0.15)}`,
      }}>
        <div style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: config.color,
          boxShadow: activity === 'working' ? `0 0 10px ${alpha(config.color, 0.6)}` : 'none',
          flexShrink: 0,
          animation: activity === 'working' ? 'pulse 2s ease-in-out infinite' : undefined,
        }} />
        <span style={{
          flex: 1,
          fontSize: 14,
          fontFamily: fonts.mono,
          fontWeight: 700,
          color: agent.isAttached ? colors.accent.blueLight : colors.text.primary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {agent.projectName}
        </span>
        {agent.isAttached && (
          <span style={{
            fontSize: 8,
            fontFamily: fonts.mono,
            fontWeight: 700,
            color: colors.accent.blue,
            padding: '2px 6px',
            borderRadius: 3,
            background: alpha(colors.accent.blue, 0.15),
            letterSpacing: '0.06em',
          }}>
            ATTACHED
          </span>
        )}
        <span style={{
          fontSize: 10,
          fontFamily: fonts.mono,
          fontWeight: 600,
          color: config.color,
          padding: '2px 8px',
          borderRadius: 4,
          background: alpha(config.color, 0.15),
        }}>
          {config.icon} {config.label}
        </span>
      </div>

      {/* Activity detail / current file */}
      {(fileName || agent.activityDetail) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderBottom: `1px solid ${colors.border.subtle}`,
        }}>
          {fileName && (
            <span style={{
              fontSize: 11,
              fontFamily: fonts.mono,
              color: colors.action.edit,
              padding: '1px 6px',
              borderRadius: 3,
              background: alpha(colors.action.edit, 0.1),
            }}>
              {fileName}
            </span>
          )}
          {agent.activityDetail && (
            <span style={{
              fontSize: 11,
              fontFamily: fonts.mono,
              color: colors.text.dimmed,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}>
              {agent.activityDetail.slice(0, 150)}
            </span>
          )}
        </div>
      )}

      {/* Inline notification (approve/reject/answer) */}
      <InlineNotification agent={agent} />

      {/* Last message */}
      {agent.lastMessage && (
        <div style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${colors.border.subtle}`,
        }}>
          <div style={{
            fontSize: 11,
            fontFamily: fonts.mono,
            color: colors.text.secondary,
            lineHeight: 1.6,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            fontStyle: 'italic',
          }}>
            "{agent.lastMessage}"
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, 1fr)`,
        gap: 0,
        borderBottom: canSwitch ? `1px solid ${colors.border.subtle}` : 'none',
      }}>
        {stats.map((s, i) => (
          <div key={s.label} style={{
            padding: '8px 12px',
            borderRight: i < stats.length - 1 && (i + 1) % Math.min(stats.length, 4) !== 0
              ? `1px solid ${colors.border.subtle}` : 'none',
            borderBottom: stats.length > 4 && i < stats.length - Math.min(stats.length, 4)
              ? `1px solid ${colors.border.subtle}` : 'none',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: 14,
              fontFamily: fonts.mono,
              fontWeight: 700,
              color: colors.text.primary,
              lineHeight: 1.2,
            }}>
              {s.value}
            </div>
            <div style={{
              fontSize: 8,
              fontFamily: fonts.mono,
              fontWeight: 500,
              color: colors.text.dimmed,
              letterSpacing: '0.05em',
              marginTop: 2,
            }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Action bar */}
      {canSwitch && (
        <div style={{
          display: 'flex',
          gap: 6,
          padding: '8px 16px',
          opacity: hovered ? 1 : 0.4,
          transition: 'opacity 0.15s',
        }}>
          {!agent.isAttached && (
            <button
              onClick={onSwitch}
              style={{
                flex: 1,
                background: alpha(colors.accent.blue, 0.1),
                border: `1px solid ${alpha(colors.accent.blue, 0.25)}`,
                borderRadius: 4,
                padding: '5px 0',
                fontSize: 10,
                fontFamily: fonts.mono,
                fontWeight: 600,
                color: colors.accent.blueLight,
                cursor: 'pointer',
              }}
            >
              Attach
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onKill(); }}
            style={{
              padding: '5px 12px',
              background: alpha(colors.status.error, 0.08),
              border: `1px solid ${alpha(colors.status.error, 0.2)}`,
              borderRadius: 4,
              fontSize: 10,
              fontFamily: fonts.mono,
              fontWeight: 600,
              color: colors.status.error,
              cursor: 'pointer',
            }}
          >
            Kill
          </button>
        </div>
      )}
    </div>
  );
}
