import type { AVPEvent, ThreadSummary } from '@hudai/shared';
import { getDb } from './db.js';

export class EventStore {
  private insertStmt;
  private queryBySessionStmt;
  private queryByRangeStmt;
  private queryLatestStmt;
  private queryByProjectStmt;
  private queryLatestProjectTimestampStmt;

  constructor() {
    const db = getDb();
    this.insertStmt = db.prepare(
      'INSERT INTO events (id, session_id, timestamp, category, type, data) VALUES (?, ?, ?, ?, ?, ?)'
    );
    this.queryBySessionStmt = db.prepare(
      'SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC'
    );
    this.queryByRangeStmt = db.prepare(
      'SELECT * FROM events WHERE session_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC'
    );
    this.queryLatestStmt = db.prepare(
      'SELECT * FROM events WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?'
    );
    this.queryByProjectStmt = db.prepare(
      `SELECT DISTINCT e.id, e.session_id, e.timestamp, e.category, e.type, e.data FROM events e
       JOIN sessions s ON e.session_id = s.id
       WHERE s.project_path = ? AND e.timestamp >= ?
       ORDER BY e.timestamp ASC LIMIT ?`
    );
    this.queryLatestProjectTimestampStmt = db.prepare(
      `SELECT MAX(e.timestamp) as latest FROM events e
       JOIN sessions s ON e.session_id = s.id
       WHERE s.project_path = ?`
    );
  }

  insert(event: AVPEvent) {
    const { id, sessionId, timestamp, category, type, ...rest } = event;
    this.insertStmt.run(id, sessionId, timestamp, category, type, JSON.stringify(rest));
  }

  getBySession(sessionId: string): AVPEvent[] {
    const rows = this.queryBySessionStmt.all(sessionId) as any[];
    return rows.map(this.rowToEvent);
  }

  getByRange(sessionId: string, from: number, to: number): AVPEvent[] {
    const rows = this.queryByRangeStmt.all(sessionId, from, to) as any[];
    return rows.map(this.rowToEvent);
  }

  getLatest(sessionId: string, limit: number): AVPEvent[] {
    const rows = this.queryLatestStmt.all(sessionId, limit) as any[];
    return rows.map(this.rowToEvent);
  }

  /** Get recent events across all sessions for a project path (tmux target) */
  getByProject(projectPath: string, since: number, limit: number = 2000): AVPEvent[] {
    const rows = this.queryByProjectStmt.all(projectPath, since, limit) as any[];
    return rows.map(this.rowToEvent);
  }

  /** Get the timestamp of the most recent event for a project */
  getLatestProjectTimestamp(projectPath: string): number | null {
    const row = this.queryLatestProjectTimestampStmt.get(projectPath) as any;
    return row?.latest ?? null;
  }

  private rowToEvent(row: any): AVPEvent {
    const parsed = JSON.parse(row.data);
    return {
      id: row.id,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      category: row.category,
      type: row.type,
      ...parsed,
    } as AVPEvent;
  }
}

export interface SessionSummary {
  id: string;
  projectPath: string;
  startedAt: number;
  endedAt: number | null;
  status: string;
  eventCount: number;
  /** Claude Code session ID for --resume (stream mode only) */
  claudeSessionId?: string;
  /** How the session was created */
  mode?: 'tmux' | 'stream';
  /** User-provided session name */
  label?: string;
}

export class SessionStore {
  private insertStmt;
  private updateStatusStmt;
  private updateClaudeSessionStmt;
  private listStmt;
  private getByIdStmt;

  constructor() {
    const db = getDb();
    this.insertStmt = db.prepare(
      'INSERT INTO sessions (id, project_path, started_at, status, mode, label) VALUES (?, ?, ?, ?, ?, ?)'
    );
    this.updateStatusStmt = db.prepare(
      'UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?'
    );
    this.updateClaudeSessionStmt = db.prepare(
      'UPDATE sessions SET claude_session_id = ? WHERE id = ?'
    );
    this.listStmt = db.prepare(
      `SELECT s.id, s.project_path, s.started_at, s.ended_at, s.status, s.claude_session_id, s.mode, s.label, COUNT(e.id) as event_count
       FROM sessions s LEFT JOIN events e ON e.session_id = s.id
       GROUP BY s.id ORDER BY s.started_at DESC`
    );
    this.getByIdStmt = db.prepare(
      'SELECT * FROM sessions WHERE id = ?'
    );
  }

  create(id: string, projectPath: string, mode: 'tmux' | 'stream' = 'tmux', label?: string) {
    this.insertStmt.run(id, projectPath, Date.now(), 'running', mode, label || null);
  }

  complete(id: string) {
    this.updateStatusStmt.run('complete', Date.now(), id);
  }

  error(id: string) {
    this.updateStatusStmt.run('error', Date.now(), id);
  }

  /** Store Claude Code's session ID for --resume support */
  setClaudeSessionId(id: string, claudeSessionId: string) {
    this.updateClaudeSessionStmt.run(claudeSessionId, id);
  }

  /** Get Claude Code's session ID for resuming a past session */
  getClaudeSessionId(id: string): string | null {
    const row = this.getByIdStmt.get(id) as any;
    return row?.claude_session_id || null;
  }

  list(): SessionSummary[] {
    const rows = this.listStmt.all() as any[];
    return rows.map((r) => ({
      id: r.id,
      projectPath: r.project_path,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      status: r.status,
      eventCount: r.event_count,
      claudeSessionId: r.claude_session_id || undefined,
      mode: r.mode || 'tmux',
      label: r.label || undefined,
    }));
  }
}

export class ThreadSummaryStore {
  private upsertStmt;
  private queryByProjectStmt;

  constructor() {
    const db = getDb();
    this.upsertStmt = db.prepare(
      `INSERT OR REPLACE INTO thread_summaries
       (thread_id, project_path, prompt, started_at, completed_at, phase, summary, bullets, outcome, event_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.queryByProjectStmt = db.prepare(
      `SELECT * FROM thread_summaries WHERE project_path = ? AND started_at >= ? ORDER BY started_at ASC LIMIT ?`
    );
  }

  save(projectPath: string, thread: ThreadSummary) {
    this.upsertStmt.run(
      thread.threadId,
      projectPath,
      thread.prompt,
      thread.startedAt,
      thread.completedAt,
      thread.phase,
      thread.summary,
      thread.bullets ? JSON.stringify(thread.bullets) : null,
      thread.outcome ? JSON.stringify(thread.outcome) : null,
      thread.eventCount,
      Date.now(),
    );
  }

  getByProject(projectPath: string, since: number, limit: number = 100): ThreadSummary[] {
    const rows = this.queryByProjectStmt.all(projectPath, since, limit) as any[];
    return rows.map((r) => ({
      threadId: r.thread_id,
      sessionId: '',
      prompt: r.prompt,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      phase: r.phase,
      summary: r.summary,
      bullets: r.bullets ? JSON.parse(r.bullets) : null,
      outcome: r.outcome ? JSON.parse(r.outcome) : null,
      eventCount: r.event_count,
    }));
  }
}
