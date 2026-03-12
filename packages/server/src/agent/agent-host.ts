import { EventEmitter } from 'events';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { translateJsonlEntry, extractUsage, type JsonlEntry } from '../transcript/jsonl-to-avp.js';
import type { AVPEvent, PermissionRule } from '@hudai/shared';

export interface AgentHostOptions {
  projectPath: string;
  prompt?: string;
  resumeSessionId?: string;
  allowedTools?: string[];
}

function findBinary(name: string): string {
  try {
    return execSync(`zsh -lc "which ${name}"`, { encoding: 'utf-8' }).trim();
  } catch {
    return name;
  }
}

const CLAUDE_BIN = findBinary('claude');

/**
 * Spawns `claude --print --output-format stream-json` as a child process.
 * Reads structured JSON events from stdout and translates them to AVP events
 * using the existing jsonl-to-avp.ts translation layer.
 *
 * Replaces AgentProcess (tmux) + TranscriptWatcher (JSONL file tailing)
 * with a single unified event source.
 *
 * Events emitted:
 *   'event'  (AVPEvent)                    — translated from stream-json
 *   'usage'  ({ usage, model, timestamp }) — token usage data
 *   'result' ({ sessionId, result, subtype }) — process completed
 *   'output' (text: string)                — raw assistant text for terminal view
 *   'exit'   (code: number | null)         — process exited
 */
export class AgentHost extends EventEmitter {
  private proc: ChildProcess | null = null;
  private sessionId: string = '';
  private claudeSessionId: string | null = null;
  private projectPath: string = '';
  private seenToolIds = new Map<string, { name: string; ts: number; input?: Record<string, any> }>();
  private buffer: string = '';
  private _running = false;
  permissionRules: PermissionRule[] = [];

  get running() { return this._running; }
  get claudeSession() { return this.claudeSessionId; }

  spawn(sessionId: string, options: AgentHostOptions): void {
    if (this.proc) {
      this.terminate();
    }

    this.sessionId = sessionId;
    this.projectPath = options.projectPath;
    this.buffer = '';

    const args = ['--print', '--output-format', 'stream-json'];

    if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId);
    }

    if (options.allowedTools) {
      args.push('--allowedTools', options.allowedTools.join(','));
    }

    if (options.prompt) {
      args.push(options.prompt);
    }

    console.log(`[agent-host] Spawning: ${CLAUDE_BIN} ${args.join(' ')}`);

    this.proc = spawn(CLAUDE_BIN, args, {
      cwd: options.projectPath,
      env: { ...process.env, CLAUDECODE: undefined },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._running = true;

    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        console.log(`[agent-host:stderr] ${text}`);
      }
    });

    this.proc.on('exit', (code) => {
      this._running = false;
      this.proc = null;
      console.log(`[agent-host] Process exited with code ${code}`);
      this.emit('exit', code);
    });

    this.proc.on('error', (err) => {
      this._running = false;
      this.proc = null;
      console.error('[agent-host] Process error:', err);
      this.emit('exit', -1);
    });
  }

  terminate(): void {
    if (this.proc) {
      console.log('[agent-host] Terminating process');
      this.proc.kill('SIGTERM');
      // Force kill after 5s if still alive
      const p = this.proc;
      setTimeout(() => {
        try { p.kill('SIGKILL'); } catch { /* already dead */ }
      }, 5000);
    }
  }

  /**
   * Resume the conversation by spawning a new process with --resume.
   * Uses the claudeSessionId captured from the last "result" event.
   */
  resume(prompt: string): void {
    if (!this.claudeSessionId) {
      console.warn('[agent-host] Cannot resume — no Claude session ID (send a prompt first)');
      return;
    }
    this.spawn(this.sessionId, {
      projectPath: this.projectPath,
      prompt,
      resumeSessionId: this.claudeSessionId,
    });
  }

  /**
   * Write text to the process stdin (for interactive scenarios).
   * In --print mode this is rarely needed.
   */
  writeStdin(text: string): void {
    if (this.proc?.stdin?.writable) {
      this.proc.stdin.write(text);
    }
  }

  destroy(): void {
    this.terminate();
    this.seenToolIds.clear();
    this.claudeSessionId = null;
    this.buffer = '';
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // Keep last incomplete line in buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const entry = JSON.parse(trimmed);
        this.handleEntry(entry);
      } catch {
        // Not valid JSON — could be Claude startup output
        console.log(`[agent-host:raw] ${trimmed}`);
      }
    }
  }

  private handleEntry(entry: any): void {
    // Handle the "result" event — final output from --print mode
    if (entry.type === 'result') {
      this.claudeSessionId = entry.session_id || null;
      this.emit('result', {
        sessionId: entry.session_id,
        result: entry.result,
        subtype: entry.subtype,
        costUsd: entry.cost_usd,
        isError: entry.is_error,
        totalTurns: entry.total_turns,
      });
      return;
    }

    // Translate as a JSONL entry — same format as transcript files
    const jsonlEntry = entry as JsonlEntry;

    // Extract and emit usage data
    const usage = extractUsage(jsonlEntry);
    if (usage) {
      this.emit('usage', usage);
    }

    // Emit raw text output for terminal preview
    if (jsonlEntry.type === 'assistant' && Array.isArray(jsonlEntry.message?.content)) {
      for (const block of jsonlEntry.message!.content!) {
        if (block.type === 'text' && 'text' in block && (block as any).text) {
          this.emit('output', (block as any).text);
        }
      }
    }

    // Translate to AVP events
    const events = translateJsonlEntry(jsonlEntry, this.sessionId, this.seenToolIds, {
      permissionRules: this.permissionRules,
    });

    for (const event of events) {
      event.source = 'stream';
      this.emit('event', event);
    }
  }
}
