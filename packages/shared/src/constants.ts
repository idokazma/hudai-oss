import type { AVPCategory } from './avp-events.js';

export const CATEGORY_COLORS: Record<AVPCategory, string> = {
  navigation: '#3a7ca5',   // blue
  mutation: '#d4763c',     // orange
  execution: '#f1c40f',    // yellow
  reasoning: '#9b59b6',    // purple
  testing: '#2ecc71',      // green
  control: '#5a6a7a',      // gray
};

export const AGENT_TYPE_COLORS: Record<string, string> = {
  Explore: '#1abc9c',
  Plan: '#9b59b6',
  Bash: '#2ecc71',
  Code: '#3a7ca5',
  'general-purpose': '#3a7ca5',
  custom: '#d4763c',
  default: '#5a6a7a',
};

export const ACTION_COLORS: Record<string, string> = {
  'file.read': '#3a7ca5',
  'search.grep': '#1abc9c',
  'search.glob': '#1abc9c',
  'file.edit': '#d4763c',
  'file.create': '#d4763c',
  'file.delete': '#c0392b',
  'shell.run': '#f1c40f',
  'shell.output': '#f1c40f',
  'think.start': '#9b59b6',
  'think.end': '#9b59b6',
  'plan.update': '#9b59b6',
  'test.run': '#2ecc71',
  'test.result': '#2ecc71',
  'task.start': '#5a6a7a',
  'task.complete': '#2d6a4f',
  'agent.error': '#c0392b',
  'permission.prompt': '#e74c3c',
  'subagent.start': '#1abc9c',
  'subagent.end': '#1abc9c',
  'context.compaction': '#e67e22',
  'raw.output': '#5a6a7a',
};

export const WS_PORT = 4200;
export const CLIENT_PORT = 4201;
