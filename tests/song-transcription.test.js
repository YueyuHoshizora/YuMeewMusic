import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSCRIPTION_CHUNK_SECONDS,
  TRANSCRIPTION_OVERLAP_SECONDS,
  createTranscriptionChunks,
  dedupeTranscriptionOverlap,
  encodePcm16Wav,
  mergeTranscriptionCues,
  transcribeSong,
  transcriptionCuesToSrt,
} from '../js/song-transcription.js';

test('transcription WAV is mono 16-bit PCM at the requested sample rate', async () => {
  const blob = encodePcm16Wav(new Float32Array([-1, 0, 1]), 16000);
  const view = new DataView(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav');
  assert.equal(new TextDecoder().decode(new Uint8Array(view.buffer, 0, 4)), 'RIFF');
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(34, true), 16);
});

test('transcription chunks use 25 seconds plus a 2 second overlap', async () => {
  const sampleRate = 10;
  const chunks = createTranscriptionChunks(new Float32Array(61 * sampleRate), sampleRate);
  assert.equal(TRANSCRIPTION_CHUNK_SECONDS, 25);
  assert.equal(TRANSCRIPTION_OVERLAP_SECONDS, 2);
  assert.deepEqual(chunks.map(chunk => chunk.offset), [0, 25, 50]);
  assert.deepEqual(await Promise.all(chunks.map(async chunk => ((await chunk.blob.arrayBuffer()).byteLength - 44) / 2)), [270, 270, 110]);
});

test('overlap cues are deduplicated, short cues merge and serialize to SRT', () => {
  const cues = dedupeTranscriptionOverlap([
    { start: 1, end: 2, text: 'Hello' },
    { start: 2.3, end: 3, text: 'world' },
    { start: 2.4, end: 3.1, text: 'world!' },
    { start: 12, end: 13, text: 'Later' },
  ]);
  assert.equal(cues.length, 3);
  const merged = mergeTranscriptionCues(cues);
  assert.deepEqual(merged[0], { start: 1, end: 3.1, text: 'Hello world!' });
  assert.match(transcriptionCuesToSrt(merged), /00:00:01,000 --> 00:00:03,100\nHello world!/);
});

test('song transcription posts every chunk with the API fields and joins JSON cues', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const offset = Number(options.body.get('offset'));
    const chunkIndex = Number(options.body.get('chunkIndex'));
    requests.push({
      url,
      method: options.method,
      audio: options.body.get('audio'),
      language: options.body.get('language'),
      offset,
      chunkIndex,
    });
    return new Response(JSON.stringify({
      success: true,
      chunkIndex,
      offset,
      text: `part ${chunkIndex}`,
      cues: [{ start: offset, end: offset + 1, text: `part ${chunkIndex}` }],
    }));
  };
  try {
    const progress = [];
    const srt = await transcribeSong(new Float32Array(51), 1, 'https://worker.example', 'ja', (current, total) => progress.push([current, total]));
    assert.deepEqual(requests.map(({ url, method, language, offset, chunkIndex }) => ({ url, method, language, offset, chunkIndex })), [
      { url: 'https://worker.example', method: 'POST', language: 'ja', offset: 0, chunkIndex: 0 },
      { url: 'https://worker.example', method: 'POST', language: 'ja', offset: 25, chunkIndex: 1 },
      { url: 'https://worker.example', method: 'POST', language: 'ja', offset: 50, chunkIndex: 2 },
    ]);
    assert.deepEqual(requests.map(request => request.audio.name), ['chunk-0.wav', 'chunk-1.wav', 'chunk-2.wav']);
    assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
    assert.match(srt, /00:00:25,000 --> 00:00:26,000\npart 1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
