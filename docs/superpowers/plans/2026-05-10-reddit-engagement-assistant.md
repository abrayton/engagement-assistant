# Reddit Engagement Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally-run personal tool that polls target subreddits, scores threads with Claude Haiku, drafts comments with Claude Sonnet in the user's voice, and lets them review/approve/copy in a localhost web UI before manually posting on Reddit.

**Architecture:** Node.js + Express on port 3000. SQLite via `better-sqlite3` for state. `node-cron` runs poll cycles every 30 min. Pure `keywords.js` module for tier+gate filtering before any Claude call. Factory-function modules (`createDb`, `createScorer`, `createDrafter`, `createReddit`) wired together in `server.js` for testability. Vanilla HTML/JS frontend served from `public/`.

**Tech Stack:** Node 20+ (ESM), Express, better-sqlite3, snoowrap, @anthropic-ai/sdk, node-cron, dotenv, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-10-reddit-engagement-assistant-design.md`

---

## Sensible Deviations from the Spec

While planning, two small additions emerged that aren't in the spec but support its intent:

1. **`api_call_log` table.** Per-call token usage records so the Status tab's cost estimate is computed from real Anthropic `response.usage` numbers instead of guessed averages. Cheap to add now, painful to backfill later.
2. **Anthropic prompt caching on the system prompt** (the persona doc). The persona is still re-read from disk on every call (so user edits take effect), but with `cache_control: { type: 'ephemeral' }` on the system block, sequential calls within a 5-min window only pay full input price for the first one. Material cost reduction, ~5 lines of code.

Both are baked into the tasks below.

---

## File Structure

```
reddit-engagement-assistant/
├── package.json                    # Task 1
├── .gitignore                      # Task 1
├── .env.example                    # Task 2
├── config.json                     # Task 2
├── persona.md                      # Task 2
├── pricing.js                      # Task 11 — model price constants
├── keywords.js                     # Tasks 3–4
├── db.js                           # Tasks 5–8
├── reddit.js                       # Task 9
├── scorer.js                       # Tasks 10–12
├── drafter.js                      # Tasks 13–14
├── server.js                       # Tasks 16–19
├── tests/
│   ├── keywords.test.js            # Tasks 3–4
│   ├── db.test.js                  # Tasks 5–8
│   ├── reddit.test.js              # Task 9
│   ├── scorer.test.js              # Tasks 10–12
│   ├── drafter.test.js             # Tasks 13–14
│   └── retries.test.js             # Task 15
├── public/
│   ├── index.html                  # Task 20
│   ├── styles.css                  # Task 20
│   └── app.js                      # Tasks 21–23
├── data/                           # Task 1 (empty, gitignored)
├── README.md                       # Task 24
└── docs/superpowers/
    ├── specs/2026-05-10-reddit-engagement-assistant-design.md
    └── plans/2026-05-10-reddit-engagement-assistant.md  (this file)
