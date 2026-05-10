export function applyPenalty(rawScore, ageHours, commentCount, config) {
  let score = rawScore;
  if (commentCount > config.soft_comment_limit) score -= 2;
  if (ageHours > 6) score -= 1;
  return Math.max(1, score);
}

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
