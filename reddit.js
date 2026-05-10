import Snoowrap from 'snoowrap';
import { matchKeywords, passesGate } from './keywords.js';

export function createSnoowrapClient(env) {
  return new Snoowrap({
    userAgent: env.REDDIT_USER_AGENT || 'reddit-assistant/1.0',
    clientId: env.REDDIT_CLIENT_ID || '',
    clientSecret: env.REDDIT_CLIENT_SECRET || '',
    username: env.REDDIT_USERNAME || '',
    password: env.REDDIT_PASSWORD || ''
  });
}

export function createReddit({ snoowrap, db, config }) {
  async function pollOneSub(subName) {
    let listing;
    try {
      listing = await snoowrap.getSubreddit(subName).getNew({ limit: 25 });
    } catch (err) {
      if (err && err.statusCode === 429) {
        await sleep(60_000);
        try {
          listing = await snoowrap.getSubreddit(subName).getNew({ limit: 25 });
        } catch (err2) {
          console.error(`[reddit] ${subName} 429 retry failed:`, err2.message);
          return { fetched: 0, inserted: 0 };
        }
      } else {
        console.error(`[reddit] ${subName} error:`, err.message);
        return { fetched: 0, inserted: 0 };
      }
    }

    let inserted = 0;
    const fetched = listing.length;
    const now = Date.now();
    for (const post of listing) {
      if (db.threadExists(post.id)) continue;

      const ageHours = (now - post.created_utc * 1000) / 3_600_000;
      if (ageHours > config.max_thread_age_hours) continue;
      if (post.num_comments > config.hard_comment_limit) continue;

      const text = `${post.title || ''} ${post.selftext || ''}`;
      const matches = matchKeywords(text, config.keywords);
      if (matches.strong.length === 0 && matches.weak.length === 0) continue;
      if (!passesGate(matches, ageHours, post.num_comments, config)) continue;

      const subreddit = post.subreddit?.display_name || subName;
      const url = post.permalink
        ? `https://reddit.com${post.permalink}`
        : (post.url || '');

      db.insertThread({
        id: post.id,
        subreddit,
        title: post.title || '',
        body: post.selftext || '',
        url,
        author: post.author?.name || '',
        score: post.score ?? 0,
        comment_count: post.num_comments ?? 0,
        created_utc: post.created_utc,
        fetched_at: now,
        age_hours: ageHours,
        matched_strong: JSON.stringify(matches.strong),
        matched_weak: JSON.stringify(matches.weak)
      });
      inserted += 1;
    }

    return { fetched, inserted };
  }

  async function pollAllSubs() {
    let threadsFetched = 0;
    let threadsInserted = 0;
    for (const sub of config.subreddits) {
      const r = await pollOneSub(sub);
      threadsFetched += r.fetched;
      threadsInserted += r.inserted;
    }
    return { threadsFetched, threadsInserted };
  }

  return { pollAllSubs, pollOneSub };
}

function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
