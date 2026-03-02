import type { Context } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import { esc } from '../notifications/formatters.js';

export function handleAnswer(bridge: WsBridge) {
  return (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }

    const input = (ctx.match as string | undefined)?.trim();
    if (!input) {
      ctx.reply(esc('Usage: /answer <number>')).catch(console.error);
      return;
    }

    // Send the number as text to the terminal — the agent expects the option number
    bridge.send({
      kind: 'command',
      command: { type: 'prompt', data: { text: input } },
    });
    ctx.reply(esc(`Answered: ${input}`)).catch(console.error);
  };
}
