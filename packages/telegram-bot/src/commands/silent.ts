import type { Context } from 'grammy';
import type { TelegramConfig } from '../config/config.js';
import { saveConfig } from '../config/config.js';
import { esc, bold } from '../notifications/formatters.js';

export function handleSilent(config: TelegramConfig) {
  return (ctx: Context) => {
    const arg = (ctx.match as string | undefined)?.trim().toLowerCase();

    if (arg === 'on') {
      config.silentMode = true;
    } else if (arg === 'off') {
      config.silentMode = false;
    } else {
      // Toggle
      config.silentMode = !config.silentMode;
    }

    saveConfig(config);

    const status = config.silentMode ? 'ON' : 'OFF';
    const desc = config.silentMode
      ? 'Only critical alerts will be sent.'
      : 'All notifications enabled.';

    ctx.reply(
      `${bold(`Silent mode: ${status}`)}\n${esc(desc)}`,
      { parse_mode: 'MarkdownV2' }
    ).catch(console.error);
  };
}
