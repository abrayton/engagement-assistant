export function matchKeywords(text, keywords) {
  const lower = (text || '').toLowerCase();
  const strong = keywords.strong.filter((kw) => lower.includes(kw.toLowerCase()));
  const weak = keywords.weak.filter((kw) => lower.includes(kw.toLowerCase()));
  return { strong, weak };
}

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