```

**Module boundaries (factory pattern for testability):**
- `keywords.js` — pure functions, no I/O.
- `db.js` — `createDb(path)` returns object with named query methods.
- `reddit.js` — `createSnoowrapClient(env)` and `createReddit({ snoowrap, db, config })` returning `{ pollAllSubs }`.
- `scorer.js` — `createScorer({ anthropic, db, config, personaPath })` returning `{ scoreThread }`.
- `drafter.js` — `createDrafter({ anthropic, snoowrap, db, config, personaPath })` returning `{ draftComment }`.
- `server.js` — wires the factories together, runs cron, defines routes.

---

## Task 1: Project bootstrap

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `data/.gitkeep` (placeholder so the dir exists)
- Create: `tests/.gitkeep`
- Create: `public/.gitkeep`

- [ ] **Step 1: Create the directory scaffolding**

Run from project root:
```bash
mkdir -p data tests public
```

Expected: three new directories created.

- [ ] **Step 2: Initialize package.json and install dependencies**

Run:
```bash
npm init -y
npm install express better-sqlite3 snoowrap @anthropic-ai/sdk node-cron dotenv
npm install --save-dev vitest
```

Expected: `package.json` and `node_modules/` created. `npm install` may print warnings about snoowrap deprecations — ignore them.

- [ ] **Step 3: Edit package.json to add ESM type and scripts**

Replace `package.json` with:

```json
{
  "name": "reddit-engagement-assistant",
  "version": "1.0.0",
  "description": "Local Reddit engagement assistant — poll, score, draft, review, copy.",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "*",
    "better-sqlite3": "*",
    "dotenv": "*",
    "express": "*",
    "node-cron": "*",
    "snoowrap": "*"
  },
  "devDependencies": {
    "vitest": "*"
  }
}
```

Replace each `"*"` with the actual version `npm install` produced — copy them from the auto-generated `package.json` before this step. The structure (scripts, type) is what matters; let npm pin versions.

- [ ] **Step 4: Create .gitignore**

Create `.gitignore`:
```
node_modules/
data/*
!data/.gitkeep
.env
.vscode/
*.log
```

- [ ] **Step 5: Create empty .gitkeep files**

Run:
```bash
touch data/.gitkeep tests/.gitkeep public/.gitkeep
```

(On PowerShell: `New-Item data\.gitkeep, tests\.gitkeep, public\.gitkeep -ItemType File -Force`.)

- [ ] **Step 6: Initialize git and commit**

```bash
git init
git add .gitignore package.json package-lock.json data/.gitkeep tests/.gitkeep public/.gitkeep
git commit -m "chore: project bootstrap with deps and dirs"
```

Note: do **not** add `node_modules/`. The `.gitignore` excludes it.

---

## Task 2: Static config + persona + env template

**Files:**
- Create: `config.json`
- Create: `persona.md`
- Create: `.env.example`

- [ ] **Step 1: Create config.json**

```json
{
  "subreddits": [
    "ProgrammerHumor", "antiwork", "WorkReform", "astrology", "Zodiac",
    "CosmicNoFilter", "witchcraft", "SideProject", "cscareerquestions",
    "Entrepreneur", "indiehackers", "webdev", "jobs", "careerguidance",
    "mildlyinfuriating", "lostgeneration"
  ],
  "keywords": {
    "strong": [
      "mercury retrograde", "birth chart", "rising sign", "natal chart",
      "astrology reading", "big three", "sun moon rising", "saturn return",
      "what's your sign",
      "per my last email", "circle back", "touch base", "low hanging fruit",
      "move the needle", "synergy", "quiet quitting", "corporate speak",
      "performance review", "annual review", "manager said", "HR told me",
      "side project", "just shipped", "weekend project", "looking for feedback",
      "roast my", "first users", "just launched"
    ],
    "weak": [
      "retrograde", "alignment", "stakeholder", "deliverables",
      "going forward", "made this", "I built"
    ]
  },
  "poll_interval_minutes": 30,
  "min_relevance_score": 7,
  "max_thread_age_hours": 12,
  "soft_comment_limit": 50,
  "hard_comment_limit": 100,
  "weak_gate_fresh_age_hours": 2,
  "weak_gate_fresh_comment_count": 10,
  "max_retry_attempts": 3,
  "models": {
    "scorer": "claude-haiku-4-5-20251001",
    "drafter": "claude-sonnet-4-6"
  },
  "port": 3000,
  "db_path": "data/assistant.db",
  "persona_path": "persona.md"
}
```

- [ ] **Step 2: Create persona.md (starter content)**

```markdown
# Reddit Persona: /u/nearby-doughnuts

## Who I Am
Tech person who builds weird little web things for fun. Dry sense of humor.
I find corporate culture absurd but I've lived in it. I make side projects,
some useful, some just funny. Current main project: quarterlyoracle.com — a
corporate horoscope generator that plays it completely straight. No winking
at the joke. I also work on other projects at formeverandever.com.

## Voice Rules
- Short to medium length. Never write paragraphs when a sentence works.
- Dry, not sarcastic. Observe absurdity, don't editorialize about it.
- Never use: "fascinating", "indeed", "as someone who", "I'd argue", "straightforward"
- Never use marketing language or hype words
- Don't explain the joke
- Occasional self-deprecation is fine, excessive humility is not
- I participate in astrology communities genuinely — I don't mock the subject

## Tone by Subreddit
- r/ProgrammerHumor: Dry one-liners. React to the post, don't lecture.
- r/antiwork: Solidarity without being preachy. Share the absurdity.
- r/astrology: Genuine. I find it interesting even if I hold it lightly.
- r/SideProject: Builder-to-builder. Specific feedback, honest observations.
- r/cscareerquestions: Direct, practical. No hustle-culture advice.
- r/Entrepreneur: Anti-hype. Honest takes only.

## What I Never Do
- Mention my projects unless it's genuinely relevant and the thread invites it
- Give unsolicited productivity advice
- Start comments with "This" or "Honestly" or "Great post"
- Comment on political posts
- Engage with trolls or argue with downvotes

## Recent Comment History
(Update this section manually after posting anything)
- [date] r/[subreddit] — [paste exact text of comment here]

## Projects I Can Mention (only when directly relevant)
- quarterlyoracle.com — corporate horoscope generator, free 8-ball requires no signup
- formeverandever.com — mention only when the thread is directly relevant
```

- [ ] **Step 3: Create .env.example**

```
# Reddit script-app credentials (get from https://reddit.com/prefs/apps)
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USERNAME=nearby-doughnuts
REDDIT_PASSWORD=
REDDIT_USER_AGENT=reddit-assistant/1.0 by nearby-doughnuts

# Anthropic API key (https://console.anthropic.com)
ANTHROPIC_API_KEY=
```

- [ ] **Step 4: Commit**

```bash
git add config.json persona.md .env.example
git commit -m "chore: add starter config, persona, and env template"
```

---

## Task 3: keywords.js — matchKeywords (TDD)

**Files:**
- Create: `tests/keywords.test.js`
- Create: `keywords.js`

- [ ] **Step 1: Write failing tests for matchKeywords**

Create `tests/keywords.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { matchKeywords } from '../keywords.js';

const config = {
  strong: ['mercury retrograde', 'circle back', 'roast my'],
  weak: ['alignment', 'I built']
};

describe('matchKeywords', () => {
  it('returns empty arrays when no keywords match', () => {
    const result = matchKeywords('totally unrelated text about cats', config);
    expect(result.strong).toEqual([]);
    expect(result.weak).toEqual([]);
  });

  it('matches strong keywords case-insensitively', () => {
    const result = matchKeywords('Mercury Retrograde is wild', config);
    expect(result.strong).toEqual(['mercury retrograde']);
    expect(result.weak).toEqual([]);
  });

  it('matches weak keywords', () => {
    const result = matchKeywords('alignment between teams', config);
    expect(result.strong).toEqual([]);
    expect(result.weak).toEqual(['alignment']);
  });

  it('matches multiple weak keywords in same text', () => {
    const result = matchKeywords('I built an app, looking at alignment', config);
    expect(result.strong).toEqual([]);
    expect(result.weak.sort()).toEqual(['I built', 'alignment'].sort());
  });

  it('matches strong and weak together', () => {
    const result = matchKeywords('circle back on alignment', config);
    expect(result.strong).toEqual(['circle back']);
    expect(result.weak).toEqual(['alignment']);
  });

  it('handles empty input safely', () => {
    const result = matchKeywords('', config);
    expect(result.strong).toEqual([]);
    expect(result.weak).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/keywords.test.js`

Expected: FAIL with "Failed to load url ../keywords.js" (or similar — file doesn't exist yet).

- [ ] **Step 3: Implement matchKeywords**

Create `keywords.js`:

```js
export function matchKeywords(text, keywords) {
  const lower = (text || '').toLowerCase();
  const strong = keywords.strong.filter((kw) => lower.includes(kw.toLowerCase()));
  const weak = keywords.weak.filter((kw) => lower.includes(kw.toLowerCase()));
  return { strong, weak };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/keywords.test.js`

Expected: PASS — 6 tests for `matchKeywords`.

- [ ] **Step 5: Commit**

```bash
git add tests/keywords.test.js keywords.js
git commit -m "feat(keywords): matchKeywords tier matcher"
```

---

## Task 4: keywords.js — passesGate (TDD)

**Files:**
- Modify: `tests/keywords.test.js` (append `passesGate` describe block)
- Modify: `keywords.js` (add `passesGate` export)

- [ ] **Step 1: Append failing tests for passesGate**

Append to `tests/keywords.test.js` (after the closing `}` of the existing `describe`):

```js
import { passesGate } from '../keywords.js';

describe('passesGate', () => {
  const cfg = { weak_gate_fresh_age_hours: 2, weak_gate_fresh_comment_count: 10 };

  it('passes when any strong keyword matches, regardless of age/traffic', () => {
    expect(passesGate({ strong: ['synergy'], weak: [] }, 11, 95, cfg)).toBe(true);
  });

  it('drops when no keywords match at all', () => {
    expect(passesGate({ strong: [], weak: [] }, 1, 5, cfg)).toBe(false);
  });

  it('passes when 2+ weak keywords match (co-occurrence)', () => {
    expect(passesGate({ strong: [], weak: ['alignment', 'I built'] }, 5, 50, cfg)).toBe(true);
  });

  it('drops single weak match on stale, busy thread', () => {
    expect(passesGate({ strong: [], weak: ['alignment'] }, 8, 50, cfg)).toBe(false);
  });

  it('passes single weak match on fresh, low-traffic thread', () => {
    expect(passesGate({ strong: [], weak: ['alignment'] }, 1, 5, cfg)).toBe(true);
  });

  it('drops single weak match if too old, even with low comments', () => {
    expect(passesGate({ strong: [], weak: ['alignment'] }, 3, 5, cfg)).toBe(false);
  });

  it('drops single weak match if too busy, even fresh', () => {
    expect(passesGate({ strong: [], weak: ['alignment'] }, 1, 15, cfg)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/keywords.test.js`

Expected: FAIL — "passesGate is not exported".

- [ ] **Step 3: Implement passesGate**

Append to `keywords.js`:

```js
export function passesGate(matches, ageHours, commentCount, config) {
  if (matches.strong.length > 0) return true;
  if (matches.weak.length === 0) return false;
  if (matches.weak.length >= 2) return true;
  if (
    ageHours < config.weak_gate_fresh_age_hours &&
    commentCount < config.weak_gate_fresh_comment_count
  ) {
    return true;
  }
  return false;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/keywords.test.js`

Expected: PASS — all 13 tests (6 matchKeywords + 7 passesGate).

- [ ] **Step 5: Commit**

```bash
git add tests/keywords.test.js keywords.js
git commit -m "feat(keywords): passesGate tier+freshness rule"
```

---

## Task 5: db.js — schema migration + thread insert/get (TDD)

**Files:**
- Create: `tests/db.test.js`
- Create: `db.js`

- [ ] **Step 1: Write failing tests for schema + thread basics**

Create `tests/db.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/db.test.js`

Expected: FAIL — `db.js` does not exist.

- [ ] **Step 3: Implement db.js — schema and thread basics**

Create `db.js`:

```js
import Database from 'better-sqlite3';

export function createDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  function migrate() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        subreddit TEXT,
        title TEXT,
        body TEXT,
        url TEXT,
        author TEXT,
        score INTEGER,
        comment_count INTEGER,
        created_utc INTEGER,
        fetched_at INTEGER,
        age_hours REAL,
        matched_strong TEXT,
        matched_weak TEXT,
        relevance_score INTEGER,
        raw_relevance_score INTEGER,
        relevance_reason TEXT,
        suggested_angle TEXT,
        high_traffic_flag INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        status TEXT DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT,
        draft_text TEXT,
        created_at INTEGER,
        FOREIGN KEY (thread_id) REFERENCES threads(id)
      );

      CREATE TABLE IF NOT EXISTS posted (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT,
        subreddit TEXT,
        thread_title TEXT,
        thread_url TEXT,
        final_text TEXT,
        posted_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS cycle_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER,
        finished_at INTEGER,
        threads_fetched INTEGER DEFAULT 0,
        threads_inserted INTEGER DEFAULT 0,
        scoring_calls INTEGER DEFAULT 0,
        drafting_calls INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS api_call_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        called_at INTEGER,
        module TEXT,
        model TEXT,
        thread_id TEXT,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        success INTEGER DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status);
      CREATE INDEX IF NOT EXISTS idx_api_call_log_called_at ON api_call_log(called_at);
    `);
  }
  migrate();

  // ---- prepared statements ----
  const stmts = {
    threadExists: db.prepare('SELECT 1 FROM threads WHERE id = ?'),
    insertThread: db.prepare(`
      INSERT INTO threads (
        id, subreddit, title, body, url, author, score, comment_count,
        created_utc, fetched_at, age_hours, matched_strong, matched_weak
      ) VALUES (
        @id, @subreddit, @title, @body, @url, @author, @score, @comment_count,
        @created_utc, @fetched_at, @age_hours, @matched_strong, @matched_weak
      )
    `),
    getThreadById: db.prepare('SELECT * FROM threads WHERE id = ?')
  };

  return {
    migrate,
    threadExists(id) { return !!stmts.threadExists.get(id); },
    insertThread(row) { stmts.insertThread.run(row); },
    getThreadById(id) { return stmts.getThreadById.get(id); },
    close() { db.close(); }
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/db.test.js`

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/db.test.js db.js
git commit -m "feat(db): schema migration and thread insert/get"
```

---

## Task 6: db.js — pending/scored queries + status updates + retries (TDD)

**Files:**
- Modify: `tests/db.test.js` (append)
- Modify: `db.js` (extend)

- [ ] **Step 1: Append failing tests**

Append to `tests/db.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/db.test.js`

Expected: FAIL — methods like `getPending`, `updateThreadAfterScoring` don't exist.

- [ ] **Step 3: Implement the new methods**

Extend `db.js` — add to the `stmts` object inside `createDb`:

```js
    getPending: db.prepare(`
      SELECT * FROM threads
      WHERE status = 'pending' AND attempts < ?
      ORDER BY fetched_at ASC
    `),
    getScored: db.prepare(`
      SELECT * FROM threads
      WHERE status = 'scored' AND attempts < ?
      ORDER BY relevance_score DESC, fetched_at ASC
    `),
    updateThreadAfterScoring: db.prepare(`
      UPDATE threads SET
        raw_relevance_score = @raw_relevance_score,
        relevance_score = @relevance_score,
        relevance_reason = @relevance_reason,
        suggested_angle = @suggested_angle,
        high_traffic_flag = @high_traffic_flag,
        status = @status
      WHERE id = @id
    `),
    updateThreadStatus: db.prepare('UPDATE threads SET status = ? WHERE id = ?'),
    incrementAttempts: db.prepare(`
      UPDATE threads SET
        attempts = attempts + 1,
        last_error = ?,
        status = ?
      WHERE id = ?
    `)
```

And add these methods to the returned object:

```js
    getPending(maxAttempts) { return stmts.getPending.all(maxAttempts); },
    getScored(maxAttempts) { return stmts.getScored.all(maxAttempts); },
    updateThreadAfterScoring(id, fields) {
      stmts.updateThreadAfterScoring.run({ id, ...fields });
    },
    updateThreadStatus(id, status) { stmts.updateThreadStatus.run(status, id); },
    incrementAttempts(id, errorMessage, newStatus) {
      stmts.incrementAttempts.run(errorMessage, newStatus, id);
    },
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/db.test.js`

Expected: PASS — 11 tests total.

- [ ] **Step 5: Commit**

```bash
git add tests/db.test.js db.js
git commit -m "feat(db): pipeline queries, status updates, retry counter"
```

---

## Task 7: db.js — drafts, posted, cycle_log, api_call_log (TDD)

**Files:**
- Modify: `tests/db.test.js` (append)
- Modify: `db.js` (extend)

- [ ] **Step 1: Append failing tests**

Append to `tests/db.test.js`:

```js
describe('drafts and posted', () => {
  let db;
  beforeEach(() => {
    db = makeDb();
    db.insertThread({
      id: 't3_a', subreddit: 'webdev', title: 't', body: '', url: 'u',
      author: 'x', score: 1, comment_count: 0, created_utc: 0,
      fetched_at: 0, age_hours: 0, matched_strong: '[]', matched_weak: '[]'
    });
  });

  it('insertDraft + getLatestDraft round-trip', () => {
    db.insertDraft('t3_a', 'first draft');
    db.insertDraft('t3_a', 'second draft');
    const latest = db.getLatestDraft('t3_a');
    expect(latest.draft_text).toBe('second draft');
  });

  it('deleteDraftsForThread clears prior drafts', () => {
    db.insertDraft('t3_a', 'first');
    db.deleteDraftsForThread('t3_a');
    expect(db.getLatestDraft('t3_a')).toBeUndefined();
  });

  it('insertPosted + getRecentPosted', () => {
    db.insertPosted({
      thread_id: 't3_a', subreddit: 'webdev', thread_title: 't',
      thread_url: 'u', final_text: 'hello', posted_at: 1700000000
    });
    const recent = db.getRecentPosted(10);
    expect(recent.length).toBe(1);
    expect(recent[0].final_text).toBe('hello');
  });
});

describe('cycle_log and api_call_log', () => {
  let db;
  beforeEach(() => { db = makeDb(); });

  it('insertCycleLog stores a row', () => {
    db.insertCycleLog({
      started_at: 1, finished_at: 2,
      threads_fetched: 5, threads_inserted: 2,
      scoring_calls: 1, drafting_calls: 1, errors: 0
    });
    const last = db.getLastCycleLog();
    expect(last.threads_fetched).toBe(5);
  });

  it('logApiCall stores a row and getApiCallsSince filters by time', () => {
    db.logApiCall({
      called_at: 100, module: 'scorer', model: 'm', thread_id: 't3_a',
      input_tokens: 50, output_tokens: 20, success: 1
    });
    db.logApiCall({
      called_at: 50, module: 'drafter', model: 'm', thread_id: 't3_a',
      input_tokens: 200, output_tokens: 80, success: 1
    });
    const sinceTime = 75;
    const calls = db.getApiCallsSince(sinceTime);
    expect(calls.length).toBe(1);
    expect(calls[0].module).toBe('scorer');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/db.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement the new methods**

Extend `db.js` — add to `stmts`:

```js
    insertDraft: db.prepare(`
      INSERT INTO drafts (thread_id, draft_text, created_at)
      VALUES (?, ?, ?)
    `),
    getLatestDraft: db.prepare(`
      SELECT * FROM drafts WHERE thread_id = ?
      ORDER BY created_at DESC LIMIT 1
    `),
    deleteDraftsForThread: db.prepare('DELETE FROM drafts WHERE thread_id = ?'),
    insertPosted: db.prepare(`
      INSERT INTO posted (thread_id, subreddit, thread_title, thread_url, final_text, posted_at)
      VALUES (@thread_id, @subreddit, @thread_title, @thread_url, @final_text, @posted_at)
    `),
    getRecentPosted: db.prepare('SELECT * FROM posted ORDER BY posted_at DESC LIMIT ?'),
    insertCycleLog: db.prepare(`
      INSERT INTO cycle_log (
        started_at, finished_at, threads_fetched, threads_inserted,
        scoring_calls, drafting_calls, errors
      ) VALUES (
        @started_at, @finished_at, @threads_fetched, @threads_inserted,
        @scoring_calls, @drafting_calls, @errors
      )
    `),
    getLastCycleLog: db.prepare('SELECT * FROM cycle_log ORDER BY id DESC LIMIT 1'),
    logApiCall: db.prepare(`
      INSERT INTO api_call_log (called_at, module, model, thread_id, input_tokens, output_tokens, success)
      VALUES (@called_at, @module, @model, @thread_id, @input_tokens, @output_tokens, @success)
    `),
    getApiCallsSince: db.prepare('SELECT * FROM api_call_log WHERE called_at >= ?')
```

And add to the returned object:

```js
    insertDraft(threadId, text) {
      stmts.insertDraft.run(threadId, text, Date.now());
    },
    getLatestDraft(threadId) { return stmts.getLatestDraft.get(threadId); },
    deleteDraftsForThread(threadId) { stmts.deleteDraftsForThread.run(threadId); },
    insertPosted(row) { stmts.insertPosted.run(row); },
    getRecentPosted(limit) { return stmts.getRecentPosted.all(limit); },
    insertCycleLog(row) { stmts.insertCycleLog.run(row); },
    getLastCycleLog() { return stmts.getLastCycleLog.get(); },
    logApiCall(row) { stmts.logApiCall.run(row); },
    getApiCallsSince(timestamp) { return stmts.getApiCallsSince.all(timestamp); },
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/db.test.js`

Expected: PASS — 16 tests total.

- [ ] **Step 5: Commit**

```bash
git add tests/db.test.js db.js
git commit -m "feat(db): drafts, posted, cycle_log, api_call_log queries"
```

---

## Task 8: db.js — composite queries for queue/history/status (TDD)

**Files:**
- Modify: `tests/db.test.js` (append)
- Modify: `db.js` (extend)

- [ ] **Step 1: Append failing tests**

Append to `tests/db.test.js`:

```js
describe('composite queries', () => {
  let db;
  beforeEach(() => {
    db = makeDb();
    db.insertThread({
      id: 't3_a', subreddit: 'webdev', title: 'first', body: 'body a', url: 'u1',
      author: 'x', score: 5, comment_count: 3, created_utc: 0,
      fetched_at: 100, age_hours: 1.0, matched_strong: '[]', matched_weak: '[]'
    });
    db.updateThreadAfterScoring('t3_a', {
      raw_relevance_score: 9, relevance_score: 9,
      relevance_reason: 'fits', suggested_angle: 'dry',
      high_traffic_flag: 0, status: 'scored'
    });
    db.updateThreadStatus('t3_a', 'draft_ready');
    db.insertDraft('t3_a', 'hello world');
  });

  it('getDraftReadyQueue joins thread and latest draft', () => {
    const queue = db.getDraftReadyQueue();
    expect(queue.length).toBe(1);
    expect(queue[0].id).toBe('t3_a');
    expect(queue[0].draft_text).toBe('hello world');
    expect(queue[0].relevance_score).toBe(9);
  });

  it('getDraftReadyQueue is sorted by relevance_score DESC', () => {
    db.insertThread({
      id: 't3_b', subreddit: 'webdev', title: 'second', body: '', url: 'u2',
      author: 'x', score: 5, comment_count: 3, created_utc: 0,
      fetched_at: 200, age_hours: 1.0, matched_strong: '[]', matched_weak: '[]'
    });
    db.updateThreadAfterScoring('t3_b', {
      raw_relevance_score: 10, relevance_score: 10,
      relevance_reason: 'r', suggested_angle: 'a',
      high_traffic_flag: 0, status: 'scored'
    });
    db.updateThreadStatus('t3_b', 'draft_ready');
    db.insertDraft('t3_b', 'higher score draft');
    const queue = db.getDraftReadyQueue();
    expect(queue.map((r) => r.id)).toEqual(['t3_b', 't3_a']);
  });

  it('getStatusCounts reports queue/posted/pending/failed', () => {
    const counts = db.getStatusCounts();
    expect(counts.queue_count).toBe(1);
    expect(counts.pending_count).toBe(0);
    expect(counts.failed_count).toBe(0);
    expect(counts.total_posted).toBe(0);
  });

  it('getRecentFailures returns failed threads with errors', () => {
    db.insertThread({
      id: 't3_c', subreddit: 'webdev', title: 'fails', body: '', url: 'u3',
      author: 'x', score: 1, comment_count: 0, created_utc: 0,
      fetched_at: 300, age_hours: 0, matched_strong: '[]', matched_weak: '[]'
    });
    db.incrementAttempts('t3_c', 'last error msg', 'failed');
    const fails = db.getRecentFailures(5);
    expect(fails.length).toBe(1);
    expect(fails[0].last_error).toBe('last error msg');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/db.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement composite queries**

Extend `db.js` — add to `stmts`:

```js
    getDraftReadyQueue: db.prepare(`
      SELECT t.*,
             d.draft_text,
             d.created_at AS draft_created_at
      FROM threads t
      LEFT JOIN drafts d ON d.id = (
        SELECT id FROM drafts WHERE thread_id = t.id
        ORDER BY created_at DESC LIMIT 1
      )
      WHERE t.status = 'draft_ready'
      ORDER BY t.relevance_score DESC, t.fetched_at DESC
    `),
    getStatusCounts: db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM threads WHERE status = 'draft_ready') AS queue_count,
        (SELECT COUNT(*) FROM threads WHERE status = 'pending')     AS pending_count,
        (SELECT COUNT(*) FROM threads WHERE status = 'failed')      AS failed_count,
        (SELECT COUNT(*) FROM posted)                               AS total_posted
    `),
    getRecentFailures: db.prepare(`
      SELECT id, subreddit, title, url, last_error, attempts, fetched_at
      FROM threads WHERE status = 'failed'
      ORDER BY fetched_at DESC LIMIT ?
    `)
```

Add to returned object:

```js
    getDraftReadyQueue() { return stmts.getDraftReadyQueue.all(); },
    getStatusCounts() { return stmts.getStatusCounts.get(); },
    getRecentFailures(limit) { return stmts.getRecentFailures.all(limit); },
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/db.test.js`

Expected: PASS — 20 tests total.

- [ ] **Step 5: Commit**

```bash
git add tests/db.test.js db.js
git commit -m "feat(db): composite queries for queue, status, failures"
```

---

## Task 9: reddit.js — snoowrap client + pollAllSubs (TDD with fake)

**Files:**
- Create: `tests/reddit.test.js`
- Create: `reddit.js`

Note: snoowrap is awkward to mock at module level. We use dependency injection — `createReddit` accepts a snoowrap-shaped client object, so tests pass a fake.

- [ ] **Step 1: Write failing tests**

Create `tests/reddit.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/reddit.test.js`

Expected: FAIL — `reddit.js` does not exist.

- [ ] **Step 3: Implement reddit.js**

Create `reddit.js`:

```js
import Snoowrap from 'snoowrap';
import { matchKeywords, passesGate } from './keywords.js';

export function createSnoowrapClient(env) {
  return new Snoowrap({
    userAgent: env.REDDIT_USER_AGENT,
    clientId: env.REDDIT_CLIENT_ID,
    clientSecret: env.REDDIT_CLIENT_SECRET,
    username: env.REDDIT_USERNAME,
    password: env.REDDIT_PASSWORD
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/reddit.test.js`

Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/reddit.test.js reddit.js
git commit -m "feat(reddit): pollAllSubs with tier+gate filtering and 429 backoff"
```

---

## Task 10: scorer.js — penalty math (pure helper, TDD)

**Files:**
- Create: `tests/scorer.test.js`
- Create: `scorer.js`

- [ ] **Step 1: Write failing tests for applyPenalty**

Create `tests/scorer.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { applyPenalty } from '../scorer.js';

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/scorer.test.js`

Expected: FAIL — `scorer.js` does not exist.

- [ ] **Step 3: Create scorer.js with the helper**

Create `scorer.js`:

```js
export function applyPenalty(rawScore, ageHours, commentCount, config) {
  let score = rawScore;
  if (commentCount > config.soft_comment_limit) score -= 2;
  if (ageHours > 6) score -= 1;
  return Math.max(1, score);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/scorer.test.js`

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/scorer.test.js scorer.js
git commit -m "feat(scorer): post-Claude penalty math"
```

---

## Task 11: pricing.js + scorer.js — Claude Haiku scoring call (TDD)

**Files:**
- Create: `pricing.js`
- Modify: `tests/scorer.test.js` (append)
- Modify: `scorer.js` (add `createScorer`)

- [ ] **Step 1: Create pricing.js**

```js
// USD per 1M tokens. Update if Anthropic changes pricing.
export const PRICING = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00 }
};

export function estimateCost(model, inputTokens, outputTokens) {
  const p = PRICING[model];
  if (!p) return 0;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}
```

- [ ] **Step 2: Update imports + append failing scorer tests**

ESM requires imports at the top. First, **replace the existing imports at the top of `tests/scorer.test.js`** with the consolidated list:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyPenalty, createScorer } from '../scorer.js';
import { createDb } from '../db.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
```

Then **append** the following to the end of `tests/scorer.test.js` (after the existing `describe('applyPenalty', ...)` block):

```js
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
```

Then **append** the cleanup hook (just after the `beforeEach(...)` block):

```js
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });
```

(`afterEach` was already added to the imports at the top of the file.)

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/scorer.test.js`

Expected: FAIL — `createScorer` not exported.

- [ ] **Step 4: Implement createScorer in scorer.js**

Append to `scorer.js`:

```js
import { readFileSync } from 'fs';

export function createScorer({ anthropic, db, config, personaPath }) {
  return {
    async scoreThread(threadId) {
      const thread = db.getThreadById(threadId);
      if (!thread) throw new Error(`Thread ${threadId} not found`);

      const persona = readFileSync(personaPath, 'utf8');
      const systemText = buildScoringSystemPrompt(persona);
      const userText = buildScoringUserPrompt(thread);

      let response;
      try {
        response = await anthropic.messages.create({
          model: config.models.scorer,
          max_tokens: 400,
          system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: userText }]
        });
      } catch (err) {
        db.logApiCall({
          called_at: Date.now(), module: 'scorer', model: config.models.scorer,
          thread_id: threadId, input_tokens: 0, output_tokens: 0, success: 0
        });
        const newAttempts = thread.attempts + 1;
        const newStatus = newAttempts >= config.max_retry_attempts ? 'failed' : 'pending';
        db.incrementAttempts(threadId, err.message, newStatus);
        throw err;
      }

      db.logApiCall({
        called_at: Date.now(), module: 'scorer', model: config.models.scorer,
        thread_id: threadId,
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
        success: 1
      });

      let parsed;
      try {
        parsed = parseScoringResponse(response.content[0].text);
      } catch (err) {
        const newAttempts = thread.attempts + 1;
        const newStatus = newAttempts >= config.max_retry_attempts ? 'failed' : 'pending';
        db.incrementAttempts(threadId, `parse: ${err.message}`, newStatus);
        throw err;
      }

      const finalScore = applyPenalty(parsed.score, thread.age_hours, thread.comment_count, config);
      const highTraffic = parsed.score >= 9 && finalScore < config.min_relevance_score;
      const status = (highTraffic || finalScore >= config.min_relevance_score)
        ? 'scored'
        : 'skipped_low_score';

      db.updateThreadAfterScoring(threadId, {
        raw_relevance_score: parsed.score,
        relevance_score: finalScore,
        relevance_reason: parsed.reason ?? '',
        suggested_angle: parsed.suggested_angle ?? null,
        high_traffic_flag: highTraffic ? 1 : 0,
        status
      });

      return { status, relevance_score: finalScore };
    }
  };
}

function parseScoringResponse(text) {
  let t = (text || '').trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return JSON.parse(t);
}

function buildScoringSystemPrompt(persona) {
  return `You are evaluating Reddit threads for engagement opportunities for a specific person.
Read their persona doc carefully before scoring. Your job is to find threads where
a genuine, natural comment from this person would fit — not to find promotional opportunities.

${persona}`;
}

function buildScoringUserPrompt(thread) {
  const body = thread.body && thread.body.length > 0
    ? thread.body.slice(0, 500)
    : '[link post]';
  return `Score this Reddit thread for engagement opportunity on a scale of 1-10.

10 = perfect fit, completely natural place to comment in this voice, high chance of upvotes
7-9 = good fit, clear angle exists, low risk
4-6 = marginal, could work but feels forced
1-3 = no fit, wrong vibe, or risky

Consider:
- Does this thread match the subreddit tone rules in the persona?
- Is there a natural comment this person could make WITHOUT mentioning their projects?
- Would a comment here build the right profile for this account?
- Thread age: ${thread.age_hours.toFixed(1)} hours old
- Comment count: ${thread.comment_count} comments

Threads under 2 hours old with under 20 comments are higher opportunity — weight this positively.

Respond in JSON only, no other text:
{
  "score": 7,
  "reason": "one sentence explanation of why this is or isn't a fit",
  "suggested_angle": "brief note on what kind of comment would land here, or null if low score"
}

Thread:
Subreddit: r/${thread.subreddit}
Title: ${thread.title}
Body: ${body}
Post score: ${thread.score}
Comment count: ${thread.comment_count}
Age: ${thread.age_hours.toFixed(1)} hours`;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/scorer.test.js`

Expected: PASS — 10 tests.

- [ ] **Step 6: Commit**

```bash
git add pricing.js tests/scorer.test.js scorer.js
git commit -m "feat(scorer): Haiku scoring call with caching, penalty, and api logging"
```

---

## Task 12: scorer.js — retry counter integration test (TDD)

**Files:**
- Modify: `tests/scorer.test.js` (append)

This task adds a focused test for the retry path. The implementation already handles it from Task 11; this just verifies behavior end-to-end.

- [ ] **Step 1: Append failing test**

Append to `tests/scorer.test.js`:

```js
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
});
```

- [ ] **Step 2: Run to verify pass (no implementation change needed)**

Run: `npx vitest run tests/scorer.test.js`

Expected: PASS — 12 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/scorer.test.js
git commit -m "test(scorer): retry counter end-to-end coverage"
```

---

## Task 13: drafter.js — top-comment fetch helper (TDD)

**Files:**
- Create: `tests/drafter.test.js`
- Create: `drafter.js`

- [ ] **Step 1: Write failing tests for fetchTopComments**

Create `tests/drafter.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { fetchTopComments } from '../drafter.js';

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/drafter.test.js`

Expected: FAIL — `drafter.js` does not exist.

- [ ] **Step 3: Implement fetchTopComments**

Create `drafter.js`:

```js
import { readFileSync } from 'fs';

export async function fetchTopComments(snoowrap, threadId) {
  try {
    const submission = await snoowrap.getSubmission(threadId).fetch();
    const comments = submission.comments || [];
    return comments
      .slice(0, 3)
      .map((c) => (c.body || '').slice(0, 150));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/drafter.test.js`

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/drafter.test.js drafter.js
git commit -m "feat(drafter): top-comment fetch helper"
```

---

## Task 14: drafter.js — draftComment with Sonnet call (TDD)

**Files:**
- Modify: `tests/drafter.test.js` (append)
- Modify: `drafter.js` (add `createDrafter`)

- [ ] **Step 1: Update imports + append failing tests**

ESM requires imports at the top. **Replace the existing imports at the top of `tests/drafter.test.js`** with this consolidated list:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchTopComments, createDrafter } from '../drafter.js';
import { createDb } from '../db.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
```

Then **append** the following to the end of `tests/drafter.test.js` (after the existing `describe('fetchTopComments', ...)` block):

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/drafter.test.js`

Expected: FAIL — `createDrafter` not exported.

- [ ] **Step 3: Implement createDrafter**

Append to `drafter.js`:

```js
export function createDrafter({ anthropic, snoowrap, db, config, personaPath }) {
  return {
    async draftComment(threadId) {
      const thread = db.getThreadById(threadId);
      if (!thread) throw new Error(`Thread ${threadId} not found`);

      const persona = readFileSync(personaPath, 'utf8');
      const recent = db.getRecentPosted(10);
      const topComments = await fetchTopComments(snoowrap, threadId);

      const systemText = buildDraftingSystemPrompt(persona);
      const userText = buildDraftingUserPrompt(thread, recent, topComments);

      let response;
      try {
        response = await anthropic.messages.create({
          model: config.models.drafter,
          max_tokens: 600,
          system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: userText }]
        });
      } catch (err) {
        db.logApiCall({
          called_at: Date.now(), module: 'drafter', model: config.models.drafter,
          thread_id: threadId, input_tokens: 0, output_tokens: 0, success: 0
        });
        const newAttempts = thread.attempts + 1;
        const newStatus = newAttempts >= config.max_retry_attempts ? 'failed' : 'scored';
        db.incrementAttempts(threadId, err.message, newStatus);
        throw err;
      }

      db.logApiCall({
        called_at: Date.now(), module: 'drafter', model: config.models.drafter,
        thread_id: threadId,
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
        success: 1
      });

      const draftText = (response.content[0].text || '').trim();
      db.deleteDraftsForThread(threadId);
      db.insertDraft(threadId, draftText);
      db.updateThreadStatus(threadId, 'draft_ready');

      return { draftText };
    }
  };
}

function buildDraftingSystemPrompt(persona) {
  return `You are writing a Reddit comment on behalf of a specific person.
Read their persona doc carefully. Write exactly as they would write.
Output only the comment text itself — no preamble, no explanation, no quotes around it.

${persona}`;
}

function buildDraftingUserPrompt(thread, recent, topComments) {
  const recentBlock = recent.length === 0
    ? 'No comment history yet.'
    : recent.map((r) => {
        const date = new Date(r.posted_at).toISOString().slice(0, 10);
        return `r/${r.subreddit} (${date}): ${r.final_text}`;
      }).join('\n');

  const topBlock = topComments.length === 0
    ? 'none yet'
    : topComments.map((c, i) => `${i + 1}. ${c}`).join('\n');

  const body = thread.body && thread.body.length > 0
    ? thread.body.slice(0, 500)
    : '[link post]';

  return `Write one comment for the Reddit thread below.

Follow all voice rules from the persona strictly.
Do not mention their projects unless the suggested_angle explicitly calls for it.
Match the tone for this specific subreddit as described in the persona.

Recent posted comments for consistency (do not repeat these phrasings or angles):
${recentBlock}

Scoring context:
- Why this thread is relevant: ${thread.relevance_reason}
- Suggested angle: ${thread.suggested_angle ?? 'none'}

Thread:
Subreddit: r/${thread.subreddit}
Title: ${thread.title}
Body: ${body}
Top comments so far: ${topBlock}
Age: ${thread.age_hours.toFixed(1)} hours old
Comment count: ${thread.comment_count}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/drafter.test.js`

Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/drafter.test.js drafter.js
git commit -m "feat(drafter): Sonnet drafting with prompt cache, top-comments, retry"
```

---

## Task 15: retries integration test (full pipeline TDD)

**Files:**
- Create: `tests/retries.test.js`

This test composes `db + scorer` and verifies the retry counter survives multiple cycles correctly. Implementation is already in place; the test exists for future regression safety.

- [ ] **Step 1: Write the test**

Create `tests/retries.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify pass**

Run: `npx vitest run tests/retries.test.js`

Expected: PASS — 1 test (everything else already implemented).

- [ ] **Step 3: Run full suite to confirm no regressions**

Run: `npm test`

Expected: PASS — all tests across all files.

- [ ] **Step 4: Commit**

```bash
git add tests/retries.test.js
git commit -m "test(retries): full pipeline retry coverage"
```

---

## Task 16: server.js — Express bootstrap + /api/status

**Files:**
- Create: `server.js`

This task sets up the Express app with all dependencies wired, but only one route. Subsequent tasks add more routes and the cron scheduler.

- [ ] **Step 1: Create server.js with bootstrap and /api/status**

```js
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

app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});
```

- [ ] **Step 2: Smoke test — start the server**

```bash
node server.js
```

Expected: prints `[server] listening on http://localhost:3000`. The server runs but you have no `.env` yet, so secrets are missing. That's OK for this step — `snoowrap` will create a client with empty creds (no calls made yet), Anthropic client similarly.

In another terminal:
```bash
curl http://localhost:3000/api/status
```

Expected: JSON like `{"last_poll_at":null,"next_poll_at":null,"poll_in_progress":false,"queue_count":0,"pending_count":0,"failed_count":0,"total_posted":0,"last_24h":{"scoring_calls":0,"drafting_calls":0,"estimated_cost_usd":0},"recent_failures":[]}`.

Stop the server with Ctrl+C. The `data/assistant.db` file should now exist.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(server): bootstrap Express + /api/status route"
```

---

## Task 17: server.js — /api/queue + /api/history routes

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add the two routes**

Insert these after the `/api/status` handler in `server.js`:

```js
app.get('/api/queue', (req, res) => {
  const rows = db.getDraftReadyQueue();
  res.json(rows);
});

app.get('/api/history', (req, res) => {
  const rows = db.getRecentPosted(50);
  res.json(rows);
});
```

- [ ] **Step 2: Smoke test**

```bash
node server.js
```

In another terminal:
```bash
curl http://localhost:3000/api/queue
curl http://localhost:3000/api/history
```

Expected: both return `[]` (empty arrays — no data yet).

Stop server.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(server): /api/queue and /api/history routes"
```

---

## Task 18: server.js — /api/approve, /api/skip, /api/regenerate

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add the three routes**

Insert after `/api/history`:

```js
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
```

- [ ] **Step 2: Smoke test**

```bash
node server.js
```

In another terminal:
```bash
curl -X POST -H "Content-Type: application/json" -d '{}' http://localhost:3000/api/skip
```

Expected: `{"error":"thread_id required"}` with HTTP 400.

```bash
curl -X POST -H "Content-Type: application/json" -d '{"thread_id":"missing"}' http://localhost:3000/api/skip
```

Expected: `{"error":"thread not found"}` with HTTP 404.

Stop server.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(server): approve/skip/regenerate routes"
```

---

## Task 19: server.js — cron scheduler + /api/poll + pollInProgress flag

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add the cycle function and cron schedule**

Insert before the `/api/status` route (so the function is hoisted in source order):

```js
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
```

Then schedule it. Insert just before `app.listen(...)`:

```js
const cronExpr = `*/${config.poll_interval_minutes} * * * *`;
cron.schedule(cronExpr, () => {
  runPollCycle().catch((err) => console.error('[cycle] unexpected error:', err));
});
console.log(`[server] cron scheduled: ${cronExpr}`);
```

