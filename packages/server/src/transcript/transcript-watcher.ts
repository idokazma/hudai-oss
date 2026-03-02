import { EventEmitter } from 'events';
import { watch, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AVPEvent, PermissionRule } from '@hudai/shared';
import { translateJsonlEntry, extractUsage, type JsonlEntry, type TranslateOptions } from './jsonl-to-avp.js';

/**
 * Watches Claude Code's JSONL transcript files for real-time structured events.
 *
 * Uses ~/.claude/history.jsonl to find the active session ID for a project,
 * then tails the corresponding {sessionId}.jsonl file.
 */
export class TranscriptWatcher extends EventEmitter {
  private transcriptDir: string;
  private projectPath: string;
  private filePath: string | null = null;
  private fileOffset = 0;
  private abortController: AbortController | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private sessionId: string;
  private seenToolIds = new Map<string, { name: string; ts: number; input?: Record<string, any> }>();
  private _active = false;
  private _permissionRules: PermissionRule[] = [];

  constructor(sessionId: string, projectPath: string) {
    super();
    this.sessionId = sessionId;
    this.projectPath = projectPath;
    const slug = TranscriptWatcher.projectSlug(projectPath);
    this.transcriptDir = join(homedir(), '.claude', 'projects', slug);
  }

  get active() {
    return this._active;
  }

  get watchedFile() {
    return this.filePath;
  }

  get transcriptDirectory() {
    return this.transcriptDir;
  }

  set permissionRules(rules: PermissionRule[]) {
    this._permissionRules = rules;
  }

  /**
   * Derive the project slug from a project path.
   * Claude Code replaces `/` and `.` with `-`, strips leading slash.
   * e.g. /Users/ido.kazma/Projects/Hudai -> -Users-ido-kazma-Projects-Hudai
   */
  static projectSlug(projectPath: string): string {
    const stripped = projectPath.startsWith('/') ? projectPath.slice(1) : projectPath;
    return '-' + stripped.replace(/[/.]/g, '-');
  }

  /**
   * Find the active session's JSONL file by reading ~/.claude/history.jsonl.
   * Each line: { project, sessionId, timestamp }
   * We find the most recent sessionId for our project path.
   */
  async findActiveTranscript(): Promise<string | null> {
    try {
      const historyPath = join(homedir(), '.claude', 'history.jsonl');
      const historyContent = await readFile(historyPath, 'utf-8');
      const lines = historyContent.split('\n');

      let latestSession = { id: '', timestamp: 0 };

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed);
          if (entry.project === this.projectPath && entry.timestamp > latestSession.timestamp) {
            latestSession = { id: entry.sessionId, timestamp: entry.timestamp };
          }
        } catch {
          // Skip malformed lines
        }
      }

      if (!latestSession.id) {
        return null;
      }

      // Check if the JSONL file exists and is recent
      const filePath = join(this.transcriptDir, `${latestSession.id}.jsonl`);
      try {
        const s = await stat(filePath);
        const ageMs = Date.now() - s.mtimeMs;
        if (ageMs > 30 * 60 * 1000) {
          return null;
        }
        return filePath;
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Start watching. Finds the active transcript and tails new lines.
   * If no transcript found, starts a retry timer (session may start after attach).
   */
  async start(): Promise<void> {
    this.filePath = await this.findActiveTranscript();

    if (!this.filePath) {
      console.log('[transcript] No active transcript found for', this.projectPath, '— retrying every 5s');
      this.startRetry();
      return;
    }

    await this.beginWatching();
  }

  private async beginWatching(): Promise<void> {
    if (!this.filePath) return;

    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }

    console.log('[transcript] Watching:', this.filePath);
    this._active = true;
    this.emit('active', this.filePath);

    // Backfill: read existing content from the start so we capture
    // earlier events (especially the first user prompt) that occurred
    // before Hudai attached.
    this.fileOffset = 0;
    await this.readNewLines();

    // Watch for changes
    this.abortController = new AbortController();
    const filePath = this.filePath;

    (async () => {
      try {
        const watcher = watch(filePath, { signal: this.abortController!.signal });
        for await (const event of watcher) {
          if (event.eventType === 'change') {
            await this.readNewLines();
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('[transcript] Watch error:', err);
        }
      }
    })();

    // Fallback poll every 2s
    this.pollTimer = setInterval(() => {
      this.readNewLines().catch(() => {});
    }, 2000);
  }

  private startRetry() {
    this.retryTimer = setInterval(async () => {
      this.filePath = await this.findActiveTranscript();
      if (this.filePath) {
        await this.beginWatching();
      }
    }, 5000);
  }

  stop() {
    this._active = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    this.filePath = null;
    this.fileOffset = 0;
    this.seenToolIds.clear();
  }

  private async readNewLines(): Promise<void> {
    if (!this.filePath) return;

    try {
      const s = await stat(this.filePath);
      if (s.size <= this.fileOffset) return;

      const buf = await readFile(this.filePath);
      const newData = buf.subarray(this.fileOffset).toString('utf-8');
      this.fileOffset = s.size;

      const lines = newData.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const entry: JsonlEntry = JSON.parse(trimmed);
          const opts: TranslateOptions | undefined = this._permissionRules.length > 0
            ? { permissionRules: this._permissionRules }
            : undefined;
          const events = translateJsonlEntry(entry, this.sessionId, this.seenToolIds, opts);
          for (const event of events) {
            this.emit('event', event);
          }
          // Extract token usage for cost tracking
          const usageData = extractUsage(entry);
          if (usageData) {
            this.emit('usage', usageData);
          }
        } catch {
          // Partial JSON at end of file — will be complete next read
        }
      }
    } catch {
      // File might have been rotated
    }
  }
}
