import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDb } from '../db.js';
import { createScorer } from '../scorer.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const config = {
  models: { scorer: 'claude-haiku-4-5-20251001' },
  soft_comment_limit: 50,
  min_relevance_score: 7,
  max_retry_attempts: 3
};

let tmp, personaPath;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'rea-r-'));
  personaPath = join(tmp, 'persona.md');
  writeFileSync(personaPath, 'persona');
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('retry pipeline (db + scorer)', () => {
  it('progresses pending → pending → pending → failed across 3 failures', async () => {
    const db = createDb(':memory:');
    db.insertThread({
      id: 't3_z', subreddit: 'webdev', title: 't', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 5, created_utc: 0,
      fetched_at: 0, age_hours: 1, matched_strong: '[]', matched_weak: '[]'
    });
    const anthropic = {
      messages: {
        create: vi.fn()
          .mockRejectedValueOnce(new Error('e1'))
          .mockRejectedValueOnce(new Error('e2'))
          .mockRejectedValueOnce(new Error('e3'))
      }
    };
    const scorer = createScorer({ anthropic, db, config, personaPath });

    await expect(scorer.scoreThread('t3_z')).rejects.toThrow('e1');
    expect(db.getThreadById('t3_z').status).toBe('pending');
    expect(db.getThreadById('t3_z').attempts).toBe(1);

    await expect(scorer.scoreThread('t3_z')).rejects.toThrow('e2');
    expect(db.getThreadById('t3_z').status).toBe('pending');
    expect(db.getThreadById('t3_z').attempts).toBe(2);

    await expect(scorer.scoreThread('t3_z')).rejects.toThrow('e3');
    expect(db.getThreadById('t3_z').status).toBe('failed');
    expect(db.getThreadById('t3_z').attempts).toBe(3);
    expect(db.getThreadById('t3_z').last_error).toBe('e3');

    // getPending must NOT return the failed thread
    expect(db.getPending(3).length).toBe(0);
  });
});
