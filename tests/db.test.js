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

describe('threads — pipeline queries and updates', () => {
  let db;
  beforeEach(() => {
    db = makeDb();
    db.insertThread({
      id: 't3_a', subreddit: 'webdev', title: 'a', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 0, created_utc: 0,
      fetched_at: 0, age_hours: 0, matched_strong: '[]', matched_weak: '[]'
    });
    db.insertThread({
      id: 't3_b', subreddit: 'webdev', title: 'b', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 0, created_utc: 0,
      fetched_at: 0, age_hours: 0, matched_strong: '[]', matched_weak: '[]'
    });
  });

  it('getPending returns rows in pending status under retry cap', () => {
    const pending = db.getPending(3);
    expect(pending.length).toBe(2);
    expect(pending.map((r) => r.id).sort()).toEqual(['t3_a', 't3_b']);
  });

  it('updateThreadAfterScoring sets all the score fields', () => {
    db.updateThreadAfterScoring('t3_a', {
      raw_relevance_score: 8,
      relevance_score: 7,
      relevance_reason: 'good fit',
      suggested_angle: 'react dryly',
      high_traffic_flag: 0,
      status: 'scored'
    });
    const got = db.getThreadById('t3_a');
    expect(got.raw_relevance_score).toBe(8);
    expect(got.relevance_score).toBe(7);
    expect(got.relevance_reason).toBe('good fit');
    expect(got.status).toBe('scored');
  });

  it('getScored returns only scored rows', () => {
    db.updateThreadAfterScoring('t3_a', {
      raw_relevance_score: 8, relevance_score: 7,
      relevance_reason: 'r', suggested_angle: 'a',
      high_traffic_flag: 0, status: 'scored'
    });
    const scored = db.getScored(3);
    expect(scored.length).toBe(1);
    expect(scored[0].id).toBe('t3_a');
  });

  it('updateThreadStatus sets status', () => {
    db.updateThreadStatus('t3_a', 'skipped');
    expect(db.getThreadById('t3_a').status).toBe('skipped');
  });

  it('incrementAttempts bumps attempts and stores last_error', () => {
    db.incrementAttempts('t3_a', 'boom', 'pending');
    const got = db.getThreadById('t3_a');
    expect(got.attempts).toBe(1);
    expect(got.last_error).toBe('boom');
    expect(got.status).toBe('pending');
  });

  it('getPending excludes threads at retry cap', () => {
    db.incrementAttempts('t3_a', 'e1', 'pending');
    db.incrementAttempts('t3_a', 'e2', 'pending');
    db.incrementAttempts('t3_a', 'e3', 'failed');
    const pending = db.getPending(3);
    expect(pending.map((r) => r.id)).toEqual(['t3_b']);
  });
});