- [ ] **Step 2: Smoke test**

```bash
node server.js
```

Expected logs:
```
[server] listening on http://localhost:3000
[server] cron scheduled: */30 * * * *
```

In another terminal (triggers a real Reddit poll — needs valid `.env`; if missing, expect snoowrap auth errors in the log):

```bash
curl -X POST http://localhost:3000/api/poll
```

If `.env` not yet populated: returns 200 with `{"threads_found":0,"drafts_created":0}` and the log shows snoowrap auth failures per sub. This is expected at this stage.

Stop server.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(server): cron scheduler + /api/poll + pollInProgress guard"
```

---

## Task 20: public/ — index.html + styles.css skeleton

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`

- [ ] **Step 1: Create public/index.html**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reddit Engagement Assistant</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header>
    <h1>Reddit Engagement Assistant</h1>
    <nav class="tabs">
      <button class="tab active" data-tab="queue">Queue</button>
      <button class="tab" data-tab="history">History</button>
      <button class="tab" data-tab="status">Status</button>
    </nav>
  </header>

  <main>
    <section id="tab-queue" class="tab-panel active">
      <div class="toolbar">
        <button id="refresh-queue">Refresh</button>
        <span id="queue-count" class="muted"></span>
      </div>
      <div id="queue-list"></div>
      <p id="queue-empty" class="empty hidden">No drafts ready. Try Status → Poll Now.</p>
    </section>

    <section id="tab-history" class="tab-panel">
      <table id="history-table">
        <thead>
          <tr><th>Date</th><th>Subreddit</th><th>Thread</th><th>Comment</th></tr>
        </thead>
        <tbody></tbody>
      </table>
      <p id="history-empty" class="empty hidden">No posted comments yet.</p>
    </section>

    <section id="tab-status" class="tab-panel">
      <div class="status-grid">
        <div class="stat"><label>Last poll</label><span id="stat-last"></span></div>
        <div class="stat"><label>Next poll</label><span id="stat-next"></span></div>
        <div class="stat"><label>Queue</label><span id="stat-queue"></span></div>
        <div class="stat"><label>Pending</label><span id="stat-pending"></span></div>
        <div class="stat"><label>Failed</label><span id="stat-failed"></span></div>
        <div class="stat"><label>Posted (total)</label><span id="stat-posted"></span></div>
        <div class="stat"><label>Scoring calls (24h)</label><span id="stat-scoring"></span></div>
        <div class="stat"><label>Drafting calls (24h)</label><span id="stat-drafting"></span></div>
        <div class="stat"><label>Est. cost (24h)</label><span id="stat-cost"></span></div>
      </div>
      <button id="poll-now">Poll Now</button>
      <p id="poll-result" class="muted"></p>
      <h3>Recent failures</h3>
      <ul id="failure-list" class="failures"></ul>
    </section>
  </main>

  <script src="app.js" defer></script>
