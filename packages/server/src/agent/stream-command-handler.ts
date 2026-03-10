import type { SteeringCommand } from '@hudai/shared';
import type { AgentHost } from './agent-host.js';

/**
 * Handles steering commands in stream-json mode.
 * Instead of tmux send-keys, commands are handled through process control:
 *   - Text input → new --resume invocation
 *   - Abort/pause → process termination
 */
export class StreamCommandHandler {
  constructor(private host: AgentHost) {}

  handle(command: SteeringCommand) {
    console.log(`[stream-command] Handling: ${command.type}`, 'data' in command ? (command as any).data : '');

    switch (command.type) {
      case 'focus_file':
        this.host.resume(
          `Please focus on the file \`${command.data.path}\`. Read it and prioritize working on it.`
        );
        break;

      case 'scope_boundary': {
        const fileList = command.data.files.join(', ');
        this.host.resume(
          `IMPORTANT: Only modify files within this scope: ${fileList}. Do NOT touch any files outside this list.`
        );
        break;
      }

      case 'prompt':
        this.host.resume(command.data.text);
        break;

      case 'pause':
      case 'cancel':
        this.host.terminate();
        break;

      case 'resume':
        this.host.resume('Continue with the previous task.');
        break;

      case 'approve':
        // In --print mode with --allowedTools, permissions are pre-configured.
        // If a permission hook fires, the user can terminate instead.
        // For now, this is a no-op in stream mode.
        console.log('[stream-command] approve — not applicable in stream mode');
        break;

      case 'reject':
        // Reject = terminate the current process
        this.host.terminate();
        break;

      case 'clear':
        // Clear = start fresh (no --resume)
        console.log('[stream-command] clear — session will start fresh on next prompt');
        break;

      case 'send_keys':
      case 'send_text':
        // No TTY in stream mode — these are not supported
        console.log(`[stream-command] ${command.type} — not supported in stream mode`);
        break;
    }
  }
}
