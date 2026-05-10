import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchTopComments, createDrafter } from '../drafter.js';
import { createDb } from '../db.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('fetchTopComments', () => {
  it('returns first 3 top-level comment bodies (truncated to 150 chars)', async () => {
    const longBody = 'x'.repeat(200);
    const fakeSubmission = {
      fetch: vi.fn().mockResolvedValue({
        comments: [
          { body: 'first comment' },
          { body: 'second comment' },
          { body: longBody },
          { body: 'fourth (excluded)' }
        ]
      })
    };
    const fakeSnoo = { getSubmission: vi.fn().mockReturnValue(fakeSubmission) };

    const result = await fetchTopComments(fakeSnoo, 't3_a');
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('first comment');
    expect(result[2].length).toBe(150);
  });

  it('returns empty array on fetch failure (drafter falls back to "none yet")', async () => {
    const fakeSnoo = {
      getSubmission: vi.fn().mockReturnValue({
        fetch: vi.fn().mockRejectedValue(new Error('500'))
      })
    };
    const result = await fetchTopComments(fakeSnoo, 't3_a');
    expect(result).toEqual([]);
  });

  it('returns empty array when submission has no comments', async () => {
    const fakeSnoo = {
      getSubmission: vi.fn().mockReturnValue({
        fetch: vi.fn().mockResolvedValue({ comments: [] })
      })
    };
    const result = await fetchTopComments(fakeSnoo, 't3_a');
    expect(result).toEqual([]);
  });
});

const cfg = {
  models: { drafter: 'claude-sonnet-4-6' },
  max_retry_attempts: 3
};

let tmp, personaPath;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'rea-d-'));
  personaPath = join(tmp, 'persona.md');
  writeFileSync(personaPath, '# persona\nDry voice.');
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function fakeAnthropic(text, usage = { input_tokens: 200, output_tokens: 50 }) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text }],
        usage
      })
    }
  };
}

function fakeSnoo() {
  return {
    getSubmission: vi.fn().mockReturnValue({
      fetch: vi.fn().mockResolvedValue({ comments: [{ body: 'top1' }] })
    })
  };
}

describe('createDrafter.draftComment', () => {
  it('inserts draft and updates thread to draft_ready', async () => {
    const db = createDb(':memory:');
    db.insertThread({
      id: 't3_a', subreddit: 'webdev', title: 't', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 0, created_utc: 0,
      fetched_at: 0, age_hours: 1, matched_strong: '[]', matched_weak: '[]'
    });
    db.updateThreadAfterScoring('t3_a', {
      raw_relevance_score: 8, relevance_score: 8,
      relevance_reason: 'r', suggested_angle: 'a',
      high_traffic_flag: 0, status: 'scored'
    });

    const anthropic = fakeAnthropic('Draft comment text.');
    const drafter = createDrafter({
      anthropic, snoowrap: fakeSnoo(), db, config: cfg, personaPath
    });

    await drafter.draftComment('t3_a');
    expect(db.getThreadById('t3_a').status).toBe('draft_ready');
    expect(db.getLatestDraft('t3_a').draft_text).toBe('Draft comment text.');
  });

  it('logs api call with token usage', async () => {
    const db = createDb(':memory:');
    db.insertThread({
      id: 't3_b', subreddit: 'webdev', title: 't', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 0, created_utc: 0,
      fetched_at: 0, age_hours: 1, matched_strong: '[]', matched_weak: '[]'
    });
    db.updateThreadAfterScoring('t3_b', {
      raw_relevance_score: 8, relevance_score: 8,
      relevance_reason: 'r', suggested_angle: 'a',
      high_traffic_flag: 0, status: 'scored'
    });

    const anthropic = fakeAnthropic('text', { input_tokens: 999, output_tokens: 11 });
    const drafter = createDrafter({
      anthropic, snoowrap: fakeSnoo(), db, config: cfg, personaPath
    });
    await drafter.draftComment('t3_b');
    const calls = db.getApiCallsSince(0);
    expect(calls.length).toBe(1);
    expect(calls[0].module).toBe('drafter');
    expect(calls[0].input_tokens).toBe(999);
  });

  it('replaces previous draft on retry (deletes old before inserting)', async () => {
    const db = createDb(':memory:');
    db.insertThread({
      id: 't3_c', subreddit: 'webdev', title: 't', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 0, created_utc: 0,
      fetched_at: 0, age_hours: 1, matched_strong: '[]', matched_weak: '[]'
    });
    db.updateThreadAfterScoring('t3_c', {
      raw_relevance_score: 8, relevance_score: 8,
      relevance_reason: 'r', suggested_angle: 'a',
      high_traffic_flag: 0, status: 'scored'
    });

    const anthropic1 = fakeAnthropic('first');
    const drafter1 = createDrafter({
      anthropic: anthropic1, snoowrap: fakeSnoo(), db, config: cfg, personaPath
    });
    await drafter1.draftComment('t3_c');

    // Reset for second draft (simulating regenerate)
    const anthropic2 = fakeAnthropic('second');
    const drafter2 = createDrafter({
      anthropic: anthropic2, snoowrap: fakeSnoo(), db, config: cfg, personaPath
    });
    await drafter2.draftComment('t3_c');

    expect(db.getLatestDraft('t3_c').draft_text).toBe('second');
  });

  it('on failure, increments attempts and keeps status=scored', async () => {
    const db = createDb(':memory:');
    db.insertThread({
      id: 't3_d', subreddit: 'webdev', title: 't', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 0, created_utc: 0,
      fetched_at: 0, age_hours: 1, matched_strong: '[]', matched_weak: '[]'
    });
    db.updateThreadAfterScoring('t3_d', {
      raw_relevance_score: 8, relevance_score: 8,
      relevance_reason: 'r', suggested_angle: 'a',
      high_traffic_flag: 0, status: 'scored'
    });
    const anthropic = {
      messages: { create: vi.fn().mockRejectedValue(new Error('429')) }
    };
    const drafter = createDrafter({
      anthropic, snoowrap: fakeSnoo(), db, config: cfg, personaPath
    });

    await expect(drafter.draftComment('t3_d')).rejects.toThrow('429');
    const got = db.getThreadById('t3_d');
    expect(got.attempts).toBe(1);
    expect(got.status).toBe('scored');
  });
});