</body>
</html>
```

- [ ] **Step 2: Create public/styles.css**

```css
:root {
  --bg: #f7f7f5;
  --fg: #1c1c1c;
  --muted: #666;
  --border: #d4d4d2;
  --card-bg: #ffffff;
  --primary: #2b6cb0;
  --primary-fg: #ffffff;
  --green: #22a06b;
  --yellow: #d97706;
  --gray: #888;
  --orange: #ea580c;
  --danger: #c0392b;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: var(--fg);
  background: var(--bg);
  font-size: 14px;
  line-height: 1.45;
}

header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--card-bg);
}
header h1 { margin: 0 0 12px 0; font-size: 18px; font-weight: 600; }

.tabs { display: flex; gap: 4px; }
.tab {
  background: transparent;
  border: 1px solid transparent;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 14px;
  color: var(--muted);
  border-radius: 6px;
}
.tab:hover { color: var(--fg); background: rgba(0,0,0,0.04); }
.tab.active { color: var(--fg); background: var(--bg); border-color: var(--border); }

main { max-width: 880px; margin: 24px auto; padding: 0 24px; }

.tab-panel { display: none; }
.tab-panel.active { display: block; }

.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.toolbar button { padding: 6px 12px; cursor: pointer; }
.muted { color: var(--muted); font-size: 13px; }
.empty { color: var(--muted); padding: 32px; text-align: center; }
.hidden { display: none; }

