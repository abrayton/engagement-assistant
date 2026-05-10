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
