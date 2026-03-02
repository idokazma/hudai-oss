/**
 * Telegram MarkdownV2 formatting utilities.
 * MarkdownV2 requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */

const ESCAPE_CHARS = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/** Escape text for MarkdownV2 */
export function esc(text: string): string {
  return text.replace(ESCAPE_CHARS, '\\$&');
}

/** Bold text */
export function bold(text: string): string {
  return `*${esc(text)}*`;
}

/** Italic text */
export function italic(text: string): string {
  return `_${esc(text)}_`;
}

/** Monospace inline */
export function code(text: string): string {
  // Inside code, only ` and \ need escaping
  return '`' + text.replace(/[`\\]/g, '\\$&') + '`';
}

/** Code block */
export function codeBlock(text: string, lang = ''): string {
  // Inside pre blocks, only ``` and \ need escaping
  const escaped = text.replace(/```/g, '\\`\\`\\`');
  return '```' + lang + '\n' + escaped + '\n```';
}

/** Strip ANSI escape codes */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

/** Truncate text to fit Telegram's 4096 char limit, accounting for formatting overhead */
export function truncate(text: string, maxLen = 4000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 20) + '\n…(truncated)';
}

/** Format duration in seconds to human-readable */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Format USD cost */
export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Format token count with K/M suffix */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}
