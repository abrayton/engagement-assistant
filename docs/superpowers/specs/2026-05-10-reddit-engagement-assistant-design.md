# Reddit Engagement Assistant — Design Spec

**Date:** 2026-05-10
**Status:** Approved, ready for implementation planning

## Purpose

A locally-run personal tool that monitors target subreddits for relevant threads, scores them for engagement opportunity, drafts comments in the user's voice using Claude, and lets the user review/approve before they manually post. Runs in a browser on localhost. No cloud hosting, no database server, no multi-user complexity.

The tool never auto-posts. The human is always in the loop between draft generation and Reddit submission.

## Non-Goals (Intentional)

- No auto-posting to Reddit under any circumstances
- No scheduling posts
- No cross-posting same draft to multiple subs
- No email notifications
- No mobile UI

---

## Tech Stack

- **Backend:** Node.js 20+ with Express
- **Frontend:** Plain HTML + vanilla JS + a small `styles.css`, served by Express (no build step)
- **Database:** SQLite via `better-sqlite3`
- **Reddit API:** `snoowrap`
- **AI:** `@anthropic-ai/sdk`
  - **Scoring:** `claude-haiku-4-5-20251001` (cheap, high-volume — most threads get rejected here)
  - **Drafting:** `claude-sonnet-4-6` (voice fidelity matters; only fires for threads that survived scoring)
- **Scheduler:** `node-cron`
- **Tests:** Vitest
- **Secrets:** `.env` via `dotenv`
- **Runs natively on Windows.** No Docker, no WSL. Started with `node server.js`.

---

## Project Layout

```
reddit-assistant/
├── server.js              # Express app + cron scheduler
├── db.js                  # SQLite setup + named query exports
├── reddit.js              # snoowrap client + pollAllSubs()
├── scorer.js              # scoreThread(id) — Haiku call + post-score penalty
├── drafter.js             # draftComment(id) — top-comment fetch + Sonnet call
├── keywords.js            # Pure: matchKeywords() + passesGate() (testable)
├── persona.md             # Voice/context doc, edited by user, never cached
├── config.json            # Public tunables (subs, keywords, thresholds) — committed
├── .env                   # Reddit + Anthropic creds (gitignored)
├── .env.example           # Template, committed
├── .gitignore             # data/, .env, node_modules/
├── public/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── data/
│   └── assistant.db       # auto-created on first run
├── tests/
│   ├── keywords.test.js
│   ├── scorer.test.js
│   ├── db.test.js
│   └── retries.test.js
├── package.json
└── README.md
```

---

## Module Boundaries

| Module       | Owns                                                         | Depends on                                          |
|--------------|--------------------------------------------------------------|-----------------------------------------------------|
| `db.js`      | Schema migration, all SQL queries (named export per query)   | `better-sqlite3`                                    |
| `reddit.js`  | snoowrap client, `pollAllSubs()`, calls into `keywords.js`   | `db.js`, `snoowrap`, `keywords.js`                  |
| `keywords.js`| Pure: `matchKeywords(text)` + `passesGate(matches, age, comments)` | none — fully testable in isolation             |
| `scorer.js`  | `scoreThread(threadId)` — Haiku call + post-Claude penalty   | `db.js`, `@anthropic-ai/sdk`, fs (persona.md)       |
| `drafter.js` | `draftComment(threadId)` — top-3 comment fetch + Sonnet call | `db.js`, `reddit.js` (snoowrap client), `@anthropic-ai/sdk`, fs |
| `server.js`  | Express routes, cron scheduler, orchestration, `pollInProgress` flag | all of the above                            |

**Why `keywords.js` is its own module:** the gate rule is the most likely thing to need tuning. Keeping it pure (no network, no DB) makes it trivial to unit-test and reason about.

---

## Configuration

### `.env` (gitignored — secrets only)

```
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_USERNAME=nearby-doughnuts
REDDIT_PASSWORD=...
REDDIT_USER_AGENT=reddit-assistant/1.0 by nearby-doughnuts
ANTHROPIC_API_KEY=...
```

