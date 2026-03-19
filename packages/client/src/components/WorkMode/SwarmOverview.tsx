import { useState, useEffect, useRef } from 'react';
import { colors, fonts, alpha } from '../../theme/tokens.js';
import { wsClient } from '../../ws/ws-client.js';
import type { SwarmSnapshot, AgentActivity } from '@hudai/shared';

const ACTIVITY_CONFIG: Record<AgentActivity | 'unknown', { label: string; color: string; icon: string }> = {
  working: { label: 'Working', color: colors.accent.primary, icon: '⟳' },
  waiting_input: { label: 'Idle', color: colors.text.muted, icon: '◦' },
  waiting_permission: { label: 'Permission', color: colors.status.warning, icon: '⚠' },
  waiting_answer: { label: 'Question', color: colors.accent.blueLight, icon: '?' },
  unknown: { label: '...', color: colors.text.dimmed, icon: '·' },
};

function formatTokens(n: number | undefined): string {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${n}`;
}

function getModelShort(model: string | undefined): string {
  if (!model) return '';
  if (model.includes('opus')) return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('haiku')) return 'haiku';
  // Strip vendor prefix, keep last meaningful segment
  const parts = model.split('-');
  return parts.length > 2 ? parts.slice(-2).join('-') : model;
}

export function SwarmOverview({ onClose }: { onClose: () => void }) {
  const [agents, setAgents] = useState<SwarmSnapshot[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const currentTarget = undefined; // Will be set from session store

  // Request swarm status on mount and every 3s
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
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  const switchTo = (agent: SwarmSnapshot) => {
    const target = agent.tmuxTarget || agent.projectPath;
    wsClient.send({ kind: 'session.attach', tmuxTarget: target });
    onClose();
  };

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: 4,
        minWidth: 340,
        maxWidth: 460,
        background: colors.bg.panel,
        border: `1px solid ${colors.border.medium}`,
        borderRadius: 8,
        boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        zIndex: 200,
        padding: 8,
      }}
    >
      <div style={{
        fontSize: 10,
        fontFamily: fonts.display,
        fontWeight: 600,
        letterSpacing: '0.1em',
        color: colors.text.muted,
        padding: '2px 4px 6px',
        borderBottom: `1px solid ${colors.border.subtle}`,
        marginBottom: 6,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>AGENTS ({agents.length})</span>
        {agents.some((a) => a.source === 'jsonl' && !a.tmuxTarget) && (
          <span style={{ fontSize: 8, color: colors.text.dimmed, fontWeight: 400, letterSpacing: 'normal' }}>
            includes non-tmux sessions
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {agents.map((agent) => (
          <AgentCard
            key={agent.sessionId || agent.projectPath}
            agent={agent}
            onSwitch={() => switchTo(agent)}
          />
        ))}
        {agents.length === 0 && (
          <div style={{ padding: 12, fontSize: 11, color: colors.text.muted, fontFamily: fonts.mono, textAlign: 'center' }}>
            No active agents found
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({ agent, onSwitch }: { agent: SwarmSnapshot; onSwitch: () => void }) {
  const activity = agent.activity || (agent.status as AgentActivity) || 'unknown';
  const config = ACTIVITY_CONFIG[activity] || ACTIVITY_CONFIG.unknown;
  const [hovered, setHovered] = useState(false);
  const canSwitch = !!agent.tmuxTarget || agent.source !== 'jsonl';
  const modelShort = getModelShort(agent.model);
  const tokens = formatTokens(agent.tokensUsed);
  const fileName = agent.currentFile?.split('/').pop();

  return (
    <button
      onClick={canSwitch ? onSwitch : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        width: '100%',
        padding: '7px 10px',
        border: agent.isAttached ? `1px solid ${alpha(colors.accent.blue, 0.3)}` : '1px solid transparent',
        borderRadius: 6,
        background: agent.isAttached
          ? alpha(colors.accent.blue, 0.08)
          : hovered && canSwitch ? 'rgba(255,255,255,0.04)' : 'transparent',
        cursor: canSwitch ? 'pointer' : 'default',
        outline: 'none',
        textAlign: 'left',
      }}
    >
      {/* Row 1: Status dot + project name + model + activity badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: config.color,
          boxShadow: activity === 'working' ? `0 0 8px ${alpha(config.color, 0.5)}` : 'none',
          flexShrink: 0,
          animation: activity === 'working' ? 'pulse 2s ease-in-out infinite' : undefined,
        }} />

        <div style={{
          flex: 1,
          fontSize: 11,
          fontFamily: fonts.mono,
          fontWeight: agent.isAttached ? 600 : 500,
          color: agent.isAttached ? colors.accent.blueLight : colors.text.primary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {agent.projectName}
        </div>

        {modelShort && (
          <span style={{
            fontSize: 8,
            fontFamily: fonts.mono,
            color: colors.text.dimmed,
            flexShrink: 0,
          }}>
            {modelShort}
          </span>
        )}

        <div style={{
          fontSize: 9,
          fontFamily: fonts.mono,
          fontWeight: 600,
          color: config.color,
          padding: '1px 5px',
          borderRadius: 3,
          background: alpha(config.color, 0.12),
          flexShrink: 0,
        }}>
          {config.label}
        </div>
      </div>

      {/* Row 2: Detail line (current file, activity detail, or status line) */}
      {(fileName || agent.activityDetail) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingLeft: 16,
        }}>
          {fileName && (
            <span style={{
              fontSize: 9,
              fontFamily: fonts.mono,
              color: colors.action.edit,
              maxWidth: 160,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {fileName}
            </span>
          )}
          {agent.activityDetail && activity !== 'working' && (
            <span style={{
              fontSize: 9,
              fontFamily: fonts.mono,
              color: colors.text.dimmed,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}>
              {agent.activityDetail.slice(0, 80)}
            </span>
          )}
        </div>
      )}

      {/* Row 3: Metrics (turns, tokens) + source indicator */}
      {(agent.turnCount || tokens || agent.source === 'jsonl') && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingLeft: 16,
        }}>
          {agent.turnCount ? (
            <span style={{ fontSize: 8, fontFamily: fonts.mono, color: colors.text.dimmed }}>
              {agent.turnCount} turns
            </span>
          ) : null}
          {tokens ? (
            <span style={{ fontSize: 8, fontFamily: fonts.mono, color: colors.text.dimmed }}>
              {tokens} tok
            </span>
          ) : null}
          {agent.toolCount ? (
            <span style={{ fontSize: 8, fontFamily: fonts.mono, color: colors.text.dimmed }}>
              {agent.toolCount} tools
            </span>
          ) : null}
          <div style={{ flex: 1 }} />
          {!canSwitch && (
            <span style={{
              fontSize: 7,
              fontFamily: fonts.mono,
              color: colors.text.dimmed,
              opacity: 0.6,
            }}>
              no terminal
            </span>
          )}
        </div>
      )}
    </button>
  );
}