.card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  transition: opacity 0.3s ease;
}
.card.fading { opacity: 0; }
.card-header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 12px;
  background: #eee;
  color: var(--fg);
}
.badge.subreddit { background: #e6f0fb; color: #1d4e89; }
.badge.score-green  { background: var(--green);  color: white; }
.badge.score-yellow { background: var(--yellow); color: white; }
.badge.score-gray   { background: var(--gray);   color: white; }
.badge.warning      { background: var(--orange); color: white; }
.meta { color: var(--muted); font-size: 12px; }

.title { font-weight: 600; margin: 6px 0; }
.body-preview { color: #444; margin: 4px 0 8px 0; }
.thread-link {
  display: inline-block;
  color: var(--primary);
  text-decoration: none;
  margin-bottom: 12px;
  font-size: 13px;
}
.thread-link:hover { text-decoration: underline; }

.scoring-context {
  background: #fafaf8;
  border-left: 3px solid var(--border);
  padding: 8px 12px;
  margin: 12px 0;
  font-size: 13px;
}
.scoring-context label { font-weight: 600; color: var(--muted); display: block; font-size: 11px; text-transform: uppercase; }

.draft-textarea {
  width: 100%;
  min-height: 110px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: inherit;
  font-size: 14px;
  resize: vertical;
}
.char-count { font-size: 12px; color: var(--muted); margin-top: 4px; }

.actions { display: flex; gap: 8px; margin-top: 12px; }
.actions button { padding: 8px 14px; cursor: pointer; border-radius: 6px; border: 1px solid var(--border); background: white; }
.actions button.primary { background: var(--primary); color: var(--primary-fg); border-color: var(--primary); }
.actions button.primary:hover { background: #1e5283; }
.actions button:disabled { opacity: 0.5; cursor: wait; }

#history-table { width: 100%; border-collapse: collapse; }
#history-table th, #history-table td {
  text-align: left; padding: 8px; border-bottom: 1px solid var(--border); font-size: 13px;
}
#history-table th { color: var(--muted); font-weight: 600; }
#history-table .comment-cell { max-width: 400px; color: #333; }

.status-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
.stat {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
}
.stat label { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; margin-bottom: 4px; }
.stat span { font-size: 18px; font-weight: 600; }

#poll-now { padding: 8px 16px; cursor: pointer; }
#poll-result { margin-left: 12px; display: inline; }

.failures { padding: 0; list-style: none; }
.failures li { background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px; margin-bottom: 8px; font-size: 13px; }
.failures .err { color: var(--danger); font-family: monospace; font-size: 12px; }
```

- [ ] **Step 3: Smoke test**

```bash
node server.js
```

Open `http://localhost:3000` in a browser.

Expected: Page loads with three tabs at the top. Queue tab is active by default and shows "No drafts ready..." once `app.js` exists (currently the JS file doesn't exist so the page just shows skeleton). Switch tabs by clicking — won't work yet without app.js, but the page itself should render.

Stop server.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/styles.css
git commit -m "feat(ui): page skeleton and styles"
```

---

## Task 21: public/app.js — fetch + render queue cards

**Files:**
- Create: `public/app.js`

- [ ] **Step 1: Create the app.js with tab switching, queue load, and render**

```js
// ===== tab switching =====
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'queue') loadQueue();
    if (btn.dataset.tab === 'history') loadHistory();
    if (btn.dataset.tab === 'status') loadStatus();
  });
});

