import type { Context } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import { esc, bold, italic } from '../notifications/formatters.js';

export function handleIntel(bridge: WsBridge) {
  return (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }

    const { intent, summary, notifications } = bridge.cache;

    const lines: string[] = [bold('Intel Report'), ''];

    // Intent
    if (intent) {
      lines.push(
        `${bold('Current Intent')} \\(${esc(intent.confidence)}\\)`,
        esc(intent.text),
        ''
      );
    } else {
      lines.push(italic('No intent detected'), '');
    }

    // Last summary
    if (summary) {
      lines.push(bold('Last Summary'), esc(summary.text), '');
    }

    // Recent notifications
    if (notifications.length > 0) {
      lines.push(bold('Recent Notifications'));
      for (const n of notifications.slice(0, 5)) {
        const icon = n.severity === 'critical' ? '🔴' : n.severity === 'warning' ? '🟡' : '🔵';
        lines.push(`${icon} ${esc(n.text)}`);
      }
    } else {
      lines.push(italic('No recent notifications'));
    }

    ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' }).catch(console.error);
  };
}
