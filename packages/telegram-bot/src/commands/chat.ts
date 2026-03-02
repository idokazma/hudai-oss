import type { Context } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import type { TelegramConfig } from '../config/config.js';
import { esc } from '../notifications/formatters.js';

export interface BotMode {
  chatMode: boolean;
}

export function handleChatMode(mode: BotMode, _config: TelegramConfig) {
  return async (ctx: Context) => {
    mode.chatMode = true;
    await ctx.reply('💬 <b>Advisor mode</b> — plain text goes to the advisor.\n/agent to switch back.', {
      parse_mode: 'HTML',
    });
  };
}

export function handleAgentMode(mode: BotMode, _config: TelegramConfig) {
  return async (ctx: Context) => {
    mode.chatMode = false;
    await ctx.reply('🤖 <b>Agent mode</b> — plain text goes to the agent.\n/chat to switch back.', {
      parse_mode: 'HTML',
    });
  };
}

export function handleAsk(bridge: WsBridge) {
  return (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }

    const text = ctx.match as string | undefined;
    if (!text?.trim()) {
      ctx.reply(esc('Usage: /ask <question>')).catch(console.error);
      return;
    }

    bridge.send({ kind: 'chat.send', text: text.trim() });
    ctx.reply(esc('💬 Asking advisor...')).catch(console.error);
  };
}
