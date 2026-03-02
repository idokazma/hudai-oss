import { Bot } from 'grammy';
import type { WsBridge } from './ws-bridge.js';
import type { TelegramConfig } from './config/config.js';
import { saveConfig } from './config/config.js';

// Command handlers
import { handleHelp } from './commands/help.js';
import { handleTerminal } from './commands/terminal.js';
import { handleSend, handlePlainText } from './commands/send.js';
import { handleStatus } from './commands/status.js';
import { handleIntel } from './commands/intel.js';
import { handleSummary } from './commands/summary.js';
import { handlePause, handleResume } from './commands/pause.js';
import { handleApprove, handleReject } from './commands/approve.js';
import { handleAnswer } from './commands/answer.js';
import { handleSilent } from './commands/silent.js';
import { handleQuiet } from './commands/quiet.js';
import { handleCost } from './commands/cost.js';
import { handleSessions, handleAttach, handleDetach } from './commands/sessions.js';
import { handleSpawn, setupSpawnCallbacks, handleSpawnReply } from './commands/spawn.js';
import { handleChatMode, handleAgentMode, handleAsk } from './commands/chat.js';
import type { BotMode } from './commands/chat.js';
import { handleMore, setupMenuCallbacks } from './commands/menu.js';

// Notifications
import { setupAutoNotifier, setupCallbackHandlers, buildKeyboard, KEYBOARD_COMMANDS } from './notifications/auto-notifier.js';

export function createBot(
  token: string,
  bridge: WsBridge,
  config: TelegramConfig
): { bot: Bot; mode: BotMode } {
  const bot = new Bot(token);
  const mode: BotMode = { chatMode: false };

  // Auth middleware — only registered chatId can use the bot
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const text = ctx.message?.text ?? '';

    // Allow /start and /help from anyone
    if (text.startsWith('/start') || text.startsWith('/help')) {
      return next();
    }

    // If no chatId registered yet, reject
    if (config.chatId === null) {
      await ctx.reply('Send /start to register this chat.');
      return;
    }

    // Only registered chat can proceed
    if (chatId !== config.chatId) {
      await ctx.reply('Unauthorized. This bot is registered to another chat.');
      return;
    }

    // Also allow callback queries from registered chat
    if (ctx.callbackQuery && chatId === config.chatId) {
      return next();
    }

    return next();
  });

  // /start — register chatId
  bot.command('start', async (ctx) => {
    const chatId = ctx.chat.id;

    if (config.chatId !== null && config.chatId !== chatId) {
      await ctx.reply(
        'This bot is already registered to another chat. Reset ~/.hudai/telegram.json to change.'
      );
      return;
    }

    config.chatId = chatId;
    saveConfig(config);

    await ctx.reply(
      `<b>Hudai Bot Registered</b> ✅\n\nChat ID: ${chatId}\nServer: ${config.serverUrl}\n\nSend /help to see available commands.`,
      { parse_mode: 'HTML' }
    );
  });

  // Register command menu with Telegram
  bot.api.setMyCommands([
    { command: 'terminal', description: 'Last ~50 lines of terminal' },
    { command: 'status', description: 'Session state & activity' },
    { command: 'summary', description: 'AI executive summary' },
    { command: 'agent', description: 'Switch to agent mode' },
    { command: 'chat', description: 'Switch to advisor mode' },
    { command: 'help', description: 'All commands' },
  ]).catch(console.error);

  // Register all commands
  bot.command('help', handleHelp);
  bot.command('terminal', handleTerminal(bridge));
  bot.command('send', (ctx) => {
    requestFollowUp(2);
    handleSend(bridge)(ctx);
  });
  bot.command('status', handleStatus(bridge));
  bot.command('intel', handleIntel(bridge));
  bot.command('summary', handleSummary(bridge));
  bot.command('pause', handlePause(bridge));
  bot.command('resume', handleResume(bridge));
  bot.command('approve', handleApprove(bridge));
  bot.command('reject', handleReject(bridge));
  bot.command('answer', handleAnswer(bridge));
  bot.command('chat', handleChatMode(mode, config));
  bot.command('agent', handleAgentMode(mode, config));
  bot.command('ask', handleAsk(bridge));
  bot.command('silent', handleSilent(config));
  bot.command('quiet', handleQuiet(bridge));
  bot.command('cost', handleCost(bridge));
  bot.command('sessions', handleSessions(bridge));
  bot.command('attach', handleAttach(bridge));
  bot.command('detach', handleDetach(bridge));
  bot.command('spawn', handleSpawn(bridge));
  bot.command('more', handleMore());

  // Auto-notifications (must be set up before callback handlers so requestFollowUp is available)
  const { requestFollowUp } = setupAutoNotifier(bot, bridge, config);

  // Inline keyboard callback handlers — trigger follow-up on approve/reject/answer
  setupCallbackHandlers(bot, bridge, () => requestFollowUp(2));

  // Menu inline keyboard callbacks
  setupMenuCallbacks(bot, bridge, config, mode, requestFollowUp);

  // Spawn command inline keyboard callbacks
  setupSpawnCallbacks(bot, bridge);

  // Intercept reply keyboard button presses → route to command handlers
  const keyboardHandlers: Record<string, (ctx: any) => void> = {
    '/terminal': handleTerminal(bridge),
    '/status': handleStatus(bridge),
    '/summary': handleSummary(bridge),
    '/cost': handleCost(bridge),
    '/approve': handleApprove(bridge),
    '/reject': handleReject(bridge),
    '/pause': handlePause(bridge),
    '/resume': handleResume(bridge),
    '/more': handleMore(),
  };

  // Track "Ask" prompt message IDs so we can route replies to the advisor
  const askPromptIds = new Set<number>();

  bot.on('message:text', (ctx, next) => {
    const text = ctx.message?.text ?? '';

    // Handle replies to spawn name prompt
    if (handleSpawnReply(ctx, bridge)) return;

    // Handle replies to "Ask" prompt → send to advisor
    const replyTo = ctx.message?.reply_to_message?.message_id;
    if (replyTo && askPromptIds.has(replyTo)) {
      askPromptIds.delete(replyTo);
      bridge.send({ kind: 'chat.send', text: text.trim() });
      ctx.reply('💬 Asking advisor...').catch(console.error);
      return;
    }

    // Handle "Ask" keyboard button → show ForceReply prompt
    const cmd = KEYBOARD_COMMANDS[text];
    if (cmd === '/ask') {
      const forceReply = {
        force_reply: true as const,
        selective: true,
        input_field_placeholder: 'Type your question...',
      };
      ctx.reply('💬 What would you like to ask the advisor?', {
        reply_markup: forceReply,
      }).then((msg) => {
        askPromptIds.add(msg.message_id);
      }).catch(console.error);
      return;
    }

    if (cmd && keyboardHandlers[cmd]) {
      keyboardHandlers[cmd](ctx);
      return;
    }
    return next();
  });

  // Plain text → agent or advisor based on mode
  // Request follow-up notes when sending to the agent
  const plainTextHandler = handlePlainText(bridge, mode);
  bot.on('message:text', (ctx) => {
    if (!mode.chatMode) requestFollowUp(2);
    return plainTextHandler(ctx);
  });

  return { bot, mode };
}

/** Push the reply keyboard to the chat (e.g. on startup) */
export async function pushKeyboard(bot: Bot, config: TelegramConfig): Promise<void> {
  if (!config.chatId) return;
  const kb = buildKeyboard(undefined); // default keyboard
  await bot.api.sendMessage(config.chatId, '🤖 Hudai bot connected.', {
    reply_markup: kb,
  });
}
