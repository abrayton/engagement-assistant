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
   In PowerShell, use `npm.cmd install` if script execution policy blocks `npm`.
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
   PowerShell-safe alternatives: `npm.cmd start` or `node server.js`.
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

In PowerShell, use `npm.cmd test` if `npm test` is blocked by execution policy.

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
