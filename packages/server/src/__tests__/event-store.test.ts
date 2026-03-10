import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import type { AVPEvent } from '@hudai/shared';
import Database from 'better-sqlite3';

// Create a shared in-memory DB that resets between tests
let testDb: any;

vi.mock('../persistence/db.js', () => {
  return {
    getDb: () => testDb,
    closeDb: () => {},
  };
});

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL DEFAULT 'running',
      claude_session_id TEXT,
      mode TEXT DEFAULT 'tmux',
      label TEXT
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

import { EventStore, SessionStore } from '../persistence/event-store.js';

function makeEvent(id: string, sessionId: string, ts: number): AVPEvent {
  return {
    id,
    sessionId,
    timestamp: ts,
    category: 'execution',
    type: 'shell.run',
    data: { command: 'echo test' },
    source: 'test',
  } as AVPEvent;
}

describe('EventStore', () => {
  let store: EventStore;
  let sessionStore: SessionStore;

  beforeEach(() => {
    testDb = createTestDb();
    store = new EventStore();
    sessionStore = new SessionStore();
    // Create sessions referenced by events (foreign key)
    sessionStore.create('s1', '/project');
    sessionStore.create('s2', '/project2');
  });

  it('insert and getBySession round-trip', () => {
    const event = makeEvent('e1', 's1', 1000);
    store.insert(event);
    const results = store.getBySession('s1');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('e1');
    expect(results[0].sessionId).toBe('s1');
    expect(results[0].type).toBe('shell.run');
  });

  it('getBySession returns events ordered by timestamp', () => {
    store.insert(makeEvent('e2', 's1', 2000));
    store.insert(makeEvent('e1', 's1', 1000));
    store.insert(makeEvent('e3', 's1', 3000));
    const results = store.getBySession('s1');
    expect(results.map(e => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('getBySession filters by sessionId', () => {
    store.insert(makeEvent('e1', 's1', 1000));
    store.insert(makeEvent('e2', 's2', 2000));
    expect(store.getBySession('s1')).toHaveLength(1);
    expect(store.getBySession('s2')).toHaveLength(1);
    expect(store.getBySession('s3')).toHaveLength(0);
  });

  it('getByRange filters by timestamp', () => {
    store.insert(makeEvent('e1', 's1', 1000));
    store.insert(makeEvent('e2', 's1', 2000));
    store.insert(makeEvent('e3', 's1', 3000));
    const results = store.getByRange('s1', 1500, 2500);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('e2');
  });

  it('getByRange inclusive boundaries', () => {
    store.insert(makeEvent('e1', 's1', 1000));
    store.insert(makeEvent('e2', 's1', 2000));
    const results = store.getByRange('s1', 1000, 2000);
    expect(results).toHaveLength(2);
  });

  it('getLatest returns most recent events', () => {
    store.insert(makeEvent('e1', 's1', 1000));
    store.insert(makeEvent('e2', 's1', 2000));
    store.insert(makeEvent('e3', 's1', 3000));
    const results = store.getLatest('s1', 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('e3');
    expect(results[1].id).toBe('e2');
  });

  it('rowToEvent reconstructs spread data fields', () => {
    const event = {
      id: 'e1',
      sessionId: 's1',
      timestamp: 1000,
      category: 'execution',
      type: 'shell.run',
      data: { command: 'npm test' },
      source: 'tmux',
    } as AVPEvent;
    store.insert(event);
    const retrieved = store.getBySession('s1')[0];
    expect(retrieved.data).toEqual({ command: 'npm test' });
    expect((retrieved as any).source).toBe('tmux');
  });

  it('handles multiple inserts efficiently', () => {
    for (let i = 0; i < 100; i++) {
      store.insert(makeEvent(`e${i}`, 's1', i * 100));
    }
    expect(store.getBySession('s1')).toHaveLength(100);
  });

  it('getByRange returns empty for non-matching range', () => {
    store.insert(makeEvent('e1', 's1', 1000));
    expect(store.getByRange('s1', 2000, 3000)).toHaveLength(0);
  });

  it('getLatest with limit larger than count returns all', () => {
    store.insert(makeEvent('e1', 's1', 1000));
    expect(store.getLatest('s1', 100)).toHaveLength(1);
  });
});

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    testDb = createTestDb();
    store = new SessionStore();
  });

  it('create inserts session with running status', () => {
    store.create('s1', '/project');
    const sessions = store.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('s1');
    expect(sessions[0].projectPath).toBe('/project');
    expect(sessions[0].status).toBe('running');
    expect(sessions[0].endedAt).toBeNull();
  });

  it('complete sets status and ended_at', () => {
    store.create('s1', '/project');
    store.complete('s1');
    const sessions = store.list();
    expect(sessions[0].status).toBe('complete');
    expect(sessions[0].endedAt).not.toBeNull();
  });

  it('error sets status and ended_at', () => {
    store.create('s1', '/project');
    store.error('s1');
    const sessions = store.list();
    expect(sessions[0].status).toBe('error');
    expect(sessions[0].endedAt).not.toBeNull();
  });

  it('list returns sessions with event_count join', () => {
    store.create('s1', '/project');
    const eventStore = new EventStore();
    eventStore.insert(makeEvent('e1', 's1', 1000));
    eventStore.insert(makeEvent('e2', 's1', 2000));
    const sessions = store.list();
    expect(sessions[0].eventCount).toBe(2);
  });

  it('list orders by started_at DESC', () => {
    // Insert with explicit timestamps via raw SQL to ensure ordering
    testDb.prepare('INSERT INTO sessions (id, project_path, started_at, status) VALUES (?, ?, ?, ?)').run('early', '/p1', 1000, 'running');
    testDb.prepare('INSERT INTO sessions (id, project_path, started_at, status) VALUES (?, ?, ?, ?)').run('late', '/p2', 2000, 'running');
    const sessions = store.list();
    const ids = sessions.map((s: any) => s.id);
    expect(ids.indexOf('late')).toBeLessThan(ids.indexOf('early'));
  });

  it('list returns zero event_count for session with no events', () => {
    store.create('s1', '/project');
    const sessions = store.list();
    expect(sessions[0].eventCount).toBe(0);
  });
});
