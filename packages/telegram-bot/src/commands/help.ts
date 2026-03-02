import type { Context } from 'grammy';

const HELP_TEXT = `<b>Hudai Telegram Bot</b>

<b>Read-only:</b>
/status - Session state &amp; activity
/terminal - Last ~50 lines of terminal
/cost - Token usage, cost, burn rate
/intel - Current intent + recent notifications
/sessions - List available tmux panes

<b>Steering:</b>
/send &lt;text&gt; - Send text to agent
/pause - Pause the agent
/resume - Resume the agent
/approve - Approve permission prompt
/reject - Reject permission prompt
/answer &lt;n&gt; - Answer numbered question
/summary - Request AI executive summary

<b>Session management:</b>
/attach &lt;target&gt; - Switch to tmux pane
/detach - Detach from current session
/spawn - Duplicate a running agent in the same directory

<b>Advisor Chat:</b>
/chat - Switch to advisor mode
/agent - Switch to agent mode
/ask &lt;question&gt; - One-shot advisor question

<b>Settings:</b>
/silent [on|off] - Toggle notification mode
/quiet [on|off] - Toggle periodic summaries
/help - This message

<i>Plain text → agent (/agent mode) or advisor (/chat mode).</i>`;

export function handleHelp(ctx: Context): void {
  ctx.reply(HELP_TEXT, { parse_mode: 'HTML' }).catch(console.error);
}
