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

app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});
