import type { Context } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import { esc, bold, formatCost, formatTokens } from '../notifications/formatters.js';

export function handleCost(bridge: WsBridge) {
  return (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }

    const t = bridge.cache.tokens;
    if (!t) {
      ctx.reply(esc('No token data available.')).catch(console.error);
      return;
    }

    const models = Object.entries(t.modelCounts)
      .map(([m, c]) => `${esc(m)}: ${esc(String(c))}`)
      .join(', ');

    const lines = [
      bold('Token Usage & Cost'),
      '',
      `${esc('Total Cost:')} ${bold(formatCost(t.totalCost))}`,
      `${esc('Burn Rate:')} ${esc(formatTokens(t.burnRate) + '/min')}`,
      `${esc('Context:')} ${bold(t.contextPercent + '%')}`,
      '',
      `${esc('Input:')} ${esc(formatTokens(t.totalInput))}`,
      `${esc('Output:')} ${esc(formatTokens(t.totalOutput))}`,
      `${esc('Cache Create:')} ${esc(formatTokens(t.totalCacheCreation))}`,
      `${esc('Cache Read:')} ${esc(formatTokens(t.totalCacheRead))}`,
      '',
      `${esc('Models:')} ${models || esc('none')}`,
      t.compactionCount > 0
        ? `${esc('Compactions:')} ${esc(String(t.compactionCount))}`
        : '',
    ].filter(Boolean);

    ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' }).catch(console.error);
  };
}
