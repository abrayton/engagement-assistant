import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../db.js';

function makeDb() {
  // ':memory:' is better-sqlite3's in-memory DB
  return createDb(':memory:');
}

describe('createDb — schema migration', () => {
  it('creates tables on init without error', () => {
    const db = makeDb();
    expect(db).toBeDefined();
    db.close();
  });

  it('is idempotent on re-init (same in-memory db)', () => {
    const db = makeDb();
    // Calling migrate() again must not throw
    expect(() => db.migrate()).not.toThrow();
    db.close();
  });
});

describe('threads — insert and get', () => {
  let db;
  beforeEach(() => { db = makeDb(); });

  const sampleRow = {
    id: 't3_abc123',
    subreddit: 'webdev',
    title: 'How do you handle alignment',
    body: 'Looking at alignment between frontend and backend teams',
    url: 'https://reddit.com/r/webdev/abc123',
    author: 'someuser',
    score: 5,
    comment_count: 3,
    created_utc: 1700000000,
    fetched_at: 1700001000,
    age_hours: 0.28,
    matched_strong: '[]',
    matched_weak: '["alignment"]'
  };

  it('inserts a thread and retrieves it by id', () => {
    db.insertThread(sampleRow);
    const got = db.getThreadById('t3_abc123');
    expect(got.subreddit).toBe('webdev');
    expect(got.status).toBe('pending');
    expect(got.attempts).toBe(0);
    expect(got.high_traffic_flag).toBe(0);
  });

  it('reports thread existence', () => {
    expect(db.threadExists('t3_abc123')).toBe(false);
    db.insertThread(sampleRow);
    expect(db.threadExists('t3_abc123')).toBe(true);
  });

  it('returns null for unknown id', () => {
    expect(db.getThreadById('t3_missing')).toBeUndefined();
  });
});
