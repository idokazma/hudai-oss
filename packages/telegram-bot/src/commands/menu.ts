import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import type { WsBridge } from '../ws-bridge.js';
import type { TelegramConfig } from '../config/config.js';
import type { BotMode } from './chat.js';

// ─── Keyboards ───

function categoriesKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📡 Monitor', 'menu:monitor').text('🎮 Steer', 'menu:steer').row()
    .text('🔄 Sessions', 'menu:sessions').text('💬 Chat', 'menu:chat').row()
    .text('⚙️ Settings', 'menu:settings');
}

function monitorKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📟 Terminal', 'menu:terminal').text('📊 Status', 'menu:status').row()
    .text('💰 Cost', 'menu:cost').text('🔍 Intel', 'menu:intel').row()
    .text('« Back', 'menu:back');
}

function steerKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('⏸ Pause', 'menu:pause').text('▶️ Resume', 'menu:resume').row()
    .text('📋 Summary', 'menu:summary').row()
    .text('« Back', 'menu:back');
}

function sessionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📋 List / Attach', 'menu:list').text('🧬 Spawn', 'menu:spawn').row()
    .text('🔌 Detach', 'menu:detach').row()
    .text('« Back', 'menu:back');
}

function chatKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('💬 Chat Mode', 'menu:chatmode').text('🤖 Agent Mode', 'menu:agentmode').row()
    .text('« Back', 'menu:back');
}

function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔇 Silent', 'menu:silent').text('🔕 Quiet', 'menu:quiet').row()
    .text('« Back', 'menu:back');
}

// ─── Entry point ───

/** Handle the /more command or keyboard button — sends the top-level menu */
export function handleMore() {
  return async (ctx: any) => {
    await ctx.reply('Choose a category:', { reply_markup: categoriesKeyboard() });
  };
}

// ─── Callback registration ───

