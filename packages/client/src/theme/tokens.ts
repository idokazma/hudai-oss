// ── Hudai Color Palette ──────────────────────────────────────────────
// Orange / Gray / Black theme inspired by Claude's brand.
// ALL colors in the app should reference this file — no hardcoded hex values.

/** Convert a hex color to rgba with alpha */
export function alpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Convert a hex string to a 0x number for Pixi.js */
export function hex(color: string): number {
  return parseInt(color.slice(1), 16);
}

export const colors = {
  // ── Backgrounds ──
  bg: {
    primary: '#0a0e17',
    secondary: '#0c1220',
    panel: 'rgba(12,18,32,0.95)',
    panelSolid: '#0d1220',
    card: '#0f1420',
    overlay: 'rgba(0,0,0,0.6)',
    gradient: 'linear-gradient(180deg, rgba(12,18,32,0.98) 0%, rgba(12,18,32,0.85) 100%)',
  },

  // ── Surfaces (white/black alpha layers) ──
  surface: {
    base: 'rgba(255,255,255,0.03)',
    hover: 'rgba(255,255,255,0.06)',
    active: 'rgba(255,255,255,0.08)',
    raised: 'rgba(255,255,255,0.05)',
    dim: 'rgba(0,0,0,0.15)',
    dimmer: 'rgba(0,0,0,0.2)',
    dimmest: 'rgba(0,0,0,0.25)',
    shadow: '0 8px 24px rgba(0,0,0,0.5)',
    shadowSm: '0 4px 12px rgba(0,0,0,0.3)',
  },

  // ── Primary accent (orange) ──
  accent: {
    primary: '#c96f3c',
    light: '#e8945c',
    muted: '#d4763c',
    // Semantic aliases
    blue: '#c96f3c',      // legacy alias → primary orange
    blueLight: '#e8945c', // legacy alias → light orange
    orange: '#c96f3c',
    orangeLight: '#e8945c',
  },

  // ── Action colors (event types) ──
  action: {
    read: '#c96f3c',
    edit: '#2ecc71',
    create: '#2ecc71',
    delete: '#c0392b',
    think: '#9b59b6',
    test: '#d4763c',
    bash: '#f1c40f',
    search: '#1abc9c',
    error: '#c0392b',
    control: '#5a6a7a',
    memory: '#ff6b6b',
    compaction: '#e67e22',
    permission: '#e74c3c',
    subagent: '#1abc9c',
  },

  // ── Status ──
  status: {
    success: '#2d6a4f',
    successLight: '#52b788',
    error: '#c0392b',
    errorLight: '#e74c3c',
    warning: '#e07830',
  },

  // ── Text ──
  text: {
    primary: '#eaf0f6',
    secondary: '#b4c4d4',
    muted: '#728496',
    dimmed: '#5a6a7a',
    label: '#9aa8b8',
    white: '#ffffff',
  },

  // ── Borders ──
  border: {
    subtle: 'rgba(201,111,60,0.15)',
    medium: 'rgba(201,111,60,0.3)',
    focus: 'rgba(201,111,60,0.5)',
  },

  // ── Pipeline block types ──
  block: {
    source: '#c96f3c',
    transform: '#47b881',
    sink: '#ec4c47',
    branch: '#f5a623',
    merge: '#7b61ff',
    planStep: '#9b59b6',
  },

  // ── Terminal (xterm.js ANSI colors) ──
  terminal: {
    bg: '#0c1220',
    fg: '#dce3eb',
    cursor: '#dce3eb',
    selection: 'rgba(201,111,60,0.27)',
    black: '#0a0e17',
    red: '#c0392b',
    green: '#2ecc71',
    yellow: '#f0b27a',
    blue: '#e8945c',
    magenta: '#af7ac5',
    cyan: '#48c9b0',
    white: '#dce3eb',
    brightBlack: '#6c7a89',
    brightRed: '#e74c3c',
    brightGreen: '#2ecc71',
    brightYellow: '#f0b27a',
    brightBlue: '#e8945c',
    brightMagenta: '#af7ac5',
    brightCyan: '#48c9b0',
    brightWhite: '#f5f6fa',
  },
} as const;

// ── Event type → color map (used by Timeline, DecisionReplay, etc.) ──
export const EVENT_COLORS: Record<string, string> = {
  'file.read': colors.action.read,
  'search.grep': colors.action.search,
  'search.glob': colors.action.search,
  'file.edit': colors.action.edit,
  'file.create': colors.action.create,
  'file.delete': colors.action.delete,
  'shell.run': colors.action.bash,
  'shell.output': colors.action.bash,
  'think.start': colors.action.think,
  'think.end': colors.action.think,
  'plan.update': colors.action.think,
  'test.run': colors.action.test,
  'test.result': colors.action.test,
  'task.start': colors.action.control,
  'task.complete': colors.status.success,
  'agent.error': colors.action.error,
  'permission.prompt': colors.action.permission,
  'question.ask': colors.action.permission,
  'question.answered': colors.action.permission,
  'subagent.start': colors.action.subagent,
  'subagent.end': colors.action.subagent,
  'context.compaction': colors.action.compaction,
  'loop.warning': colors.status.errorLight,
  'memory.change': colors.action.memory,
  'tool.complete': colors.action.control,
  'raw.output': colors.action.control,
};

// ── Tool type → color map (used by WaterfallView) ──
export const TOOL_COLORS: Record<string, string> = {
  Read: colors.action.read,
  Edit: colors.action.edit,
  Write: colors.action.edit,
  Bash: colors.action.bash,
  Grep: colors.action.search,
  Glob: colors.action.search,
  Task: colors.action.search,
  WebSearch: colors.action.search,
  WebFetch: colors.action.search,
  think: colors.action.think,
};

// ── Notification severity → bg/color ──
export const SEVERITY_BG: Record<string, string> = {
  info: alpha(colors.accent.primary, 0.10),
  warning: alpha(colors.status.warning, 0.10),
  success: alpha(colors.status.success, 0.10),
  error: alpha(colors.status.error, 0.10),
};

export const SEVERITY_COLOR: Record<string, string> = {
  info: colors.accent.primary,
  warning: colors.status.warning,
  success: colors.status.successLight,
  error: colors.status.errorLight,
};

export const fonts = {
  display: "'Rajdhani', 'Impact', 'Arial Black', sans-serif",
  body: "'IBM Plex Sans', 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
} as const;
