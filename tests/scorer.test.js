import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyPenalty, createScorer } from '../scorer.js';
import { createDb } from '../db.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const config = { soft_comment_limit: 50, min_relevance_score: 7 };

describe('applyPenalty', () => {
  it('returns the raw score when no penalties apply', () => {
    expect(applyPenalty(8, 1, 5, config)).toBe(8);
  });

  it('subtracts 2 when comments exceed soft limit', () => {
    expect(applyPenalty(9, 1, 60, config)).toBe(7);
  });

  it('subtracts 1 when age exceeds 6 hours', () => {
    expect(applyPenalty(8, 7, 5, config)).toBe(7);
  });

  it('stacks both penalties', () => {
    expect(applyPenalty(9, 7, 60, config)).toBe(6);
  });

  it('floors at 1 even with heavy penalty', () => {
    expect(applyPenalty(2, 10, 100, config)).toBe(1);
  });
});

function fakeAnthropic(scoreJson, usage = { input_tokens: 100, output_tokens: 30 }) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(scoreJson) }],
        usage
      })
    }
  };
}

const fullConfig = {
  models: { scorer: 'claude-haiku-4-5-20251001' },
  soft_comment_limit: 50,
  min_relevance_score: 7,
  max_retry_attempts: 3
};

let tmp, personaPath;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'rea-'));
  personaPath = join(tmp, 'persona.md');
  writeFileSync(personaPath, '# persona\nDry voice.');
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('createScorer.scoreThread', () => {
  it('calls anthropic, applies penalty, updates thread to scored', async () => {
    const db = createDb(':memory:');
    db.insertThread({
      id: 't3_a', subreddit: 'webdev', title: 'just shipped', body: '',
      url: 'u', author: 'x', score: 1, comment_count: 5, created_utc: 0,
      fetched_at: 0, age_hours: 1, matched_strong: '[]', matched_weak: '[]'
    });
    const anthropic = fakeAnthropic({ score: 8, reason: 'fits', suggested_angle: 'dry' });
    const scorer = createScorer({ anthropic, db, config: fullConfig, personaPath });

    await scorer.scoreThread('t3_a');

    const got = db.getThreadById('t3_a');
    expect(got.status).toBe('scored');
    expect(got.relevance_score).toBe(8);
    expect(got.relevance_reason).toBe('fits');
    expect(got.high_traffic_flag).toBe(0);
    expect(anthropic.messages.create).toHaveBeenCalledOnce();
  });

  it('routes low-score thread to skipped_low_score', async () => {
    const db = createDb(':memory:');
    db.insertThread({
      id: 't3_b', subreddit: 'webdev', title: 't', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 5, created_utc: 0,
      fetched_at: 0, age_hours: 1, matched_strong: '[]', matched_weak: '[]'
    });
    const anthropic = fakeAnthropic({ score: 4, reason: 'meh', suggested_angle: null });
    const scorer = createScorer({ anthropic, db, config: fullConfig, personaPath });

    await scorer.scoreThread('t3_b');
    const got = db.getThreadById('t3_b');
    expect(got.status).toBe('skipped_low_score');
    expect(got.relevance_score).toBe(4);
  });

  it('flags high_traffic when raw>=9 but penalty drops below threshold', async () => {
    const db = createDb(':memory:');
    db.insertThread({
      id: 't3_c', subreddit: 'webdev', title: 't', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 60, created_utc: 0,
      fetched_at: 0, age_hours: 7, matched_strong: '[]', matched_weak: '[]'
    });
    const anthropic = fakeAnthropic({ score: 9, reason: 'r', suggested_angle: 'a' });
    const scorer = createScorer({ anthropic, db, config: fullConfig, personaPath });

    await scorer.scoreThread('t3_c');
    const got = db.getThreadById('t3_c');
    expect(got.high_traffic_flag).toBe(1);
    expect(got.status).toBe('scored');
    expect(got.relevance_score).toBe(6);
  });

  it('logs api call with token usage', async () => {
    const db = createDb(':memory:');
    db.insertThread({
      id: 't3_d', subreddit: 'webdev', title: 't', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 5, created_utc: 0,
      fetched_at: 0, age_hours: 1, matched_strong: '[]', matched_weak: '[]'
    });
    const anthropic = fakeAnthropic(
      { score: 8, reason: 'r', suggested_angle: 'a' },
      { input_tokens: 1234, output_tokens: 56 }
    );
    const scorer = createScorer({ anthropic, db, config: fullConfig, personaPath });

    await scorer.scoreThread('t3_d');
    const calls = db.getApiCallsSince(0);
    expect(calls.length).toBe(1);
    expect(calls[0].input_tokens).toBe(1234);
    expect(calls[0].output_tokens).toBe(56);
    expect(calls[0].module).toBe('scorer');
  });

  it('handles JSON wrapped in markdown code fences', async () => {
    const db = createDb(':memory:');
    db.insertThread({
      id: 't3_e', subreddit: 'webdev', title: 't', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 5, created_utc: 0,
      fetched_at: 0, age_hours: 1, matched_strong: '[]', matched_weak: '[]'
    });
    const anthropic = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '```json\n{"score":8,"reason":"r","suggested_angle":"a"}\n```' }],
          usage: { input_tokens: 50, output_tokens: 20 }
        })
      }
    };
    const scorer = createScorer({ anthropic, db, config: fullConfig, personaPath });
    await scorer.scoreThread('t3_e');
    expect(db.getThreadById('t3_e').status).toBe('scored');
  });
});

