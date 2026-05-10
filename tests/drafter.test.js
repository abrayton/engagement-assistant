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
