import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { dbPath } from './data-dir.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbFile = dbPath();
  const dir = path.dirname(dbFile);
  fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL DEFAULT 'running'
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      metadata TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  `);

  // Migration: add claude_session_id and mode columns to sessions (safe to re-run)
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN claude_session_id TEXT`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT 'tmux'`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN label TEXT`);
  } catch { /* column already exists */ }

  // Thread summaries cache
  db.exec(`
    CREATE TABLE IF NOT EXISTS thread_summaries (
      thread_id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      prompt TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      phase TEXT NOT NULL,
      summary TEXT,
      bullets TEXT,
      outcome TEXT,
      event_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_thread_summaries_project ON thread_summaries(project_path, started_at);
  `);

  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
