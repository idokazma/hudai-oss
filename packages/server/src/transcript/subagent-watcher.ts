import { EventEmitter } from 'events';
import { watch, readdir, readFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { AVPEvent } from '@hudai/shared';
import { translateJsonlEntry, type JsonlEntry } from './jsonl-to-avp.js';

/**
 * Watches for sub-agent JSONL files in the `subagents/` directory
 * of a Claude Code transcript. Each sub-agent file is tailed for
 * events, which are stamped with agentId and depth.
 */
export class SubagentWatcher extends EventEmitter {
  private transcriptDir: string;
  private sessionId: string;
  private watchers = new Map<string, {
    offset: number;
    seenToolIds: Map<string, { name: string; ts: number; input?: Record<string, any> }>;
    abortController: AbortController;
  }>();
  private dirAbortController: AbortController | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(transcriptDir: string, sessionId: string) {
    super();
    this.transcriptDir = transcriptDir;
    this.sessionId = sessionId;
  }

  async start(): Promise<void> {
    const subagentDir = join(this.transcriptDir, 'subagents');

    // Try to scan existing sub-agent files
    await this.scanForNewFiles(subagentDir);

    // Watch for new files appearing
    this.dirAbortController = new AbortController();
    (async () => {
      try {
        const watcher = watch(subagentDir, { signal: this.dirAbortController!.signal });
        for await (const event of watcher) {
          if (this.stopped) break;
          if (event.eventType === 'rename' && event.filename?.endsWith('.jsonl')) {
            const filePath = join(subagentDir, event.filename);
            this.startWatchingFile(filePath);
          } else if (event.eventType === 'change') {
            // A file was modified — re-read all watched files
            for (const [fp] of this.watchers) {
              await this.readNewLines(fp);
            }
          }
        }
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          // subagents/ doesn't exist yet — watch parent dir for it
          this.watchForSubagentDir();
        } else if (err?.name !== 'AbortError') {
          console.error('[subagent-watcher] Watch error:', err);
        }
      }
    })();

    // Fallback poll every 3s
    this.pollTimer = setInterval(async () => {
      await this.scanForNewFiles(subagentDir);
      for (const [fp] of this.watchers) {
        await this.readNewLines(fp);
      }
    }, 3000);
  }

  private async watchForSubagentDir(): Promise<void> {
    // Watch the parent transcript dir for the subagents/ directory to appear
    const parentAbort = new AbortController();
    this.dirAbortController = parentAbort;
    try {
      const watcher = watch(this.transcriptDir, { signal: parentAbort.signal });
      for await (const event of watcher) {
        if (this.stopped) break;
        if (event.filename === 'subagents') {
          parentAbort.abort();
          await this.start();
          break;
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('[subagent-watcher] Parent watch error:', err);
      }
    }
  }

  private async scanForNewFiles(dir: string): Promise<void> {
    try {
      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = join(dir, file);
        if (!this.watchers.has(filePath)) {
          this.startWatchingFile(filePath);
        }
      }
    } catch {
      // Directory may not exist yet
    }
  }

  private startWatchingFile(filePath: string): void {
    if (this.watchers.has(filePath) || this.stopped) return;

    const abortController = new AbortController();
    this.watchers.set(filePath, {
      offset: 0,
      seenToolIds: new Map(),
      abortController,
    });

    // Start reading from beginning (sub-agent files are complete sessions)
    this.readNewLines(filePath);
  }

  private extractAgentId(filePath: string): string {
    // Filename is like agent-{id}.jsonl
    const name = basename(filePath, '.jsonl');
    return name.startsWith('agent-') ? name.slice(6) : name;
  }

  private async readNewLines(filePath: string): Promise<void> {
    const entry = this.watchers.get(filePath);
    if (!entry) return;

    try {
      const s = await stat(filePath);
      if (s.size <= entry.offset) return;

      const buf = await readFile(filePath);
      const newData = buf.subarray(entry.offset).toString('utf-8');
      entry.offset = s.size;

      const agentId = this.extractAgentId(filePath);
      const lines = newData.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const jsonlEntry: JsonlEntry = JSON.parse(trimmed);
          const events = translateJsonlEntry(jsonlEntry, this.sessionId, entry.seenToolIds, {
            agentId,
            agentDepth: 1,
          });
          for (const event of events) {
            this.emit('event', event);
          }
        } catch {
          // Partial JSON — will be complete next read
        }
      }
    } catch {
      // File may not exist yet
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.dirAbortController) {
      this.dirAbortController.abort();
      this.dirAbortController = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const [, entry] of this.watchers) {
      entry.abortController.abort();
    }
    this.watchers.clear();
  }
}
