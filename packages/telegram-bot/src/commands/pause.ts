import type { Context } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import { esc } from '../notifications/formatters.js';

export function handlePause(bridge: WsBridge) {
  return (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }
    bridge.send({ kind: 'command', command: { type: 'pause' } });
    ctx.reply(esc('Pause sent.')).catch(console.error);
  };
}

export function handleResume(bridge: WsBridge) {
  return (ctx: Context) => {
    if (!bridge.isConnected) {
      ctx.reply(esc('Not connected to Hudai server.')).catch(console.error);
      return;
    }
    bridge.send({ kind: 'command', command: { type: 'resume' } });
    ctx.reply(esc('Resume sent.')).catch(console.error);
  };
}
