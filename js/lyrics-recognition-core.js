export const LYRICS_SAMPLE_RATE = 16000;
export const LYRICS_MAX_DURATION = 8 * 60;

export function downmixAndResample(left, right = left, inputRate = 44100, outputRate = LYRICS_SAMPLE_RATE) {
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || !left.length || left.length !== right.length)
    throw Error('人聲音訊資料不完整。');
  if (!(inputRate > 0) || !(outputRate > 0)) throw Error('音訊取樣率無效。');

  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.floor(left.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const from = Math.floor(index * ratio);
    const to = Math.max(from + 1, Math.min(left.length, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let source = from; source < to; source++) sum += (left[source] + right[source]) * .5;
    output[index] = sum / (to - from);
  }
  return output;
}

export function recognitionChunks(audio, sampleRate = LYRICS_SAMPLE_RATE, seconds = 30, overlapSeconds = 1) {
  if (!(audio instanceof Float32Array) || !audio.length) return [];
  const size = Math.max(1, Math.round(seconds * sampleRate));
  const overlap = Math.max(0, Math.min(size - 1, Math.round(overlapSeconds * sampleRate)));
  const step = size - overlap;
  const chunks = [];
  for (let from = 0; from < audio.length; from += step) {
    const to = Math.min(audio.length, from + size);
    chunks.push({ start: from / sampleRate, end: to / sampleRate, audio: audio.slice(from, to) });
    if (to === audio.length) break;
  }
  return chunks;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function appendWhisperCues(existing, result, offset, chunkEnd) {
  const output = existing.map(cue => ({ ...cue }));
  const parts = Array.isArray(result?.chunks) && result.chunks.length
    ? result.chunks
    : [{ text: result?.text, timestamp: [0, Math.max(.1, chunkEnd - offset)] }];

  for (const part of parts) {
    const text = cleanText(part?.text);
    if (!text) continue;
    const relativeStart = Number(part?.timestamp?.[0]);
    const relativeEnd = Number(part?.timestamp?.[1]);
    let start = offset + (Number.isFinite(relativeStart) ? Math.max(0, relativeStart) : 0);
    let end = offset + (Number.isFinite(relativeEnd) ? Math.max(0, relativeEnd) : Math.max(.1, chunkEnd - offset));
    start = Math.min(chunkEnd, start);
    end = Math.min(chunkEnd, Math.max(start + .1, end));

    const previous = output.at(-1);
    if (previous && previous.text === text && start <= previous.end + 1.1) {
      previous.end = Math.max(previous.end, end);
      continue;
    }
    if (previous && end <= previous.end + .08) continue;
    if (previous && start < previous.end) start = previous.end;
    if (end <= start + .05) continue;
    output.push({ start, end, text });
  }
  return output;
}

