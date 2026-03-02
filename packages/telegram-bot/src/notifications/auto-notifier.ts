import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import type { TelegramConfig } from '../config/config.js';
import type { ServerMessage, AgentActivity } from '@hudai/shared';
import { stripAnsi, truncate } from './formatters.js';

function escHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Get the last N lines of terminal output as a code block */
function terminalSnippet(bridge: WsBridge, lines = 20): string {
  if (!bridge.cache.paneContent) return '';
  const all = stripAnsi(bridge.cache.paneContent).split('\n');
  const tail = all.slice(-lines).join('\n').trim();
  if (!tail) return '';
  return `<pre>${escHtml(truncate(tail, 3500))}</pre>`;
}

/** Extract a short project label from the session target (e.g. "lettersAgent:0.0" → "lettersAgent") */
function projectTag(bridge: WsBridge): string {
  const target = bridge.cache.session?.tmuxTarget;
  if (!target) return '';
  const name = target.split(':')[0];
  return `<b>[${escHtml(name)}]</b> `;
}

/** Build a ReplyKeyboard based on current agent activity */
export function buildKeyboard(activity: AgentActivity | undefined): Keyboard {
  const kb = new Keyboard().resized().persistent();

  switch (activity) {
    case 'waiting_permission':
      kb.text('✅ Approve').text('❌ Reject').row();
      kb.text('📟 Terminal').text('📊 Status').row();
      break;
    case 'waiting_answer':
      kb.text('📟 Terminal').text('📊 Status').row();
      kb.text('📋 Summary').text('💬 Ask').row();
      break;
    case 'working':
      kb.text('⏸ Pause').text('📟 Terminal').row();
      kb.text('📊 Status').text('📋 Summary').row();
      break;
    case 'waiting_input':
    default:
      kb.text('📟 Terminal').text('📊 Status').row();
      kb.text('📋 Summary').text('💬 Ask').row();
      break;
  }

  // Always add "More" button as the last row
  kb.text('⋯ More').row();

  return kb;
}

/** Map reply keyboard button text to commands */
export const KEYBOARD_COMMANDS: Record<string, string> = {
  '✅ Approve': '/approve',
  '❌ Reject': '/reject',
  '⏸ Pause': '/pause',
  '▶️ Resume': '/resume',
  '📟 Terminal': '/terminal',
  '📊 Status': '/status',
  '📋 Summary': '/summary',
  '💬 Ask': '/ask',
  '⋯ More': '/more',
};

interface NotifierState {
  lastActivity: AgentActivity | undefined;
  lastIntentTime: number;
  lastContextAlert: number;
  idleSent: boolean;
  /** After a Telegram user sends a command, forward the next N notes back */
  followUpRemaining: number;
}

