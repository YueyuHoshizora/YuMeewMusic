import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { CONVERTER_FORMAT_LABELS, converterFilename, converterFormats } from '../js/converter-core.js';

test('converter page exposes only formats valid for each input kind', () => {
  assert.deepEqual(converterFormats('audio'), ['mp3', 'm4a', 'flac', 'wav']);
  assert.deepEqual(converterFormats('video'), ['mp4', 'mov', 'webm', 'mp3', 'm4a', 'flac', 'wav']);
  assert.deepEqual(converterFormats('video', false), ['mp4', 'mov', 'webm']);
  assert.deepEqual(converterFormats('unknown'), []);
  assert.equal(converterFilename('music.flac', 'wav'), 'music-converted.wav');
  assert.equal(converterFilename('movie.mov', 'mp4'), 'movie-converted.mp4');
  assert.throws(() => converterFilename('file', 'exe'));
  for (const format of converterFormats('video')) assert.ok(CONVERTER_FORMAT_LABELS[format]);
});

test('converter page has every referenced control and only local assets', () => {
  const html = readFileSync('converter.html', 'utf8');
  const script = readFileSync('js/converter.js', 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of script.matchAll(/\$\(['"]([^'"]+)['"]\)/g)) assert.ok(ids.includes(id), id);
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#?]+)(?:\?[^"#]*)?"/g)) assert.ok(existsSync(path), path);
  assert.doesNotMatch(script, /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
  assert.match(html, /影片與音樂只在瀏覽器內處理/);
  assert.match(readFileSync('index.html', 'utf8'), /href="\.\/converter\.html"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>任意轉 ↗<\/a>/);
  assert.match(readFileSync('scripts/serve.js', 'utf8'), /"converter\.html"/);
});
