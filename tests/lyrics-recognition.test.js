import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LYRICS_MAX_DURATION,
  appendWhisperCues,
  downmixAndResample,
  recognitionChunks,
} from '../js/lyrics-recognition-core.js';

test('lyrics recognition prepares mono 16 kHz audio and overlapping chunks', () => {
  const left = Float32Array.from({ length: 44100 }, () => .6);
  const right = Float32Array.from({ length: 44100 }, () => .2);
  const mono = downmixAndResample(left, right);
  assert.equal(mono.length, 16000);
  assert.ok(Math.abs(mono[8000] - .4) < 1e-6);

  const chunks = recognitionChunks(new Float32Array(65 * 16000));
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map(chunk => chunk.start), [0, 29, 58]);
  assert.equal(chunks.at(-1).end, 65);
  assert.equal(LYRICS_MAX_DURATION, 480);
});

test('Whisper timestamps become ordered cues without overlap duplicates', () => {
  let cues = appendWhisperCues([], {
    chunks: [
      { timestamp: [2, 5], text: ' 第一行 ' },
      { timestamp: [27, 30], text: '第二行' },
    ],
  }, 0, 30);
  cues = appendWhisperCues(cues, {
    chunks: [
      { timestamp: [0, 1], text: '第二行' },
      { timestamp: [1, 4], text: '第三行' },
    ],
  }, 29, 59);
  assert.deepEqual(cues.map(cue => cue.text), ['第一行', '第二行', '第三行']);
  assert.ok(cues.every((cue, index) => index === 0 || cue.start >= cues[index - 1].end));
});

test('Spleeter and Whisper share the IndexedDB model cache', () => {
  const cache = readFileSync('js/indexeddb-model-cache.js', 'utf8');
  const separator = readFileSync('js/vocal-separator-worker.js', 'utf8');
  const whisper = readFileSync('js/lyrics-recognition-worker.js', 'utf8');
  assert.match(cache, /yumeew-ai-models-v1/);
  assert.match(separator, /indexedDbModelCache/);
  assert.match(whisper, /indexedDbModelCache/);
  assert.match(separator, /正在將既有模型移到共用 IndexedDB/);
});
