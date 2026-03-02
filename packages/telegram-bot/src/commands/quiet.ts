import type { Context } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import { esc, bold } from '../notifications/formatters.js';

/**
 * /quiet [on|off] — Toggle advisor periodic summaries.
 * "on" sets verbosity to quiet (no auto-summaries).
 * "off" sets verbosity to normal.
 */
export function handleQuiet(bridge: WsBridge) {
  return (ctx: Context) => {
    const arg = (ctx.match as string | undefined)?.trim().toLowerCase();

    let verbosity: 'quiet' | 'normal';
    if (arg === 'off') {
      verbosity = 'normal';
    } else if (arg === 'on' || !arg) {
      verbosity = 'quiet';
    } else {
      // Treat any other arg as the verbosity level directly
      verbosity = arg === 'verbose' ? 'normal' : (arg as any);
    }

    bridge.send({ kind: 'settings.advisor', verbosity });

    const label = verbosity === 'quiet' ? 'OFF' : 'ON';
    const desc = verbosity === 'quiet'
      ? 'Periodic summaries disabled. Use /summary for on\\-demand.'
      : 'Periodic summaries re\\-enabled.';

    ctx.reply(
      `${bold(`Advisor summaries: ${label}`)}\n${desc}`,
      { parse_mode: 'MarkdownV2' },
    ).catch(console.error);
  };
}
