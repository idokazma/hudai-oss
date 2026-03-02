import { AGENT_TYPE_COLORS } from '@hudai/shared';
import { fonts } from '../../theme/tokens.js';

interface AgentBadgeProps {
  agentType: string;
  size?: 'small' | 'normal';
}

function getAgentColor(type: string): string {
  return AGENT_TYPE_COLORS[type] ?? AGENT_TYPE_COLORS.custom ?? AGENT_TYPE_COLORS.default;
}

export function AgentBadge({ agentType, size = 'small' }: AgentBadgeProps) {
  const color = getAgentColor(agentType);
  const fontSize = size === 'small' ? 7 : 9;

  return (
    <span style={{
      fontSize,
      fontFamily: fonts.mono,
      padding: '1px 3px',
      borderRadius: 2,
      background: `${color}22`,
      color,
      border: `1px solid ${color}44`,
      lineHeight: 1,
      whiteSpace: 'nowrap',
    }}>
      {agentType}
    </span>
  );
}

export { getAgentColor };
