import { EventEmitter } from 'events';
import type { AVPEvent } from '@hudai/shared';
import { TranscriptWatcher } from '../transcript/transcript-watcher.js';
import { SubagentWatcher } from '../transcript/subagent-watcher.js';
import { StatusDetector, type SessionStatus } from './session-status.js';
import type { ActivityUpdate } from '../hooks/hooks-handler.js';
import type { JsonlEntry } from '../transcript/jsonl-to-avp.js';
import type { PermissionRule } from '@hudai/shared';

export interface SessionMetrics {
  model?: string;
  tokensUsed: number;
  turnCount: number;
  toolCount: number;
  lastActivity: number;
}

/**
 * SessionMonitor — Unified JSONL-based engine for monitoring a Claude Code session.
 *
 * Wraps TranscriptWatcher (event parsing) + StatusDetector (activity detection).
 * Replaces the combination of transcript-watcher + pane-analyzer.
 *
 * Modes:
 *   'full'        — Emits AVP events + status + usage. For the attached session.
 *   'lightweight'  — Status + metrics only. For background swarm sessions.
 *
 * Events emitted:
 *   'event'   — AVPEvent (full mode only)
 *   'status'  — SessionStatus (activity change)
 *   'usage'   — { usage, model, timestamp } (full mode only)
 *   'active'  — JSONL file found and tailing started
 */
export class SessionMonitor extends EventEmitter {
  private watcher: TranscriptWatcher | null = null;
  private subagentWatcher: SubagentWatcher | null = null;
  private statusDetector: StatusDetector;
  private metrics: SessionMetrics = {
    tokensUsed: 0,
    turnCount: 0,
    toolCount: 0,
    lastActivity: 0,
  };
  private _active = false;
  private _lastMessage: string | undefined;

  constructor(
    private sessionId: string,
    private projectPath: string,
    private mode: 'full' | 'lightweight' = 'full',
  ) {
    super();
    this.statusDetector = new StatusDetector();
    this.statusDetector.onChange = (status) => {
      this.emit('status', status);
    };
  }

  get active(): boolean {
    return this._active;
  }

  get lastMessage(): string | undefined {
    return this._lastMessage;
  }

  get transcriptDirectory(): string | null {
    return this.watcher?.transcriptDirectory ?? null;
  }

  get watchedFile(): string | null {
    return this.watcher?.watchedFile ?? null;
  }

  set permissionRules(rules: PermissionRule[]) {
    if (this.watcher) {
      this.watcher.permissionRules = rules;
    }
  }

  getStatus(): SessionStatus {
    return this.statusDetector.getStatus();
  }

  getMetrics(): SessionMetrics {
    return { ...this.metrics };
  }

  /**
   * Accept a real-time hook update (bypasses JSONL polling delay).
   */
  applyHookUpdate(update: ActivityUpdate): void {
    this.statusDetector.applyHookUpdate(update);
  }

  async start(): Promise<void> {
    this.watcher = new TranscriptWatcher(this.sessionId, this.projectPath);
    this.statusDetector.start();

    // Wire JSONL entry processing for status detection
    this.watcher.on('entry', (entry: JsonlEntry) => {
      this.statusDetector.processEntry(entry);
      this.metrics.lastActivity = Date.now();

      // Track metrics from entries
      if (entry.type === 'user') {
        this.metrics.turnCount++;
      }
      if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
        for (const block of entry.message!.content!) {
          if ((block as any).type === 'tool_use') {
            this.metrics.toolCount++;
          }
          if ((block as any).type === 'text') {
            const text = ((block as any).text || '').trim();
            if (text.length >= 20 && !text.startsWith('<system-reminder') && !text.startsWith('<task-notification')) {
              const firstLine = text.split('\n').find((l: string) => l.trim().length > 10)?.trim();
              this._lastMessage = (firstLine || text).slice(0, 200);
            }
          }
        }
      }
      // Track model
      if (entry.message?.model) {
        this.metrics.model = entry.message.model;
      }
    });

    if (this.mode === 'full') {
      // Full mode: forward AVP events + usage
      this.watcher.on('event', (event: AVPEvent) => {
        this.emit('event', event);
      });

      this.watcher.on('usage', (data: { usage: any; model: string; timestamp: number }) => {
        this.metrics.tokensUsed += (data.usage.inputTokens || 0) + (data.usage.outputTokens || 0);
        if (data.model) this.metrics.model = data.model;
        this.emit('usage', data);
      });

      this.watcher.on('active', (path: string) => {
        this._active = true;
        this.emit('active', path);

        // Start sub-agent watcher
        if (this.watcher?.transcriptDirectory) {
          this.subagentWatcher = new SubagentWatcher(this.watcher.transcriptDirectory, this.sessionId);
          this.subagentWatcher.on('event', (event: AVPEvent) => {
            this.emit('event', event);
          });
          this.subagentWatcher.start().catch(() => {});
        }
      });
    } else {
      // Lightweight: just track when active
      this.watcher.on('active', () => {
        this._active = true;
      });
    }

    await this.watcher.start();
  }

  stop(): void {
    this.statusDetector.stop();
    this.watcher?.stop();
    this.subagentWatcher?.stop();
    this.watcher = null;
    this.subagentWatcher = null;
    this._active = false;
  }

  reset(): void {
    this.stop();
    this.statusDetector.reset();
    this.metrics = {
      tokensUsed: 0,
      turnCount: 0,
      toolCount: 0,
      lastActivity: 0,
    };
  }
}
