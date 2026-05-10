export function matchKeywords(text, keywords) {
  const lower = (text || '').toLowerCase();
  const strong = keywords.strong.filter((kw) => lower.includes(kw.toLowerCase()));
  const weak = keywords.weak.filter((kw) => lower.includes(kw.toLowerCase()));
  return { strong, weak };
}
