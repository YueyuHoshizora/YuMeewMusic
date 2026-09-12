export const TRANSCRIPTION_CHUNK_SECONDS = 25;
export const TRANSCRIPTION_OVERLAP_SECONDS = 2;

export function encodePcm16Wav(channelData, sampleRate) {
  const buffer = new ArrayBuffer(44 + channelData.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + channelData.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, channelData.length * 2, true);
  let offset = 44;
  for (let i = 0; i < channelData.length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function createTranscriptionChunks(samples, sampleRate) {
  const chunkSamples = Math.floor((TRANSCRIPTION_CHUNK_SECONDS + TRANSCRIPTION_OVERLAP_SECONDS) * sampleRate);
  const stepSamples = Math.floor(TRANSCRIPTION_CHUNK_SECONDS * sampleRate);
  const chunks = [];
  let index = 0;
  for (let start = 0; start < samples.length; start += stepSamples) {
    const end = Math.min(start + chunkSamples, samples.length);
    chunks.push({
      blob: encodePcm16Wav(samples.slice(start, end), sampleRate),
      offset: start / sampleRate,
      index,
    });
    index += 1;
  }
  return chunks;
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?；;：:"'「」『』（）()]/g, '')
    .toLowerCase();
}

function similarity(a, b) {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return Math.min(x.length, y.length) / Math.max(x.length, y.length);
  return 0;
}

export function dedupeTranscriptionOverlap(cues) {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const result = [];
  for (const cue of sorted) {
    let duplicate = false;
    for (let i = Math.max(0, result.length - 5); i < result.length; i++) {
      const previous = result[i];
      if (Math.abs(previous.start - cue.start) > TRANSCRIPTION_OVERLAP_SECONDS + 1) continue;
      if (similarity(previous.text, cue.text) >= .75) {
        duplicate = true;
        if (cue.text.length > previous.text.length) result[i] = cue;
        break;
      }
    }
    if (!duplicate) result.push(cue);
  }
  return result;
}

function joinText(left, right) {
  const a = left.trim();
  const b = right.trim();
  if (!a) return b;
  if (!b) return a;
  return /[\u3400-\u9fff\u3040-\u30ff]/.test(a) || /[\u3400-\u9fff\u3040-\u30ff]/.test(b) ? a + b : `${a} ${b}`;
}

export function mergeTranscriptionCues(cues) {
  if (!cues.length) return [];
  const result = [];
  let current = { ...cues[0] };
  for (let i = 1; i < cues.length; i++) {
    const next = cues[i];
    const text = joinText(current.text, next.text);
    if (next.start - current.end > 1.1 || next.end - current.start > 9 || text.replace(/\s+/g, '').length > 18) {
      result.push(current);
      current = { ...next };
    } else {
      current = { start: current.start, end: next.end, text };
    }
  }
  result.push(current);
  return result;
}

function timestamp(seconds) {
  const total = Math.max(0, Math.round(seconds * 1000));
  const ms = total % 1000;
  const totalSeconds = Math.floor(total / 1000);
  const second = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minute = totalMinutes % 60;
  const hour = Math.floor(totalMinutes / 60);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function transcriptionCuesToSrt(cues) {
  return cues.map((cue, index) => `${index + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}`).join('\n\n');
}

async function sendChunk(workerUrl, chunk, language, signal) {
  const form = new FormData();
  form.append('audio', chunk.blob, `chunk-${chunk.index}.wav`);
  form.append('language', language);
  form.append('offset', String(chunk.offset));
  form.append('chunkIndex', String(chunk.index));
  const response = await fetch(workerUrl, { method: 'POST', body: form, signal });
  const text = await response.text();
  if (!response.ok) throw Error(text.trim().slice(0, 300) || `字幕辨識服務回應錯誤（HTTP ${response.status}）。`);
  let result;
  try { result = JSON.parse(text); }
  catch { throw Error('字幕辨識服務回傳了無法解析的資料。'); }
  if (!result?.success) throw Error(result?.text || '字幕辨識服務未能完成這個片段。');
  if (!Array.isArray(result.cues)) throw Error('字幕辨識服務沒有回傳有效的字幕片段。');
  return result.cues.map(cue => ({ start: Number(cue.start), end: Number(cue.end), text: String(cue.text || '') }))
    .filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && cue.text.trim());
}

export async function transcribeSong(samples, sampleRate, workerUrl, language = 'zh', onProgress, signal) {
  const chunks = createTranscriptionChunks(samples, sampleRate);
  const allCues = [];
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) throw new DOMException('辨識已取消。', 'AbortError');
    onProgress?.(i + 1, chunks.length);
    allCues.push(...await sendChunk(workerUrl, chunks[i], language, signal));
  }
  return transcriptionCuesToSrt(mergeTranscriptionCues(dedupeTranscriptionOverlap(allCues)));
}
