export const RATING_METRICS = Object.freeze([
  { key: "coherence", label: "結構連貫", description: "段落與和聲發展是否一致", weight: 0.20 },
  { key: "musicality", label: "音樂性", description: "整體聽感與音樂表現", weight: 0.25 },
  { key: "memorability", label: "記憶點", description: "旋律與作品是否容易留下印象", weight: 0.25 },
  { key: "clarity", label: "混音清晰", description: "聲部、頻率與製作品質", weight: 0.15 },
  { key: "naturalness", label: "自然度", description: "聲音是否自然且少有生成瑕疵", weight: 0.15 },
]);

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

export function scoreToPercent(score) {
  return clamp((Number(score) - 1) / 4 * 100, 0, 100);
}

export function presentRating(raw) {
  const metrics = RATING_METRICS.map(metric => ({ ...metric, raw: clamp(raw?.[metric.key], 1, 5), score: scoreToPercent(raw?.[metric.key]) }));
  const overall = metrics.reduce((sum, metric) => sum + metric.score * metric.weight, 0);
  return {
    overall,
    metrics,
    streams: clamp(raw?.streams, 0, 100),
    likes: clamp(raw?.likes, 0, 100),
  };
}

export function ratingVerdict(score) {
  if (score >= 85) return "表現非常突出";
  if (score >= 70) return "作品完成度良好";
  if (score >= 55) return "具備清楚的音樂方向";
  if (score >= 40) return "仍有明顯改善空間";
  return "建議重新檢查作品結構與製作";
}
