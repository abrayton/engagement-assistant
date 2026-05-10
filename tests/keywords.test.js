import { describe, it, expect } from 'vitest';
import { matchKeywords, passesGate } from '../keywords.js';

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
