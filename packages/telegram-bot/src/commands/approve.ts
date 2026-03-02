import type { Context } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import { esc } from '../notifications/formatters.js';

export function handleApprove(bridge: WsBridge) {
  return (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }
    bridge.send({ kind: 'command', command: { type: 'approve' } });
    ctx.reply(esc('Approved.')).catch(console.error);
  };
}

export function handleReject(bridge: WsBridge) {
  return (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }
    bridge.send({ kind: 'command', command: { type: 'reject' } });
    ctx.reply(esc('Rejected.')).catch(console.error);
  };
}
