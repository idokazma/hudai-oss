import type { Context } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import { esc, bold, formatDuration } from '../notifications/formatters.js';

export function handleStatus(bridge: WsBridge) {
  return (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }

    const s = bridge.cache.session;
    if (!s) {
      ctx.reply(esc('No active session.')).catch(console.error);
      return;
    }

    const duration = formatDuration((Date.now() - s.startedAt) / 1000);
    const activity = s.agentActivity ?? 'unknown';
    const file = s.agentCurrentFile ?? 'none';
    const subagents = s.activeSubagentCount ?? 0;
    const breadcrumb = s.agentBreadcrumb?.join(' > ') ?? '';
    const detail = s.agentActivityDetail ?? '';

    const lines = [
      bold('Session Status'),
      '',
      `${esc('Status:')} ${bold(s.status)}`,
      `${esc('Activity:')} ${bold(activity)}`,
      detail ? `${esc('Detail:')} ${esc(detail)}` : '',
      `${esc('File:')} ${esc(file)}`,
      `${esc('Task:')} ${esc(s.taskLabel || 'none')}`,
      `${esc('Duration:')} ${esc(duration)}`,
      `${esc('Events:')} ${esc(String(s.eventCount))}`,
      subagents > 0 ? `${esc('Sub-agents:')} ${esc(String(subagents))}` : '',
      breadcrumb ? `${esc('Breadcrumb:')} ${esc(breadcrumb)}` : '',
    ].filter(Boolean);

    ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' }).catch(console.error);
  };
}