describe('createScorer — retry behavior', () => {
  it('increments attempts and sets status=pending on first failure', async () => {
    const db = createDb(':memory:');
    db.insertThread({
      id: 't3_x', subreddit: 'webdev', title: 't', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 5, created_utc: 0,
      fetched_at: 0, age_hours: 1, matched_strong: '[]', matched_weak: '[]'
    });
    const anthropic = {
      messages: { create: vi.fn().mockRejectedValue(new Error('500 server error')) }
    };
    const scorer = createScorer({ anthropic, db, config: fullConfig, personaPath });

    await expect(scorer.scoreThread('t3_x')).rejects.toThrow('500 server error');
    const got = db.getThreadById('t3_x');
    expect(got.attempts).toBe(1);
    expect(got.status).toBe('pending');
    expect(got.last_error).toMatch(/500/);
  });

  it('marks failed once attempts hit max_retry_attempts', async () => {
    const db = createDb(':memory:');
    db.insertThread({
      id: 't3_y', subreddit: 'webdev', title: 't', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 5, created_utc: 0,
      fetched_at: 0, age_hours: 1, matched_strong: '[]', matched_weak: '[]'
    });
    const anthropic = {
      messages: { create: vi.fn().mockRejectedValue(new Error('boom')) }
    };
    const scorer = createScorer({ anthropic, db, config: fullConfig, personaPath });

    await expect(scorer.scoreThread('t3_y')).rejects.toThrow();
    await expect(scorer.scoreThread('t3_y')).rejects.toThrow();
    await expect(scorer.scoreThread('t3_y')).rejects.toThrow();

    const got = db.getThreadById('t3_y');
    expect(got.attempts).toBe(3);
    expect(got.status).toBe('failed');
  });

  it('persona read failure increments attempts and stays pending', async () => {
    const db = createDb(':memory:');
    db.insertThread({
      id: 't3_missing_persona', subreddit: 'webdev', title: 't', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 5, created_utc: 0,
      fetched_at: 0, age_hours: 1, matched_strong: '[]', matched_weak: '[]'
    });
    const anthropic = fakeAnthropic({ score: 8, reason: 'r', suggested_angle: 'a' });
    const scorer = createScorer({
      anthropic, db, config: fullConfig, personaPath: join(tmp, 'missing.md')
    });

    await expect(scorer.scoreThread('t3_missing_persona')).rejects.toThrow();
    const got = db.getThreadById('t3_missing_persona');
    expect(got.attempts).toBe(1);
    expect(got.status).toBe('pending');
    expect(got.last_error).toMatch(/^persona:/);
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });
});