export function setupMenuCallbacks(
  bot: Bot,
  bridge: WsBridge,
  config: TelegramConfig,
  mode: BotMode,
  requestFollowUp: (count?: number) => void,
): void {

  // ── Category navigation (edit in place) ──

  bot.callbackQuery('menu:monitor', async (ctx) => {
    await ctx.editMessageText('📡 Monitor', { reply_markup: monitorKeyboard() });
    await ctx.answerCallbackQuery();
  });
  bot.callbackQuery('menu:steer', async (ctx) => {
    await ctx.editMessageText('🎮 Steer', { reply_markup: steerKeyboard() });
    await ctx.answerCallbackQuery();
  });
  bot.callbackQuery('menu:sessions', async (ctx) => {
    await ctx.editMessageText('🔄 Sessions', { reply_markup: sessionsKeyboard() });
    await ctx.answerCallbackQuery();
  });
  bot.callbackQuery('menu:chat', async (ctx) => {
    await ctx.editMessageText('💬 Chat', { reply_markup: chatKeyboard() });
    await ctx.answerCallbackQuery();
  });
  bot.callbackQuery('menu:settings', async (ctx) => {
    await ctx.editMessageText('⚙️ Settings', { reply_markup: settingsKeyboard() });
    await ctx.answerCallbackQuery();
  });
  bot.callbackQuery('menu:back', async (ctx) => {
    await ctx.editMessageText('Choose a category:', { reply_markup: categoriesKeyboard() });
    await ctx.answerCallbackQuery();
  });

  // ── Monitor commands ──

  bot.callbackQuery('menu:terminal', async (ctx) => {
    const content = bridge.cache.paneContent;
    if (content) {
      const tail = content.split('\n').slice(-50).join('\n').trim();
      const truncated = tail.length > 4000 ? tail.slice(-4000) : tail;
      await ctx.reply(`<pre>${esc(truncated)}</pre>`, { parse_mode: 'HTML' });
    } else {
      await ctx.reply('No terminal content available.');
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('menu:status', async (ctx) => {
    const s = bridge.cache.session;
    if (s) {
      const lines = [
        `<b>Status:</b> ${s.status}`,
        `<b>Activity:</b> ${s.agentActivity ?? 'unknown'}`,
        `<b>Task:</b> ${s.taskLabel}`,
        `<b>Events:</b> ${s.eventCount}`,
      ];
      if (s.tmuxTarget) lines.push(`<b>Pane:</b> ${s.tmuxTarget}`);
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
    } else {
      await ctx.reply('No active session.');
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('menu:cost', async (ctx) => {
    const tokens = bridge.cache.tokens;
    if (tokens) {
      await ctx.reply(
        `<b>Context:</b> ${tokens.contextPercent}%\n<b>Cost:</b> $${tokens.totalCost?.toFixed(4) ?? '?'}`,
        { parse_mode: 'HTML' },
      );
    } else {
      await ctx.reply('No cost data available.');
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('menu:intel', async (ctx) => {
    const intent = bridge.cache.intent;
    if (intent) {
      await ctx.reply(`🧭 <b>Current Intent:</b> ${esc(intent.text)}`, { parse_mode: 'HTML' });
    } else {
      await ctx.reply('No intel available.');
    }
    await ctx.answerCallbackQuery();
  });

  // ── Steer commands ──

  bot.callbackQuery('menu:pause', async (ctx) => {
    bridge.send({ kind: 'command', command: { type: 'pause' } });
    await ctx.answerCallbackQuery({ text: 'Paused' });
  });

  bot.callbackQuery('menu:resume', async (ctx) => {
    bridge.send({ kind: 'command', command: { type: 'resume' } });
    requestFollowUp(2);
    await ctx.answerCallbackQuery({ text: 'Resumed' });
  });

  bot.callbackQuery('menu:summary', async (ctx) => {
    bridge.send({ kind: 'insight.requestSummary' });
    await ctx.answerCallbackQuery({ text: 'Generating summary...' });
  });

  // ── Session commands ──

  bot.callbackQuery('menu:list', async (ctx) => {
    await ctx.answerCallbackQuery();
    const panes = await fetchPanes(bridge);
    if (!panes || panes.length === 0) {
      await ctx.reply('No tmux panes found.');
      return;
    }
    const kb = new InlineKeyboard();
    for (const p of panes) {
      kb.text(`${p.id} — ${p.command}`, `menu:attach:${p.id}`).row();
    }
    await ctx.reply('<b>Sessions</b> — tap to attach:', { parse_mode: 'HTML', reply_markup: kb });
  });

  bot.callbackQuery(/^menu:attach:(.+)$/, async (ctx) => {
    const paneId = ctx.match![1];
    bridge.send({ kind: 'session.attach', tmuxTarget: paneId });
    await ctx.answerCallbackQuery({ text: `Attaching to ${paneId}...` });
    await ctx.editMessageText(`Attaching to <code>${esc(paneId)}</code>...`, { parse_mode: 'HTML' }).catch(() => {});
  });

  bot.callbackQuery('menu:detach', async (ctx) => {
    bridge.send({ kind: 'session.detach' });
    await ctx.answerCallbackQuery({ text: 'Detached' });
  });

  bot.callbackQuery('menu:spawn', async (ctx) => {
    await ctx.answerCallbackQuery();
    const panes = await fetchPanes(bridge);
    if (!panes || panes.length === 0) {
      await ctx.reply('No running agents to duplicate.');
      return;
    }
    const kb = new InlineKeyboard();
    for (const p of panes) {
      kb.text(`${p.id} — ${p.command}`, `menu:clone:${p.id}`).row();
    }
    await ctx.reply('🧬 Select a session to duplicate:', { reply_markup: kb });
  });

  bot.callbackQuery(/^menu:clone:(.+)$/, async (ctx) => {
    const paneId = ctx.match![1];
    bridge.send({ kind: 'session.clone', tmuxTarget: paneId });
    await ctx.answerCallbackQuery({ text: 'Spawning...' });
    await ctx.editMessageText(
      `🧬 Spawning from <code>${esc(paneId)}</code>...\nHudai will auto-attach when ready.`,
      { parse_mode: 'HTML' },
    ).catch(() => {});
  });

  // ── Chat commands ──

  bot.callbackQuery('menu:chatmode', async (ctx) => {
    mode.chatMode = true;
    await ctx.answerCallbackQuery({ text: 'Chat mode' });
    await ctx.reply('💬 Chat mode — messages go to the advisor.');
  });

  bot.callbackQuery('menu:agentmode', async (ctx) => {
    mode.chatMode = false;
    await ctx.answerCallbackQuery({ text: 'Agent mode' });
    await ctx.reply('🤖 Agent mode — messages go to the terminal.');
  });

  // ── Settings commands ──

  bot.callbackQuery('menu:silent', async (ctx) => {
    config.silentMode = !config.silentMode;
    const label = config.silentMode ? 'ON' : 'OFF';
    await ctx.answerCallbackQuery({ text: `Silent: ${label}` });
    await ctx.reply(`🔇 Silent mode: <b>${label}</b>`, { parse_mode: 'HTML' });
  });

  bot.callbackQuery('menu:quiet', async (ctx) => {
    bridge.send({ kind: 'settings.advisor', verbosity: 'quiet' });
    await ctx.answerCallbackQuery({ text: 'Quiet' });
    await ctx.reply('🔕 Advisor verbosity: <b>quiet</b>', { parse_mode: 'HTML' });
  });
}

// ─── Helpers ───

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function fetchPanes(bridge: WsBridge): Promise<Array<{ id: string; command: string }> | null> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 5000));
  const panesPromise = new Promise<any>((resolve) => {
    const unsub = bridge.onMessage((msg: any) => {
      if (msg.kind === 'panes.list') { unsub(); resolve(msg); }
    });
  });
  bridge.send({ kind: 'panes.list' });
  const result = await Promise.race([panesPromise, timeout]);
  if (!result || result.kind !== 'panes.list') return null;
  return result.panes;
}
