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
