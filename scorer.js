export function applyPenalty(rawScore, ageHours, commentCount, config) {
  let score = rawScore;
  if (commentCount > config.soft_comment_limit) score -= 2;
  if (ageHours > 6) score -= 1;
  return Math.max(1, score);
}
