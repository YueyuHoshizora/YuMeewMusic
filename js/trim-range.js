export function moveTrimRange(start, end, delta, duration, mode) {
  const minimum = Math.min(.01, duration);
  if (mode === 'start') return [Math.max(0, Math.min(end - minimum, start + delta)), end];
  if (mode === 'end') return [start, Math.min(duration, Math.max(start + minimum, end + delta))];
  const shift = Math.max(-start, Math.min(duration - end, delta));
  return [start + shift, end + shift];
}
