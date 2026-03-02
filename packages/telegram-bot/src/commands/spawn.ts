import type { Context } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import { esc, bold, code } from '../notifications/formatters.js';
import { InlineKeyboard } from 'grammy';
import type { ServerMessage } from '@hudai/shared';

export function handleSpawn(bridge: WsBridge) {
  return async (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }

    // Request pane list from server
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
    const panesPromise = new Promise<ServerMessage>((resolve) => {
      const unsub = bridge.onMessage((msg) => {
        if (msg.kind === 'panes.list') {
          unsub();
          resolve(msg);
        }
      });
    });

    bridge.send({ kind: 'panes.list' });
    const result = await Promise.race([panesPromise, timeout]);

    if (!result || result.kind !== 'panes.list') {
      ctx.reply(esc('Timeout waiting for pane list.')).catch(console.error);
      return;
    }

    const panes = result.panes;
    if (panes.length === 0) {
      ctx.reply(esc('No running agents to duplicate.')).catch(console.error);
      return;
    }

    // Build inline keyboard with one button per pane
    const keyboard = new InlineKeyboard();
    for (const p of panes) {
      const label = `${p.id} — ${p.command}`;
      keyboard.text(label, `spawn:${p.id}`).row();
    }

    ctx.reply(bold('Select a pane to duplicate'), {
      parse_mode: 'MarkdownV2',
      reply_markup: keyboard,
    }).catch(console.error);
  };
}

export function setupSpawnCallbacks(bot: import('grammy').Bot, bridge: WsBridge): void {
  // Handle pane selection — clone immediately, no name prompt
  bot.callbackQuery(/^spawn:(.+)$/, async (ctx) => {
    const paneId = ctx.match![1];
    await ctx.answerCallbackQuery({ text: 'Spawning...' });

    bridge.send({ kind: 'session.clone', tmuxTarget: paneId });

    await ctx.editMessageText(
      `🧬 Spawning new agent from ${paneId}...\n\nHudai will auto-attach when ready.`,
    ).catch(() => {});
  });
}

/**
 * No longer needed — spawn no longer uses a two-step name prompt.
 * Kept as a no-op so bot.ts doesn't need to change.
 */
export function handleSpawnReply(_ctx: Context, _bridge: WsBridge): boolean {
  return false;
}
