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
