import type { Context } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import { esc, bold } from '../notifications/formatters.js';

export function handleSummary(bridge: WsBridge) {
  return async (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }

    if (bridge.cache.session?.llmStatus !== 'connected') {
      ctx.reply(esc('LLM not connected. Summary unavailable.')).catch(console.error);
      return;
    }

    await ctx.reply(esc('Requesting summary...'));

    // Send request and wait for response
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 30000));
    const summaryPromise = new Promise<string>((resolve) => {
      const unsub = bridge.onMessage((msg) => {
        if (msg.kind === 'insight.summary') {
          unsub();
          resolve(msg.summary.text);
        }
      });
    });

    bridge.send({ kind: 'insight.requestSummary' });

    const result = await Promise.race([summaryPromise, timeout]);

    if (result) {
      ctx.reply(`${bold('Executive Summary')}\n\n${esc(result)}`, {
        parse_mode: 'MarkdownV2',
      }).catch(console.error);
    } else {
      ctx.reply(esc('Summary request timed out.')).catch(console.error);
    }
  };
}