### `.env.example` (committed)

Same keys, all values empty or placeholder. Setup doc tells the user to copy and fill in.

### `config.json` (committed — safe to share)

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
  "port": 3000
}
```

---

## Persona Doc (`persona.md`)

User-edited file at project root. Read fresh from disk on every Claude API call (no caching) so edits take effect immediately. Starter content:

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

---

## Database Schema (`db.js`)

Tables created on startup if missing.

### `threads`

```sql
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
  matched_strong TEXT,           -- JSON array of matched strong keywords
  matched_weak TEXT,             -- JSON array of matched weak keywords
  relevance_score INTEGER,
  raw_relevance_score INTEGER,
  relevance_reason TEXT,
  suggested_angle TEXT,
  high_traffic_flag INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  status TEXT DEFAULT 'pending'
);
```

**Status values:** `pending` | `scored` | `draft_ready` | `approved` | `skipped` | `skipped_low_score` | `failed`

(High-traffic threads are not a separate status — they pass through with `high_traffic_flag = 1` and surface in the queue with a warning badge.)

### `drafts`

```sql
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT,
  draft_text TEXT,
  created_at INTEGER,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);
```

### `posted`

```sql
CREATE TABLE IF NOT EXISTS posted (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT,
  subreddit TEXT,
  thread_title TEXT,
  thread_url TEXT,
  final_text TEXT,
  posted_at INTEGER
);
```

### `cycle_log` (telemetry for Status tab)

```sql
CREATE TABLE IF NOT EXISTS cycle_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER,
  finished_at INTEGER,
  threads_fetched INTEGER,
  threads_inserted INTEGER,
  scoring_calls INTEGER,
  drafting_calls INTEGER,
  errors INTEGER
);
```

---

## `keywords.js` — Tiering and Gate Rule

Pure functions. No I/O. Fully unit-tested.

### `matchKeywords(text: string, keywordsConfig)`

Returns:
```js
{
  strong: ['mercury retrograde', 'roast my'],
  weak:   ['alignment']
}
```

Case-insensitive substring match against title + selftext (concatenated). Returns the actual matched keyword strings (useful for debugging and for the Status tab).

### `passesGate(matches, ageHours, commentCount, config)`

Returns `true` if the thread should proceed to scoring, `false` if it should be dropped before any Claude call.

Rules:
1. If `matches.strong.length > 0` → **pass**.
2. If `matches.strong.length === 0` AND `matches.weak.length === 0` → **drop** (defensive; shouldn't happen if caller already pre-filtered).
3. Weak-only path. Pass if either:
   - **(a) Co-occurrence:** `matches.weak.length >= 2` (multiple weak signals in same post), OR
   - **(b) Fresh + low-traffic:** `ageHours < config.weak_gate_fresh_age_hours` AND `commentCount < config.weak_gate_fresh_comment_count`.
4. Otherwise → **drop**.

Threads dropped here never enter the database.

---

## `reddit.js` — Polling

`pollAllSubs()`:

1. For each subreddit in `config.subreddits`:
   1. `client.getSubreddit(name).getNew({ limit: 25 })`.
   2. For each post:
      1. Skip if `db.threadExists(post.id)`.
      2. Compute `ageHours = (now - post.created_utc * 1000) / 3_600_000`.
      3. **Hard skip:** `ageHours > config.max_thread_age_hours` — do not insert, do not call `keywords.js`.
      4. **Hard skip:** `post.num_comments > config.hard_comment_limit` — do not insert.
      5. `matches = keywords.matchKeywords(post.title + ' ' + (post.selftext || ''), config.keywords)`.
      6. If `matches.strong.length === 0 && matches.weak.length === 0` → skip.
      7. If `!keywords.passesGate(matches, ageHours, post.num_comments, config)` → skip.
      8. `db.insertThread({ ...row, status: 'pending', attempts: 0, matched_strong: JSON.stringify(matches.strong), matched_weak: JSON.stringify(matches.weak) })`.
2. Reddit rate limit handling: if snoowrap throws a 429, sleep 60 seconds and retry that subreddit once. If it fails again, log and move to next sub.

Returns `{ threadsFetched, threadsInserted }` for cycle logging.

---

## `scorer.js` — Relevance Scoring (Haiku 4.5)

`scoreThread(threadId)`:

1. Read thread row from DB.
2. Read `persona.md` from disk (fresh every call).
3. Call Anthropic API with `model = config.models.scorer` (Haiku 4.5).

### System prompt

```
You are evaluating Reddit threads for engagement opportunities for a specific person.
Read their persona doc carefully before scoring. Your job is to find threads where
a genuine, natural comment from this person would fit — not to find promotional opportunities.

