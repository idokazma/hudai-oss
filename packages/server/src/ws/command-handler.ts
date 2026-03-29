import type { SteeringCommand } from '@hudai/shared';
import type { AgentProcess } from '../pty/agent-process.js';

export class CommandHandler {
  constructor(private agent: AgentProcess) {}

  handle(command: SteeringCommand) {
    console.log(`[command] Handling: ${command.type}`, 'data' in command ? command.data : '');

    switch (command.type) {
      case 'focus_file':
        this.agent.write(
          `Please focus on the file \`${command.data.path}\`. Read it and prioritize working on it.`
        );
        this.agent.sendEnter();
        break;

      case 'scope_boundary': {
        const fileList = command.data.files.join(', ');
        this.agent.write(
          `IMPORTANT: Only modify files within this scope: ${fileList}. Do NOT touch any files outside this list.`
        );
        this.agent.sendEnter();
        break;
      }

      case 'prompt':
        this.agent.write(command.data.text);
        this.agent.sendEnter();
        break;

      case 'pause':
        this.agent.sendInterrupt();
        break;

      case 'resume':
        this.agent.write('Continue with the previous task.');
        this.agent.sendEnter();
        break;

      case 'cancel':
        this.agent.sendInterrupt();
        break;

      case 'approve':
        this.agent.write('y');
        this.agent.sendEnter();
        break;

      case 'reject':
        this.agent.write('n');
        this.agent.sendEnter();
        break;

      case 'clear':
        this.agent.write('/clear');
        this.agent.sendEnter();
        break;

      case 'send_keys':
        this.agent.sendKeys(command.data.keys);
        break;

      case 'send_text':
        this.agent.write(command.data.text);
        break;

      // UI-only commands — no tmux action needed
      case 'toggle_detail':
      case 'toggle_explain':
      case 'set_auto_expand':
        break;

      // Handled externally in index.ts before reaching CommandHandler
      case 'spawn_agent':
        break;

      default: {
        // Exhaustive check — TypeScript will error if a new command type is added but not handled
        const _exhaustive: never = command;
        console.warn(`[command] Unhandled command type: ${(_exhaustive as any).type}`);
      }
    }
  }
}
