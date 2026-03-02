import type { Context } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import type { BotMode } from './chat.js';
import { esc } from '../notifications/formatters.js';

export function handleSend(bridge: WsBridge) {
  return (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }

    const text = ctx.match as string | undefined;
    if (!text?.trim()) {
      ctx.reply(esc('Usage: /send <text>')).catch(console.error);
      return;
    }

    bridge.send({
      kind: 'command',
      command: { type: 'prompt', data: { text: text.trim() } },
    });
    ctx.reply(esc(`🤖 → ${text.trim()}`)).catch(console.error);
  };
}

/** Handle plain text messages — routes to agent or advisor based on mode */
export function handlePlainText(bridge: WsBridge, mode: BotMode) {
  return (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }

    const text = ctx.message?.text;
    if (!text?.trim()) return;

    if (mode.chatMode) {
      bridge.send({ kind: 'chat.send', text: text.trim() });
      ctx.reply(esc(`💬 → ${text.trim()}`)).catch(console.error);
    } else {
      bridge.send({
        kind: 'command',
        command: { type: 'prompt', data: { text: text.trim() } },
      });
      ctx.reply(esc(`🤖 → ${text.trim()}`)).catch(console.error);
    }
  };
}
