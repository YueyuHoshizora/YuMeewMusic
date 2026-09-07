export function formatTrimTime(seconds) {
  const ticks = Math.round(Math.max(0, seconds) * 100);
  return `${String(Math.floor(ticks / 6000)).padStart(2, '0')}:${String(Math.floor(ticks / 100) % 60).padStart(2, '0')}.${String(ticks % 100).padStart(2, '0')}`;
}
export function parseTrimTime(text) {
  const match = /^(\d+):([0-5]\d)(?:\.(\d{1,2}))?$/.exec(text.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || '0'}`) : NaN;
}