// ===== queue =====
async function loadQueue() {
  const list = document.getElementById('queue-list');
  const empty = document.getElementById('queue-empty');
  const count = document.getElementById('queue-count');
  list.innerHTML = '';
  let rows;
  try {
    const res = await fetch('/api/queue');
    rows = await res.json();
  } catch (err) {
    list.innerHTML = `<p class="empty">Error loading queue: ${escapeHtml(err.message)}</p>`;
    return;
  }
  count.textContent = rows.length === 0 ? '' : `${rows.length} draft${rows.length === 1 ? '' : 's'} ready`;
  if (rows.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  rows.forEach((row) => list.appendChild(renderCard(row)));
}

function renderCard(row) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.threadId = row.id;

  const scoreClass = row.relevance_score >= 9 ? 'score-green'
    : row.relevance_score >= 7 ? 'score-yellow'
    : 'score-gray';
  const highTrafficBadge = row.high_traffic_flag
    ? `<span class="badge warning">HIGH TRAFFIC — post only if exceptional</span>`
    : '';

  const ageStr = formatAge(row.age_hours);
  const bodyPreview = (row.body || '').slice(0, 200) + ((row.body || '').length > 200 ? '…' : '');

  card.innerHTML = `
    <div class="card-header">
      <span class="badge subreddit">r/${escapeHtml(row.subreddit)}</span>
      <span class="badge ${scoreClass}">score ${row.relevance_score}</span>
      ${highTrafficBadge}
      <span class="meta">${ageStr} • ${row.comment_count} comment${row.comment_count === 1 ? '' : 's'}</span>
    </div>
    <div class="title">${escapeHtml(row.title)}</div>
    <div class="body-preview">${escapeHtml(bodyPreview)}</div>
    <a class="thread-link" href="${escapeHtml(row.url)}" target="_blank" rel="noopener">Open Thread →</a>

    <div class="scoring-context">
      <label>Why it's relevant</label>
      <div>${escapeHtml(row.relevance_reason || '')}</div>
      <label style="margin-top:6px">Suggested angle</label>
      <div>${escapeHtml(row.suggested_angle || '—')}</div>
    </div>

    <textarea class="draft-textarea">${escapeHtml(row.draft_text || '')}</textarea>
    <div class="char-count">0 chars</div>

    <div class="actions">
      <button class="primary copy-open">Copy & Open Thread</button>
      <button class="regenerate">Regenerate</button>
      <button class="skip">Skip</button>
    </div>
  `;

  const textarea = card.querySelector('.draft-textarea');
  const charCount = card.querySelector('.char-count');
  function updateCount() { charCount.textContent = `${textarea.value.length} chars`; }
  textarea.addEventListener('input', updateCount);
  updateCount();

  // wiring for the buttons happens in Task 22
  attachCardActions(card, row);

  return card;
}