[FULL CONTENTS OF persona.md]
```

### User prompt

```
Score this Reddit thread for engagement opportunity on a scale of 1-10.

10 = perfect fit, completely natural place to comment in this voice, high chance of upvotes
7-9 = good fit, clear angle exists, low risk
4-6 = marginal, could work but feels forced
1-3 = no fit, wrong vibe, or risky

Consider:
- Does this thread match the subreddit tone rules in the persona?
- Is there a natural comment this person could make WITHOUT mentioning their projects?
- Would a comment here build the right profile for this account?
- Thread age: {age_hours} hours old
- Comment count: {comment_count} comments

Threads under 2 hours old with under 20 comments are higher opportunity — weight this positively.

Respond in JSON only, no other text:
{
  "score": 7,
  "reason": "one sentence explanation of why this is or isn't a fit",
  "suggested_angle": "brief note on what kind of comment would land here, or null if low score"
}

Thread:
Subreddit: r/{subreddit}
Title: {title}
Body: {first 500 characters of selftext, or "[link post]" if none}
Post score: {upvotes}
Comment count: {num_comments}
Age: {age_hours} hours
```

### Post-Claude penalty math

- `raw_relevance_score = response.score` (stored).
- `relevance_score = raw_relevance_score`.
- If `comment_count > config.soft_comment_limit` → `relevance_score -= 2`.
- If `age_hours > 6` → `relevance_score -= 1`.
- Floor at `1`.

### Status routing

- If `raw_relevance_score >= 9` AND `relevance_score < min_relevance_score`: set `high_traffic_flag = 1`, status → `scored`, fall through to drafter.
- Else if `relevance_score >= min_relevance_score`: status → `scored`, fall through to drafter.
- Else: status → `skipped_low_score`. Done.

### Failure handling

`try/catch` around the API call. On failure: increment `attempts`, store `last_error`, leave status as `pending`. If `attempts >= config.max_retry_attempts`: status → `failed`.

---

## `drafter.js` — Comment Drafting (Sonnet 4.6)

`draftComment(threadId)`:

1. Read thread row.
2. Read `persona.md` fresh.
3. Read last 10 rows of `posted` fresh.
4. Fetch top 3 top-level comments from Reddit via snoowrap (one extra API call per scored thread). On failure, proceed with `"none yet"`.
5. Call Anthropic API with `model = config.models.drafter` (Sonnet 4.6).

### System prompt

```
You are writing a Reddit comment on behalf of a specific person.
Read their persona doc carefully. Write exactly as they would write.
Output only the comment text itself — no preamble, no explanation, no quotes around it.

[FULL CONTENTS OF persona.md]
```

### User prompt

```
Write one comment for the Reddit thread below.

Follow all voice rules from the persona strictly.
Do not mention their projects unless the suggested_angle explicitly calls for it.
Match the tone for this specific subreddit as described in the persona.

Recent posted comments for consistency (do not repeat these phrasings or angles):
{last 10 rows from posted, formatted as: "r/{subreddit} ({posted_at date}): {final_text}"
 If empty, write: "No comment history yet."}

Scoring context:
- Why this thread is relevant: {relevance_reason}
- Suggested angle: {suggested_angle}

