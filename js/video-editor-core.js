export function finiteTime(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

export function layerEnd(layer) {
  if (layer.type === "image") return finiteTime(layer.start) + Math.max(0.1, finiteTime(layer.duration, 5));
  return Math.max(finiteTime(layer.start), finiteTime(layer.end));
}

export function projectDuration(layers, baseDuration = 0) {
  return Math.max(1, finiteTime(baseDuration), ...layers.map(layerEnd));
}

export function projectTrimRange(duration, start = 0, end = null) {
  const fullDuration = Math.max(.01, finiteTime(duration, 1));
  const safeStart = Math.min(finiteTime(start), Math.max(0, fullDuration - .01));
  const safeEnd = end === null
    ? fullDuration
    : Math.min(fullDuration, Math.max(safeStart + .01, finiteTime(end, fullDuration)));
  return { start: safeStart, end: safeEnd, duration: safeEnd - safeStart };
}

export function isLayerActive(layer, time) {
  const start = finiteTime(layer.start);
  return time >= start && time < layerEnd(layer);
}

export function clampLayerTiming(layer, patch) {
  const next = { ...layer, ...patch };
  next.start = finiteTime(next.start);
  if (next.type === "image") {
    next.duration = Math.max(0.1, finiteTime(next.duration, 5));
  } else {
    next.end = Math.max(next.start + 0.1, finiteTime(next.end, next.start + 0.1));
  }
  return next;
}

export function nudgeLayerTime(layer, field, delta) {
  const amount = Number(delta) || 0;
  if (field === "start") {
    const start = Math.max(0, Math.round((finiteTime(layer.start) + amount) * 10) / 10);
    const shift = start - finiteTime(layer.start);
    const patch = { start };
    if (layer.type === "video") patch.end = Math.round((finiteTime(layer.end) + shift) * 10) / 10;
    return clampLayerTiming(layer, patch);
  }
  if (field === "end" && layer.type === "video") {
    return clampLayerTiming(layer, { end: Math.round((finiteTime(layer.end) + amount) * 10) / 10 });
  }
  return layer;
}

export function coverRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}

export function formatEditorTime(seconds) {
  const safe = finiteTime(seconds);
  const minutes = Math.floor(safe / 60);
  const rest = (safe % 60).toFixed(1).padStart(4, "0");
  return `${String(minutes).padStart(2, "0")}:${rest}`;
}
