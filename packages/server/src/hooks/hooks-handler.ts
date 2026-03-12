import { EventEmitter } from 'events';
import type { AgentActivity } from '@hudai/shared';

/**
 * Maps Claude Code hook notification matchers to Hudai agent activity states.
 *
 * Claude Code fires Notification hooks with these matchers:
 *   - permission_prompt  → agent needs tool approval
 *   - idle_prompt        → agent is idle, waiting for input
 *   - elicitation_dialog → agent is asking a question
 *   - auth_success       → authentication completed (not an activity state)
 *
 * See: https://code.claude.com/docs/en/hooks-guide
 */

export interface HookNotification {
  /** The hook matcher that triggered (e.g. "permission_prompt") */
  matcher: string;
  /** Optional detail text from Claude Code */
  message?: string;
  /** Tool name (for permission_prompt) */
  tool?: string;
  /** Command or description (for permission_prompt) */
  command?: string;
  /** Question text (for elicitation_dialog) */
  question?: string;
  /** Options (for elicitation_dialog) */
  options?: string[];
}

export interface ActivityUpdate {
  activity: AgentActivity;
  detail?: string;
  options?: string[];
}

const MATCHER_TO_ACTIVITY: Record<string, AgentActivity> = {
  permission_prompt: 'waiting_permission',
  idle_prompt: 'waiting_input',
  elicitation_dialog: 'waiting_answer',
};

export class HooksHandler extends EventEmitter {
  /**
   * Process an incoming hook notification from Claude Code.
   * Emits 'activity' with an ActivityUpdate when the notification
   * maps to a known activity state.
   */
  handleNotification(notification: HookNotification): ActivityUpdate | null {
    const activity = MATCHER_TO_ACTIVITY[notification.matcher];
    if (!activity) {
      // auth_success or unknown matcher — not an activity state
      return null;
    }

    const update: ActivityUpdate = { activity };

    switch (notification.matcher) {
      case 'permission_prompt':
        if (notification.tool && notification.command) {
          update.detail = `${notification.tool}: ${notification.command}`;
        } else if (notification.tool) {
          update.detail = `Approval needed: ${notification.tool}`;
        } else if (notification.message) {
          update.detail = notification.message;
        } else {
          update.detail = 'Approval needed';
        }
        break;

      case 'idle_prompt':
        update.detail = 'Agent is idle — waiting for instructions';
        break;

      case 'elicitation_dialog':
        update.detail = notification.question || notification.message || 'Agent is asking a question';
        update.options = notification.options;
        break;
    }

    this.emit('activity', update);
    return update;
  }
}
