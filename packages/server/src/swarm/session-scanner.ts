import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CLAUDE_DIR = join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
const HISTORY_FILE = join(CLAUDE_DIR, 'history.jsonl');

/** Max age for a session JSONL file to be considered "active" */
const ACTIVE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export interface DiscoveredSession {
  sessionId: string;
  projectPath: string;
  projectSlug: string;
  jsonlPath: string;
  lastModified: number;
}

/**
 * SessionScanner — Discovers all active Claude Code sessions by scanning
 * ~/.claude/projects/ and ~/.claude/history.jsonl.
 *
 * Unlike SwarmRegistry (which only knows about tmux panes), this finds
 * ALL sessions including VS Code, Cursor, and any other Claude Code client.
 */
export class SessionScanner {
  private cache: DiscoveredSession[] = [];
  private lastScan = 0;
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  /** Start periodic scanning (every 10s) */
  start(): void {
    this.scan().catch(() => {});
    this.scanTimer = setInterval(() => {
      this.scan().catch(() => {});
    }, 10_000);
  }

  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  /** Get the latest scan results */
  getSessions(): DiscoveredSession[] {
    return this.cache;
  }

  /** Force a fresh scan */
  async scan(): Promise<DiscoveredSession[]> {
    const sessions: DiscoveredSession[] = [];
    const now = Date.now();

    try {
      // Strategy 1: Read history.jsonl for session → project mappings
      const historyMap = await this.readHistory();

      // Strategy 2: Scan ~/.claude/projects/ directories for JSONL files
      const slugDirs = await this.listProjectDirs();

      for (const slug of slugDirs) {
        const projectDir = join(PROJECTS_DIR, slug);
        const projectPath = await this.decodeProjectPath(projectDir, slug);

        try {
          const files = await readdir(projectDir);
          const jsonlFiles = files.filter((f) => f.endsWith('.jsonl') && !f.startsWith('.'));

          for (const file of jsonlFiles) {
            const filePath = join(projectDir, file);
            try {
              const s = await stat(filePath);
              const age = now - s.mtimeMs;
              if (age > ACTIVE_THRESHOLD_MS) continue;

              const sessionId = file.replace('.jsonl', '');
              sessions.push({
                sessionId,
                projectPath: projectPath || slug,
                projectSlug: slug,
                jsonlPath: filePath,
                lastModified: s.mtimeMs,
              });
            } catch {
              // File may have been deleted between readdir and stat
            }
          }
        } catch {
          // Directory read failed
        }
      }

      // Enrich with history data
      for (const session of sessions) {
        const historyEntry = historyMap.get(session.sessionId);
        if (historyEntry?.project) {
          session.projectPath = historyEntry.project;
        }
      }
    } catch {
      // Scan failed — return cached results
    }

    // Sort by lastModified descending (most recent first)
    sessions.sort((a, b) => b.lastModified - a.lastModified);

    this.cache = sessions;
    this.lastScan = now;
    return sessions;
  }

  /**
   * Read ~/.claude/history.jsonl to get session → project mappings.
   */
  private async readHistory(): Promise<Map<string, { project: string; timestamp: number }>> {
    const map = new Map<string, { project: string; timestamp: number }>();

    try {
      const content = await readFile(HISTORY_FILE, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed);
          if (entry.sessionId && entry.project) {
            map.set(entry.sessionId, {
              project: entry.project,
              timestamp: entry.timestamp || 0,
            });
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // No history file
    }

    return map;
  }

  /**
   * List project slug directories in ~/.claude/projects/
   */
  private async listProjectDirs(): Promise<string[]> {
    try {
      const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && e.name.startsWith('-'))
        .map((e) => e.name);
    } catch {
      return [];
    }
  }

  /**
   * Decode the project path from a slug directory.
   * Tries to read project.json breadcrumb first, then reverse the slug.
   */
  private async decodeProjectPath(dir: string, slug: string): Promise<string | null> {
    // Try project.json breadcrumb
    try {
      const content = await readFile(join(dir, 'project.json'), 'utf-8');
      const data = JSON.parse(content);
      if (data.rootPath) return data.rootPath;
    } catch {
      // No breadcrumb
    }

    // Reverse the slug: -Users-ido-project → /Users/ido/project
    // This is lossy (dots become dashes too) but good enough for display
    if (slug.startsWith('-')) {
      return '/' + slug.slice(1).replace(/-/g, '/');
    }

    return null;
  }
}
