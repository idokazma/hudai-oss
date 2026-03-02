import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });
import { loadConfig, getBotToken } from './config/config.js';
import { WsBridge } from './ws-bridge.js';
import { createBot, pushKeyboard } from './bot.js';


async function main() {
  console.log('[telegram-bot] Starting Hudai Telegram Bot...');

  // Load config
  const config = loadConfig();
  const token = getBotToken();

  console.log(`[telegram-bot] Server URL: ${config.serverUrl}`);
  console.log(`[telegram-bot] Chat ID: ${config.chatId ?? 'not registered (send /start)'}`);
  console.log(`[telegram-bot] Silent mode: ${config.silentMode ? 'on' : 'off'}`);

  // Connect to Hudai server
  const bridge = new WsBridge(config.serverUrl);
  bridge.connect();

  // Create and start bot
  const { bot, mode } = createBot(token, bridge, config);

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[telegram-bot] Shutting down...');
    bot.stop();
    bridge.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Listen for service toggle (pause/resume bot polling)
  let botRunning = true;
  bridge.onMessage((msg) => {
    if (msg.kind === 'service.status') {
      const enabled = msg.services.telegram;
      if (!enabled && botRunning) {
        console.log('[telegram-bot] Service paused — stopping polling');
        bot.stop();
        botRunning = false;
      } else if (enabled && !botRunning) {
        console.log('[telegram-bot] Service resumed — restarting polling');
        bot.start({ onStart: () => console.log('[telegram-bot] Polling resumed.') });
        botRunning = true;
      }
    }
  });

  // Start polling
  await bot.start({
    onStart: async () => {
      console.log('[telegram-bot] Bot is running. Send /start in Telegram to register.');
      // Sync pinned mode message so it reflects the correct state after restart
      if (config.chatId) {
        try {
          await pushKeyboard(bot, config);
          console.log('[telegram-bot] Reply keyboard pushed.');
        } catch (err) {
          console.error('[telegram-bot] Failed to push keyboard:', err);
        }
      }
    },
  });
}

main().catch((err) => {
  console.error('[telegram-bot] Fatal error:', err);
  process.exit(1);
});
