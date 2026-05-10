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
