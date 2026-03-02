import type { Context } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import { stripAnsi, truncate, esc } from '../notifications/formatters.js';

export function handleTerminal(bridge: WsBridge) {
  return (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }

    const raw = bridge.cache.paneContent;
    if (!raw) {
      ctx.reply(esc('No terminal content available.')).catch(console.error);
      return;
    }

    const lines = stripAnsi(raw).split('\n');
    const last50 = lines.slice(-50).join('\n');
    const text = truncate(last50, 3900);

    // Use HTML mode for code blocks (simpler escaping)
    ctx.reply(`<pre>${escapeHtml(text)}</pre>`, { parse_mode: 'HTML' }).catch(console.error);
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