function formatAge(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m old`;
  if (hours < 24) return `${hours.toFixed(1)}h old`;
  return `${(hours / 24).toFixed(1)}d old`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Stub — implemented in Task 22
function attachCardActions(card, row) { /* filled in next task */ }

// Refresh button
document.getElementById('refresh-queue').addEventListener('click', loadQueue);

// Initial load
loadQueue();

// Stubs — implemented in Task 23
function loadHistory() {}
function loadStatus() {}
```

- [ ] **Step 2: Smoke test**

```bash
node server.js
```

Open `http://localhost:3000` in a browser.

Expected: Tabs are clickable. Queue shows "No drafts ready" empty state (since DB is empty). No JS errors in browser devtools console.

Stop server.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(ui): tab switching, queue fetch, card rendering"
```

---

## Task 22: public/app.js — Copy & Open / Mark as Posted / Regenerate / Skip

**Files:**
- Modify: `public/app.js` (replace the `attachCardActions` stub)

- [ ] **Step 1: Replace the stub with real action wiring**

Find the line `function attachCardActions(card, row) { /* filled in next task */ }` in `public/app.js` and replace the entire function with:

```js
function attachCardActions(card, row) {
  const textarea = card.querySelector('.draft-textarea');
  const copyBtn = card.querySelector('.copy-open');
  const regenBtn = card.querySelector('.regenerate');
  const skipBtn = card.querySelector('.skip');

  let copied = false;

  copyBtn.addEventListener('click', async () => {
    if (!copied) {
      // Single click handler — both clipboard write AND window.open before any await
      // (avoids popup blocker by keeping window.open synchronous to the click).
      const text = textarea.value;
      window.open(row.url, '_blank', 'noopener');
      try {
        await navigator.clipboard.writeText(text);
      } catch (err) {
        // Some browsers may block clipboard if window.open fired first; warn user.
        alert('Could not copy to clipboard: ' + err.message + '\nText is in the textarea — copy manually.');
        return;
      }
      copyBtn.textContent = 'Mark as Posted';
      copied = true;
    } else {
      // Mark as posted
      copyBtn.disabled = true;
      try {
        const res = await fetch('/api/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ thread_id: row.id, final_text: textarea.value })
        });
        if (!res.ok) throw new Error(`approve failed: ${res.status}`);
        fadeAndRemove(card);
      } catch (err) {
        alert(err.message);
        copyBtn.disabled = false;
      }
    }
  });

  regenBtn.addEventListener('click', async () => {
    regenBtn.disabled = true;
    const original = regenBtn.textContent;
    regenBtn.textContent = 'Generating…';
    try {
      const res = await fetch('/api/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: row.id })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'regenerate failed');
      }
      const data = await res.json();
      textarea.value = data.draft_text || '';
      textarea.dispatchEvent(new Event('input'));
      // Reset copied state since draft changed
      copied = false;
      copyBtn.textContent = 'Copy & Open Thread';
    } catch (err) {
      alert(err.message);
    } finally {
      regenBtn.disabled = false;
      regenBtn.textContent = original;
    }
  });

  skipBtn.addEventListener('click', async () => {
    if (!confirm('Skip this thread?')) return;
    skipBtn.disabled = true;
    try {
      const res = await fetch('/api/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: row.id })
      });
      if (!res.ok) throw new Error('skip failed');
      fadeAndRemove(card);
    } catch (err) {
      alert(err.message);
      skipBtn.disabled = false;
    }
  });
}

function fadeAndRemove(card) {
  card.classList.add('fading');
  setTimeout(() => {
    card.remove();
    const list = document.getElementById('queue-list');
    if (list.children.length === 0) {
      document.getElementById('queue-empty').classList.remove('hidden');
      document.getElementById('queue-count').textContent = '';
    }
  }, 300);
}
```

- [ ] **Step 2: Smoke test**

```bash
node server.js
```

Open `http://localhost:3000`. With no data, you can't fully test, but verify the page still loads cleanly with no JS console errors.

Stop server.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(ui): copy-and-open flow, regenerate, skip with fade"
```

---

## Task 23: public/app.js — history + status tabs

**Files:**
- Modify: `public/app.js` (replace `loadHistory` and `loadStatus` stubs)

- [ ] **Step 1: Replace the stubs**

Find the two stub functions at the bottom of `public/app.js`:

```js
function loadHistory() {}
function loadStatus() {}
```

Replace them with:

```js
async function loadHistory() {
  const tbody = document.querySelector('#history-table tbody');
  const empty = document.getElementById('history-empty');
  tbody.innerHTML = '';
  let rows;
  try {
    const res = await fetch('/api/history');
    rows = await res.json();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4">Error: ${escapeHtml(err.message)}</td></tr>`;
    return;
  }
  if (rows.length === 0) {
    empty.classList.remove('hidden');
    document.getElementById('history-table').classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  document.getElementById('history-table').classList.remove('hidden');
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    const date = new Date(r.posted_at).toLocaleString();
    tr.innerHTML = `
      <td>${escapeHtml(date)}</td>
      <td>r/${escapeHtml(r.subreddit)}</td>
      <td><a href="${escapeHtml(r.thread_url)}" target="_blank" rel="noopener">${escapeHtml(r.thread_title)}</a></td>
      <td class="comment-cell">${escapeHtml(r.final_text)}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadStatus() {
  let s;
  try {
    s = await (await fetch('/api/status')).json();
  } catch (err) {
    document.getElementById('poll-result').textContent = 'Error: ' + err.message;
    return;
  }
  document.getElementById('stat-last').textContent = s.last_poll_at ? new Date(s.last_poll_at).toLocaleString() : '—';
  document.getElementById('stat-next').textContent = s.next_poll_at ? new Date(s.next_poll_at).toLocaleString() : '—';
  document.getElementById('stat-queue').textContent = s.queue_count;
  document.getElementById('stat-pending').textContent = s.pending_count;
  document.getElementById('stat-failed').textContent = s.failed_count;
  document.getElementById('stat-posted').textContent = s.total_posted;
  document.getElementById('stat-scoring').textContent = s.last_24h.scoring_calls;
  document.getElementById('stat-drafting').textContent = s.last_24h.drafting_calls;
  document.getElementById('stat-cost').textContent = '$' + s.last_24h.estimated_cost_usd.toFixed(3);

  const fl = document.getElementById('failure-list');
  fl.innerHTML = '';
  if (s.recent_failures.length === 0) {
    fl.innerHTML = '<li class="muted">No failures.</li>';
  } else {
    s.recent_failures.forEach((f) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <strong>r/${escapeHtml(f.subreddit)}</strong> —
        <a href="${escapeHtml(f.url)}" target="_blank" rel="noopener">${escapeHtml(f.title)}</a>
        <span class="muted">(${f.attempts} attempts)</span>
        <div class="err">${escapeHtml(f.last_error || '')}</div>
      `;
      fl.appendChild(li);
    });
  }
}