Thread:
Subreddit: r/{subreddit}
Title: {title}
Body: {first 500 characters}
Top comments so far: {first 3 top-level comments, 150 chars each, or "none yet"}
Age: {age_hours} hours old
Comment count: {comment_count}
```

6. Insert into `drafts` table. Update thread status → `draft_ready`.

### Failure handling

Same as scorer: increment `attempts`, store `last_error`, leave status as `scored` (will retry next cycle). At `attempts >= 3`: status → `failed`.

---

## Cycle Orchestration (`server.js`)

- `pollInProgress` flag (in-memory boolean) prevents overlapping cycles. Cron tick checks the flag; if true, log "skipped: previous cycle still running".
- All Claude calls within a cycle run **serially** (simpler, no rate-limit dance, no race conditions on the DB).
- Cycle steps (batch model — score everything, then draft everything):
  1. `reddit.pollAllSubs()` — fetch new threads from each sub in sequence, insert any that pass the gate as `pending`.
  2. Query `WHERE status='pending' AND attempts < max_retry_attempts` (this set includes both newly-inserted threads and any pending-state retries from earlier cycles). For each, run `scorer.scoreThread(id)`.
  3. Query `WHERE status='scored' AND attempts < max_retry_attempts` (similar set: newly-scored threads plus drafter-retries from earlier cycles where the scorer succeeded but the drafter failed). For each, run `drafter.draftComment(id)`.
  4. Write one row to `cycle_log` with timing and counts.
- The retry counter (`attempts`) is incremented on every Claude failure regardless of stage. Once it hits `max_retry_attempts`, the thread is marked `failed` from whatever status it was in. This means a thread that fails 2× in scoring then 1× in drafting still ends up `failed`, not given an extra grace draft attempt — intentional: persistent failures usually indicate a malformed thread, not a stage-specific bug.

---

## API Routes (`server.js`)

| Method | Path                | Body / Returns                                                                                          |
|--------|---------------------|--------------------------------------------------------------------------------------------------------|
| GET    | `/api/queue`        | All `draft_ready` threads joined with their latest draft, sorted by `relevance_score DESC`.            |
| GET    | `/api/history`      | Last 50 rows of `posted`, newest first.                                                                |
| POST   | `/api/approve`      | Body: `{ thread_id, final_text }`. Insert into `posted`, set thread status → `approved`.               |
| POST   | `/api/skip`         | Body: `{ thread_id }`. Set thread status → `skipped`.                                                  |
| POST   | `/api/regenerate`   | Body: `{ thread_id }`. Delete existing draft, re-run `drafter.draftComment(id)`, return new draft.     |
| POST   | `/api/poll`         | Manually trigger a full poll cycle. Returns `{ threads_found, drafts_created }`.                       |
| GET    | `/api/status`       | Returns `{ last_poll_at, next_poll_at, queue_count, total_posted, pending_count, failed_count, last_24h_calls: { scoring, drafting }, recent_failures: [{ thread_id, last_error, subreddit, title }] }`. |

---

## Frontend (`public/`)

Single page. Three tabs: **Queue** (default) | **History** | **Status**.

### Queue Tab

`draft_ready` threads as cards, sorted by `relevance_score DESC`.

**Header row:**
- Subreddit badge (e.g. `r/ProgrammerHumor`)
- Relevance score badge — color coded:
  - green: 9–10
  - yellow: 7–8
  - gray: < 7 (only shown when `high_traffic_flag = 1`)
- If `high_traffic_flag = 1`: orange warning badge "HIGH TRAFFIC — post only if draft is exceptional"
- Thread age (e.g. "2h old")
- Comment count (e.g. "14 comments")

**Thread info:**
- Thread title (bold)
- First 200 characters of body (truncated with ellipsis)
- Prominent "Open Thread →" link, opens Reddit URL in new tab

**Scoring context:**
- `relevance_reason` (one sentence)
- `suggested_angle` (one line)

**Draft section:**
- Editable textarea pre-filled with draft text
- Character count below textarea

**Actions (3 buttons in a row):**
- **"Copy & Open Thread"** — primary, prominent. Single click handler: copy textarea content to clipboard AND `window.open(url)` simultaneously (avoids popup blocker). Button then morphs into "Mark as Posted".
- **"Regenerate"** — calls `/api/regenerate`, replaces textarea with new draft, shows loading spinner.
- **"Skip"** — calls `/api/skip`, fades card out.

**Post-copy flow:**
- User goes to Reddit tab, pastes, submits the comment manually.
- User comes back to localhost, clicks "Mark as Posted".
- `/api/approve` is called with current textarea content as `final_text`.
- Card fades out, moves to History.

### History Tab

Simple table: Date | Subreddit | Thread Title (links to thread URL) | Comment Posted

### Status Tab

- Last poll timestamp + next scheduled poll
- Queue count, total posted count, failed count
- Last 24h scoring/drafting call counts + estimated cost (Haiku + Sonnet pricing constants hardcoded; user updates if pricing changes)
- "Poll Now" button → `/api/poll`, shows result inline
- Expandable "Recent failures" list: thread title, subreddit, `last_error`, link to Reddit thread

---

## Test Scope (Vitest)

| File                      | What it covers                                                                       |
|---------------------------|--------------------------------------------------------------------------------------|
| `tests/keywords.test.js`  | `matchKeywords()` cases; `passesGate()` for strong-only, weak-only, weak+weak, weak+fresh, weak+stale-and-noisy, all-empty. |
| `tests/scorer.test.js`    | Penalty math: assert `relevance_score` after age/traffic combos. `high_traffic_flag` set correctly. Mock the Anthropic SDK. |
| `tests/db.test.js`        | Insert/update/query smoke tests against an in-memory SQLite. Schema migration is idempotent. |
| `tests/retries.test.js`   | Mock Anthropic to throw 3 times. Assert thread status progresses `pending → pending → pending → failed` and `attempts = 3`, `last_error` set. |

**Not tested:** real Claude calls, real Reddit calls, frontend (manual smoke).

---

## Implementation Constraints (must hold)

- `persona.md` is read from disk on **every** Claude API call. Never cached. This is what makes user edits take effect immediately.
- Last 10 `posted` rows are queried fresh on **every** drafter call, same reason.
- "Copy & Open Thread" button must do both clipboard write and `window.open()` in the **same synchronous click handler** to avoid popup blockers.
- All Claude calls wrapped in `try/catch`. Failures increment `attempts`, store `last_error`, leave status appropriate for retry. At 3 attempts → `failed`.
- All Reddit API calls wrapped similarly. Reddit 429 → sleep 60s and retry once; second failure logs and moves on.
- `data/` directory auto-created on first run if missing.
- `pollInProgress` flag prevents overlapping cycles.
- snoowrap is initialized once at startup with all four credentials (`client_id`, `client_secret`, `username`, `password`) — script-type OAuth.

---

## Setup (README content)

```
1. Install Node.js 20+ for Windows from nodejs.org
2. Clone or copy project files into a folder
3. Open terminal in the folder
4. Run: npm install
5. Reddit credentials:
   - Go to https://reddit.com/prefs/apps while logged in as nearby-doughnuts
   - Click "create another app"
   - Type: script
   - Name: reddit-assistant
   - Redirect URI: http://localhost:3000
   - Copy the client ID (under the app name) and client secret
6. Copy .env.example → .env and fill in:
   - All REDDIT_* values
   - ANTHROPIC_API_KEY
7. Edit persona.md — read it carefully, it controls everything
8. Run: node server.js
9. Open http://localhost:3000
10. Click "Poll Now" on the Status tab to run your first poll
```

---

## Open Items (none blocking)

- Cost-pricing constants in Status tab will need an update if Anthropic changes Haiku/Sonnet prices. Hardcoded for now; user can edit.
- If keyword tiering needs further refinement after first week of usage, the weak list is the first place to tune.
