import { colors } from '../../theme/tokens.js';

/** Icon + color for known agent types. Used across ConfigPanel, Pipeline, and CodebaseMap. */
export const AGENT_ICONS: Record<string, { icon: string; color: string }> = {
  'Explore':          { icon: '🔍', color: colors.accent.primary },
  'Plan':             { icon: '📋', color: colors.action.think },
  'Bash':             { icon: '⌨',  color: colors.action.bash },
  'general-purpose':  { icon: '⚙',  color: colors.text.label },
  'Code Reviewer':    { icon: '🔎', color: colors.action.edit },
  'QA / Test Writer': { icon: '🧪', color: colors.action.test },
  'Refactor Scout':   { icon: '♻',  color: colors.action.search },
  'Security Auditor': { icon: '🛡',  color: colors.action.error },
};

export const AGENT_ICON_FALLBACK = { icon: '📄', color: colors.action.think };

/** Get icon info for an agent by name */
export function getAgentIcon(name: string): { icon: string; color: string } {
  return AGENT_ICONS[name] ?? AGENT_ICON_FALLBACK;
}