document.getElementById('poll-now').addEventListener('click', async () => {
  const btn = document.getElementById('poll-now');
  const result = document.getElementById('poll-result');
  btn.disabled = true;
  result.textContent = 'Polling…';
  try {
    const r = await fetch('/api/poll', { method: 'POST' });
    const data = await r.json();
    if (data.skipped) {
      result.textContent = 'Skipped (cycle still running)';
    } else {
      result.textContent = `Done. ${data.threads_found ?? 0} threads inserted, ${data.drafts_created ?? 0} drafts created.`;
    }
    loadStatus();
  } catch (err) {
    result.textContent = 'Error: ' + err.message;
  } finally {
    btn.disabled = false;
  }
});
```

- [ ] **Step 2: Smoke test**

```bash
node server.js
```

Open the page. Click each tab — Queue, History, Status — and verify each renders without JS console errors. The Status tab shows the stat grid with all zeros and the "Poll Now" button.

Stop server.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(ui): history and status tabs, poll-now button"
```

---

## Task 24: README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

```markdown
# Reddit Engagement Assistant

Local-only personal tool. Polls target subreddits, scores threads with Claude Haiku, drafts comments with Claude Sonnet in the user's voice, lets the operator review/copy in a localhost web UI before manually posting.

**Never auto-posts. The human is always in the loop.**

## Setup

1. Install Node.js 20+ (https://nodejs.org).
2. Clone or copy this folder somewhere.
3. Open a terminal in the folder and run:
   ```
   npm install
   ```
4. Copy `.env.example` → `.env` and fill in:
   - **Reddit credentials.** Go to https://reddit.com/prefs/apps logged in as your target account.
     - Click "create another app"
     - Type: **script**
     - Name: `reddit-assistant`
     - Redirect URI: `http://localhost:3000`
     - Copy the **client ID** (under the app name) and **client secret** into `.env`.
     - Fill in `REDDIT_USERNAME` and `REDDIT_PASSWORD` for the same account.
   - **Anthropic API key** from https://console.anthropic.com → `ANTHROPIC_API_KEY`.
5. Edit `persona.md` carefully. It controls every Claude call. Read your way through the voice rules and tone guidance and tune them to your account.
6. Edit `config.json` if you want different subreddits, keywords, or thresholds. The defaults are a starting point.
7. Run:
   ```
   npm start
   ```
8. Open http://localhost:3000.
9. On the **Status** tab, click **Poll Now** for your first cycle. Cron will run every 30 minutes from then on (configurable in `config.json`).

## How It Works

```
poll → keyword tier+gate filter → score with Haiku 4.5 → draft with Sonnet 4.6 → review queue → you copy & post manually
```

- **Strong keywords** (specific terms like "mercury retrograde", "circle back", "roast my") always trigger scoring on a hit.
- **Weak keywords** (generic terms like "alignment", "stakeholder") only trigger scoring when (a) ≥2 weak matches in the same post, or (b) the post is fresh (`<2h`) and low-traffic (`<10 comments`).
- The persona doc is read fresh from disk on every Claude call — edit it any time and changes take effect on the next score/draft.
- Failed scoring or drafting attempts retry up to 3 times. After that the thread is marked `failed` and surfaces on the Status tab.

## Costs

The Status tab shows a 24-hour rolling estimate based on actual token usage. Pricing constants are hardcoded in `pricing.js` — update if Anthropic changes prices.

## Tests

```
npm test
```

Covers the gate logic, score penalty math, DB queries, and retry counter. Claude and Reddit calls are mocked.

## Files

- `server.js` — Express + cron scheduler
- `db.js` — SQLite schema and queries
- `reddit.js` — snoowrap polling
- `keywords.js` — tier matching and gate rule (pure)
- `scorer.js` — Haiku scoring
- `drafter.js` — Sonnet drafting
- `pricing.js` — model price constants
- `config.json` — public tunables
- `persona.md` — your voice
- `.env` — secrets (gitignored)
- `public/` — HTML/CSS/JS frontend
- `data/assistant.db` — SQLite (auto-created, gitignored)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with setup, architecture, and ops notes"
```

---

## Task 25: End-to-end manual smoke test

**Files:** none (verification only)

This is the final acceptance check. Requires real Reddit and Anthropic credentials in `.env`.

- [ ] **Step 1: Confirm full test suite still passes**

```bash
npm test
```

Expected: All tests across all files pass.

- [ ] **Step 2: Set up `.env` with real credentials**

Confirm `.env` exists at project root and has all six values filled in. Do NOT commit it (the `.gitignore` already excludes it, but double-check).

- [ ] **Step 3: Start the server and run a real poll**

```bash
node server.js
```

In a browser, open `http://localhost:3000` → **Status** tab → click **Poll Now**.

Expected behavior:
- The "Polling…" indicator shows.
- After ~30–120 seconds (varies with how many subs and matches), the result line updates with `threads_found` and `drafts_created` counts.
- The Status tab updates: `last_poll`, `pending`, `queue` counts move.
- The server logs show `[cycle] done in NNNms — fetched=X inserted=Y scored=Z drafted=W errors=N`.

- [ ] **Step 4: Verify the queue tab works**

Click **Queue**. Any drafts that were generated should appear as cards.

For one card:
- Click **Copy & Open Thread**. A new tab opens to the Reddit thread; the draft text is in your clipboard. Paste somewhere to confirm.
- The button changes to **Mark as Posted**.
- Click **Mark as Posted**. The card fades out. The Reddit thread itself is **not** modified by this app — you have to manually paste and submit on Reddit if you want the comment posted.
- Click **History** tab. The card appears as a row.

For another card, click **Regenerate** — the textarea content updates with a fresh draft.

For a third card, click **Skip** — confirm the dialog, the card fades.

- [ ] **Step 5: Verify failure handling (optional)**

Temporarily replace `ANTHROPIC_API_KEY` in `.env` with `invalid` and restart the server. Click **Poll Now**. After the cycle completes, the **Status** tab shows non-zero `Failed` and the **Recent failures** list shows entries with the API error.

Restore the real key, restart.

- [ ] **Step 6: Mark feature complete**

If all of the above worked, the system is operational. No commit needed for this verification task.

If anything failed, the artifact to inspect first is `data/assistant.db`:
```bash
sqlite3 data/assistant.db "SELECT id, status, attempts, last_error FROM threads ORDER BY fetched_at DESC LIMIT 20;"
```

---

## Self-Review Checklist (planner's own pass)

| Spec section                    | Coverage                                                                        |
|--------------------------------|---------------------------------------------------------------------------------|
| Tech stack (Node/Express/etc)  | Task 1 (deps + scripts)                                                         |
| Project layout                 | Tasks 1–2 + scattered file creates                                              |
| `.env` + `config.json` split   | Task 2 + Task 16 (loaded in server.js)                                          |
| Persona doc starter            | Task 2                                                                          |
| `threads` schema (with attempts/last_error) | Task 5                                                              |
| `drafts`, `posted` schemas      | Task 5 + Task 7 queries                                                         |
| `cycle_log` schema             | Task 5 + Task 7 queries                                                         |
| `api_call_log` (deviation)     | Task 5 + Task 7 queries                                                         |
| Status enum (no `skipped_high_traffic`) | Reflected in scorer.js logic (Task 11)                                  |
| `keywords.js` matchKeywords    | Task 3                                                                          |
| `keywords.js` passesGate (gate rule) | Task 4                                                                    |
| `reddit.js` pollAllSubs        | Task 9                                                                          |
| Reddit hard skips (age, hard limit) | Task 9 (tested)                                                            |
| 429 backoff (60s, 1 retry)     | Task 9 (in implementation, not separately tested — acceptable for v1)           |
| `scorer.js` Haiku call         | Task 11                                                                         |
| Penalty math (–2 / –1 / floor 1) | Task 10                                                                       |
| `high_traffic_flag` routing    | Task 11 (tested)                                                                |
| Scorer retry counter           | Tasks 11–12, 15                                                                 |
| `drafter.js` Sonnet call       | Task 14                                                                         |
| Top-3 comments fetch           | Task 13                                                                         |
| Drafter recency context (last 10 posted) | Task 14 (in implementation)                                           |
| Drafter retry, deletes prior draft | Task 14 (tested)                                                            |
| Prompt caching (deviation)     | Tasks 11, 14 (system block uses `cache_control`)                                |
| Cron scheduler                 | Task 19                                                                         |
| `pollInProgress` guard         | Task 19                                                                         |
| Cycle logging                  | Task 19                                                                         |
| All `/api/*` routes            | Tasks 16–19                                                                     |
| Frontend skeleton              | Task 20                                                                         |
| Frontend queue rendering       | Task 21                                                                         |
| Copy-and-open + mark-as-posted | Task 22                                                                         |
| Regenerate + skip + fade       | Task 22                                                                         |
| History + Status tabs          | Task 23                                                                         |
| README setup                   | Task 24                                                                         |
| End-to-end smoke               | Task 25                                                                         |

**Placeholders:** Searched the document for "TBD" / "TODO" / "fill in" / "similar to". None present.

**Type/method consistency:** Cross-checked method names — `getDraftReadyQueue`, `incrementAttempts(id, error, status)`, `updateThreadAfterScoring(id, fields)`, `logApiCall(row)`, `createScorer({ anthropic, ... })`, `createDrafter({ anthropic, snoowrap, ... })`, `createReddit({ snoowrap, db, config })` — names match across tasks.

**Scope:** Single feature, single deployable unit, ~1 day of work for a focused engineer. Appropriate for one plan.
