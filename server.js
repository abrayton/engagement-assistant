import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import { readFileSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { createDb } from './db.js';
import { createSnoowrapClient, createReddit } from './reddit.js';
import { createScorer } from './scorer.js';
import { createDrafter } from './drafter.js';
import { estimateCost } from './pricing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));
const personaPath = join(__dirname, config.persona_path);

const db = createDb(join(__dirname, config.db_path));

const snoowrap = createSnoowrapClient(process.env);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const reddit = createReddit({ snoowrap, db, config });
const scorer = createScorer({ anthropic, db, config, personaPath });
const drafter = createDrafter({ anthropic, snoowrap, db, config, personaPath });

let pollInProgress = false;
let lastPollAt = null;

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

async function runPollCycle() {
  if (pollInProgress) {
    console.log('[cycle] skipped: previous cycle still running');
    return { skipped: true };
  }
  pollInProgress = true;
  const startedAt = Date.now();
  let threadsFetched = 0, threadsInserted = 0;
  let scoringCalls = 0, draftingCalls = 0, errors = 0;

  try {
    // 1. Poll new threads
    const pollResult = await reddit.pollAllSubs();
    threadsFetched = pollResult.threadsFetched;
    threadsInserted = pollResult.threadsInserted;

    // 2. Score every pending thread (new + retries)
    const pending = db.getPending(config.max_retry_attempts);
    for (const row of pending) {
      try {
        await scorer.scoreThread(row.id);
        scoringCalls += 1;
      } catch (err) {
        errors += 1;
        console.error(`[cycle] scoring failed for ${row.id}: ${err.message}`);
      }
    }

    // 3. Draft for every scored thread (new + drafter retries)
    const scored = db.getScored(config.max_retry_attempts);
    for (const row of scored) {
      try {
        await drafter.draftComment(row.id);
        draftingCalls += 1;
      } catch (err) {
        errors += 1;
        console.error(`[cycle] drafting failed for ${row.id}: ${err.message}`);
      }
    }
  } finally {
    const finishedAt = Date.now();
    db.insertCycleLog({
      started_at: startedAt,
      finished_at: finishedAt,
      threads_fetched: threadsFetched,
      threads_inserted: threadsInserted,
      scoring_calls: scoringCalls,
      drafting_calls: draftingCalls,
      errors
    });
    lastPollAt = startedAt;
    pollInProgress = false;
    console.log(
      `[cycle] done in ${finishedAt - startedAt}ms — fetched=${threadsFetched} ` +
      `inserted=${threadsInserted} scored=${scoringCalls} drafted=${draftingCalls} errors=${errors}`
    );
  }
  return { threads_found: threadsInserted, drafts_created: draftingCalls };
}

app.post('/api/poll', async (req, res) => {
  const result = await runPollCycle();
  res.json(result);
});

app.get('/api/status', (req, res) => {
  const counts = db.getStatusCounts();
  const lastCycle = db.getLastCycleLog();
  const since = Date.now() - 24 * 3600 * 1000;
  const calls = db.getApiCallsSince(since);

  let scoringCalls = 0, draftingCalls = 0, totalCost = 0;
  for (const c of calls) {
    if (c.module === 'scorer') scoringCalls += 1;
    if (c.module === 'drafter') draftingCalls += 1;
    totalCost += estimateCost(c.model, c.input_tokens, c.output_tokens);
  }

  const lastPollTs = lastCycle?.started_at ?? lastPollAt;
  const nextPollTs = lastPollTs
    ? lastPollTs + config.poll_interval_minutes * 60 * 1000
    : null;

  res.json({
    last_poll_at: lastPollTs,
    next_poll_at: nextPollTs,
    poll_in_progress: pollInProgress,
    queue_count: counts.queue_count,
    pending_count: counts.pending_count,
    failed_count: counts.failed_count,
    total_posted: counts.total_posted,
    last_24h: {
      scoring_calls: scoringCalls,
      drafting_calls: draftingCalls,
      estimated_cost_usd: Math.round(totalCost * 1000) / 1000
    },
    recent_failures: db.getRecentFailures(10)
  });
});

app.get('/api/queue', (req, res) => {
  const rows = db.getDraftReadyQueue();
  res.json(rows);
});

app.get('/api/history', (req, res) => {
  const rows = db.getRecentPosted(50);
  res.json(rows);
});

app.post('/api/approve', (req, res) => {
  const { thread_id, final_text } = req.body || {};
  if (!thread_id || typeof final_text !== 'string') {
    return res.status(400).json({ error: 'thread_id and final_text required' });
  }
  const thread = db.getThreadById(thread_id);
  if (!thread) return res.status(404).json({ error: 'thread not found' });

  db.insertPosted({
    thread_id,
    subreddit: thread.subreddit,
    thread_title: thread.title,
    thread_url: thread.url,
    final_text,
    posted_at: Date.now()
  });
  db.updateThreadStatus(thread_id, 'approved');
  res.json({ ok: true });
});

app.post('/api/skip', (req, res) => {
  const { thread_id } = req.body || {};
  if (!thread_id) return res.status(400).json({ error: 'thread_id required' });
  if (!db.getThreadById(thread_id)) return res.status(404).json({ error: 'thread not found' });
  db.updateThreadStatus(thread_id, 'skipped');
  res.json({ ok: true });
});

app.post('/api/regenerate', async (req, res) => {
  const { thread_id } = req.body || {};
  if (!thread_id) return res.status(400).json({ error: 'thread_id required' });
  const thread = db.getThreadById(thread_id);
  if (!thread) return res.status(404).json({ error: 'thread not found' });

  // Reset thread to 'scored' so drafter will run, clear any stale attempts.
  db.updateThreadStatus(thread_id, 'scored');
  try {
    const { draftText } = await drafter.draftComment(thread_id);
    res.json({ ok: true, draft_text: draftText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const cronExpr = `*/${config.poll_interval_minutes} * * * *`;
cron.schedule(cronExpr, () => {
  runPollCycle().catch((err) => console.error('[cycle] unexpected error:', err));
});
console.log(`[server] cron scheduled: ${cronExpr}`);

app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});
