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

  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
