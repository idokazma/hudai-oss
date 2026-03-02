import type { Context } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import { esc, bold, code } from '../notifications/formatters.js';
import type { ServerMessage } from '@hudai/shared';

export function handleSessions(bridge: WsBridge) {
  return async (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }

    // Request pane list and wait for response
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
      ctx.reply(esc('No tmux panes found.')).catch(console.error);
      return;
    }

    const lines = [bold('Available Panes'), ''];
    for (const p of panes) {
      lines.push(`${code(p.id)} ${esc(p.command)}`);
    }
    lines.push('', esc('Use /attach <id> to switch.'));

    ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' }).catch(console.error);
  };
}

export function handleAttach(bridge: WsBridge) {
  return (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }

    const target = (ctx.match as string | undefined)?.trim();
    if (!target) {
      ctx.reply(esc('Usage: /attach <pane-id>')).catch(console.error);
      return;
    }

    bridge.send({ kind: 'session.attach', tmuxTarget: target });
    ctx.reply(esc(`Attaching to ${target}...`)).catch(console.error);
  };
}

export function handleDetach(bridge: WsBridge) {
  return (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }

    bridge.send({ kind: 'session.detach' });
    ctx.reply(esc('Detached.')).catch(console.error);
  };
}
