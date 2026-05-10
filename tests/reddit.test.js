import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDb } from '../db.js';
import { createReddit } from '../reddit.js';

function fakePost(opts) {
  return {
    id: opts.id,
    title: opts.title,
    selftext: opts.selftext || '',
    url: opts.url || `https://reddit.com/${opts.id}`,
    permalink: opts.permalink || `/r/${opts.subreddit}/comments/${opts.id}`,
    author: { name: 'someone' },
    score: opts.score ?? 1,
    num_comments: opts.num_comments ?? 0,
    created_utc: opts.created_utc ?? Math.floor(Date.now() / 1000),
    subreddit: { display_name: opts.subreddit }
  };
}

function fakeSnoowrap(postsBySubreddit) {
  return {
    getSubreddit(name) {
      return {
        getNew: vi.fn().mockResolvedValue(postsBySubreddit[name] || [])
      };
    }
  };
}

const baseConfig = {
  subreddits: ['webdev'],
  keywords: { strong: ['just shipped'], weak: ['alignment'] },
  max_thread_age_hours: 12,
  hard_comment_limit: 100,
  weak_gate_fresh_age_hours: 2,
  weak_gate_fresh_comment_count: 10
};

describe('pollAllSubs', () => {
  let db;
  beforeEach(() => { db = createDb(':memory:'); });

  it('inserts threads matching strong keywords', async () => {
    const snoo = fakeSnoowrap({
      webdev: [fakePost({ id: 't3_a', subreddit: 'webdev', title: 'I just shipped a tool' })]
    });
    const reddit = createReddit({ snoowrap: snoo, db, config: baseConfig });
    const result = await reddit.pollAllSubs();
    expect(result.threadsInserted).toBe(1);
    expect(db.threadExists('t3_a')).toBe(true);
  });

  it('drops threads that match no keywords', async () => {
    const snoo = fakeSnoowrap({
      webdev: [fakePost({ id: 't3_b', subreddit: 'webdev', title: 'Random unrelated post' })]
    });
    const reddit = createReddit({ snoowrap: snoo, db, config: baseConfig });
    const result = await reddit.pollAllSubs();
    expect(result.threadsInserted).toBe(0);
  });

  it('drops threads older than max_thread_age_hours', async () => {
    const oldUtc = Math.floor(Date.now() / 1000) - 13 * 3600;
    const snoo = fakeSnoowrap({
      webdev: [fakePost({ id: 't3_c', subreddit: 'webdev', title: 'just shipped', created_utc: oldUtc })]
    });
    const reddit = createReddit({ snoowrap: snoo, db, config: baseConfig });
    const result = await reddit.pollAllSubs();
    expect(result.threadsInserted).toBe(0);
  });

  it('drops threads above hard_comment_limit even if keywords match', async () => {
    const snoo = fakeSnoowrap({
      webdev: [fakePost({ id: 't3_d', subreddit: 'webdev', title: 'just shipped', num_comments: 200 })]
    });
    const reddit = createReddit({ snoowrap: snoo, db, config: baseConfig });
    const result = await reddit.pollAllSubs();
    expect(result.threadsInserted).toBe(0);
  });

  it('drops single weak match on stale thread (gate enforcement)', async () => {
    const oldishUtc = Math.floor(Date.now() / 1000) - 4 * 3600;
    const snoo = fakeSnoowrap({
      webdev: [fakePost({
        id: 't3_e', subreddit: 'webdev', title: 'thoughts on alignment',
        created_utc: oldishUtc, num_comments: 30
      })]
    });
    const reddit = createReddit({ snoowrap: snoo, db, config: baseConfig });
    const result = await reddit.pollAllSubs();
    expect(result.threadsInserted).toBe(0);
  });

  it('skips threads already in db', async () => {
    const snoo = fakeSnoowrap({
      webdev: [fakePost({ id: 't3_f', subreddit: 'webdev', title: 'just shipped' })]
    });
    const reddit = createReddit({ snoowrap: snoo, db, config: baseConfig });
    await reddit.pollAllSubs();
    const second = await reddit.pollAllSubs();
    expect(second.threadsInserted).toBe(0);
  });

  it('returns threadsFetched count summing across subs', async () => {
    const config = { ...baseConfig, subreddits: ['webdev', 'jobs'] };
    const snoo = fakeSnoowrap({
      webdev: [fakePost({ id: 't3_g', subreddit: 'webdev', title: 'unrelated' })],
      jobs: [
        fakePost({ id: 't3_h', subreddit: 'jobs', title: 'unrelated' }),
        fakePost({ id: 't3_i', subreddit: 'jobs', title: 'unrelated' })
      ]
    });
    const reddit = createReddit({ snoowrap: snoo, db, config });
    const result = await reddit.pollAllSubs();
    expect(result.threadsFetched).toBe(3);
  });
});
