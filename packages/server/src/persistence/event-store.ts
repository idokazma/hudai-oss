import type { AVPEvent } from '@hudai/shared';
import { getDb } from './db.js';

export class EventStore {
  private insertStmt;
  private queryBySessionStmt;
  private queryByRangeStmt;
  private queryLatestStmt;

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
}

export class SessionStore {
  private insertStmt;
  private updateStatusStmt;
  private listStmt;

  constructor() {
    const db = getDb();
    this.insertStmt = db.prepare(
      'INSERT INTO sessions (id, project_path, started_at, status) VALUES (?, ?, ?, ?)'
    );
    this.updateStatusStmt = db.prepare(
      'UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?'
    );
    this.listStmt = db.prepare(
      `SELECT s.id, s.project_path, s.started_at, s.ended_at, s.status, COUNT(e.id) as event_count
       FROM sessions s LEFT JOIN events e ON e.session_id = s.id
       GROUP BY s.id ORDER BY s.started_at DESC`
    );
  }

  create(id: string, projectPath: string) {
    this.insertStmt.run(id, projectPath, Date.now(), 'running');
  }

  complete(id: string) {
    this.updateStatusStmt.run('complete', Date.now(), id);
  }

  error(id: string) {
    this.updateStatusStmt.run('error', Date.now(), id);
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
    }));
  }
}