export function setupAutoNotifier(
  bot: Bot,
  bridge: WsBridge,
  config: TelegramConfig
): { unsub: () => void; requestFollowUp: (count?: number) => void } {
  const state: NotifierState = {
    lastActivity: undefined,
    lastIntentTime: 0,
    lastContextAlert: 0,
    idleSent: false,
    followUpRemaining: 0,
  };

  const send = (text: string, options?: { reply_markup?: InlineKeyboard; parse_mode?: 'HTML' }) => {
    if (!config.chatId) return;
    // Attach current reply keyboard to every message (unless an InlineKeyboard is provided)
    const markup = options?.reply_markup ?? buildKeyboard(state.lastActivity);
    bot.api.sendMessage(config.chatId, text, {
      parse_mode: options?.parse_mode ?? 'HTML',
      reply_markup: markup,
    }).catch(console.error);
  };

  const unsub = bridge.onMessage((msg: ServerMessage) => {
    if (!config.chatId) return;

    switch (msg.kind) {
      case 'session.state': {
        const activity = msg.state.agentActivity;
        const prev = state.lastActivity;
        state.lastActivity = activity;

        // Permission prompt → terminal snippet + Approve/Reject
        if (activity === 'waiting_permission' && prev !== 'waiting_permission') {
          if (config.silentMode) return;
          const terminal = terminalSnippet(bridge);
          const kb = new InlineKeyboard()
            .text('✅ Approve', 'action:approve')
            .text('❌ Reject', 'action:reject');
          send(
            `${projectTag(bridge)}🔐 <b>Permission Needed</b>\n\n${terminal}`,
            { reply_markup: kb },
          );
        }

        // Question → terminal snippet + option buttons
        if (activity === 'waiting_answer' && prev !== 'waiting_answer') {
          if (config.silentMode) return;
          const terminal = terminalSnippet(bridge);
          const options = msg.state.agentActivityOptions ?? [];

          const kb = new InlineKeyboard();
          if (options.length > 0) {
            options.forEach((opt, i) => {
              kb.text(`${i + 1}. ${opt.slice(0, 30)}`, `answer:${i + 1}`);
              if ((i + 1) % 2 === 0) kb.row();
            });
          }

          send(
            `${projectTag(bridge)}❓ <b>Question</b>\n\n${terminal}`,
            { reply_markup: options.length > 0 ? kb : undefined },
          );
        }

        // Agent went idle — always sent (even in silent mode)
        if (activity === 'waiting_input' && prev !== 'waiting_input' && !state.idleSent) {
          state.idleSent = true;
          const terminal = terminalSnippet(bridge, 15);
          send(`${projectTag(bridge)}✅ <b>Agent finished</b> — waiting for next command.\n\n${terminal}`);
        }

        // Reset idle flag when agent starts working again
        if (activity === 'working') {
          state.idleSent = false;
        }

        break;
      }

      case 'insight.notification': {
        const n = msg.notification;
        // Idle notification from stale detection — send if not already sent
        if (n.triggeredBy === 'activity.idle') {
          if (!state.idleSent) {
            state.idleSent = true;
            const terminal = terminalSnippet(bridge, 15);
            send(`${projectTag(bridge)}✅ <b>Agent finished</b> — waiting for next command.\n\n${terminal}`);
          }
          return;
        }
        // Critical and session errors always sent
        const alwaysSend = n.severity === 'critical';
        if (!alwaysSend && config.silentMode) return;

        const icon = n.severity === 'critical' ? '🔴' : n.severity === 'warning' ? '🟡' : '🔵';
        send(`${projectTag(bridge)}${icon} <b>${escHtml(n.severity.toUpperCase())}</b>\n${escHtml(n.text)}`);
        break;
      }

      case 'insight.intent': {
        const now = Date.now();
        const isFollowUp = state.followUpRemaining > 0;

        if (isFollowUp) {
          state.followUpRemaining--;
          state.lastIntentTime = now;
          send(`${projectTag(bridge)}🧭 Now: ${escHtml(msg.intent.text)}`);
          break;
        }

        if (config.silentMode) return;
        // Debounce: max 1 intent update per 60s
        if (now - state.lastIntentTime < 60_000) return;
        state.lastIntentTime = now;

        send(`${projectTag(bridge)}🧭 Now: ${escHtml(msg.intent.text)}`);
        break;
      }

      case 'chat.message': {
        const cm = msg.message;
        // Skip user messages — they already see what they typed
        if (cm.role === 'user') break;

        if (cm.role === 'system') {
          send(`<i>${escHtml(cm.text)}</i>`);
          break;
        }

        // Advisor messages
        if (cm.proactive) {
          if (config.silentMode) break;
          const icon = cm.severity === 'critical' ? '🔴'
            : cm.severity === 'warning' ? '🟡' : '✦';
          send(`${projectTag(bridge)}${icon} <b>Advisor</b>\n${escHtml(cm.text)}`);
        } else {
          send(`${projectTag(bridge)}✦ <b>Advisor</b>\n${escHtml(cm.text)}`);
        }
        break;
      }

      case 'tokens.state': {
        const pct = msg.state.contextPercent;
        const now = Date.now();
        // Alert at 80%, 90%, 95% — max once per 5 min
        if (pct >= 80 && now - state.lastContextAlert > 300_000) {
          state.lastContextAlert = now;
          const emoji = pct >= 95 ? '🔴' : pct >= 90 ? '🟠' : '🟡';
          // Always sent (critical threshold)
          send(`${projectTag(bridge)}${emoji} <b>Context Window: ${pct}%</b>`);
        }
        break;
      }
    }
  });

  /** Signal that user sent a command — forward the next N agent notes */
  const requestFollowUp = (count = 2) => {
    state.followUpRemaining = count;
  };

  return { unsub, requestFollowUp };
}

/**
 * Set up callback query handlers for inline keyboard buttons.
 */
export function setupCallbackHandlers(bot: Bot, bridge: WsBridge, onAction?: () => void): void {
  bot.callbackQuery(/^action:approve$/, async (ctx) => {
    bridge.send({ kind: 'command', command: { type: 'approve' } });
    onAction?.();
    await ctx.answerCallbackQuery({ text: 'Approved!' });
    await ctx.editMessageText(
      `${ctx.callbackQuery.message?.text ?? ''}\n\n✅ Approved`,
    ).catch(() => {});
  });

  bot.callbackQuery(/^action:reject$/, async (ctx) => {
    bridge.send({ kind: 'command', command: { type: 'reject' } });
    onAction?.();
    await ctx.answerCallbackQuery({ text: 'Rejected.' });
    await ctx.editMessageText(
      `${ctx.callbackQuery.message?.text ?? ''}\n\n❌ Rejected`,
    ).catch(() => {});
  });

  bot.callbackQuery(/^answer:(\d+)$/, async (ctx) => {
    const num = ctx.match![1];
    bridge.send({
      kind: 'command',
      command: { type: 'prompt', data: { text: num } },
    });
    onAction?.();
    await ctx.answerCallbackQuery({ text: `Answered: ${num}` });
    await ctx.editMessageText(
      `${ctx.callbackQuery.message?.text ?? ''}\n\n✅ Answered: ${num}`,
    ).catch(() => {});
  });
}
