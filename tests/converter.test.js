import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  CONVERTER_FORMAT_LABELS,
  conversionVideoOptions,
  converterFilename,
  converterFormats,
  describeConversionFailure,
} from '../js/converter-core.js';

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

test('converter surfaces a specific reason when a conversion is invalid', () => {
  // 使用者自己選擇捨棄的軌道（例如轉純音訊時本來就會捨棄影片軌）不該影響錯誤訊息判斷。
  assert.match(
    describeConversionFailure({ discardedTracks: [{ track: { type: 'video' }, reason: 'discarded_by_user' }] }),
    /無法將這個檔案轉成所選格式/,
  );
  assert.match(
    describeConversionFailure({
      discardedTracks: [
        { track: { type: 'video' }, reason: 'discarded_by_user' },
        { track: { type: 'audio' }, reason: 'undecodable_source_codec' },
      ],
    }),
    /無法解碼/,
  );
  assert.match(
    describeConversionFailure({ discardedTracks: [{ track: { type: 'audio' }, reason: 'unknown_source_codec' }] }),
    /無法解碼/,
  );
  assert.match(
    describeConversionFailure({ discardedTracks: [{ track: { type: 'audio' }, reason: 'no_encodable_target_codec' }] }),
    /無法編碼成所選格式/,
  );
  assert.match(
    describeConversionFailure({ discardedTracks: [{ track: { type: 'audio' }, reason: 'max_track_count_reached' }] }),
    /軌道數量超出/,
  );
  assert.match(describeConversionFailure({ discardedTracks: [] }), /無法將這個檔案轉成所選格式/);
});

test('converter preserves source dimensions without passing resize options', () => {
  const quality = { value: 'high' };
  assert.deepEqual(conversionVideoOptions({
    sourceCodec: 'avc',
    targetCodec: 'vp9',
    quality,
    hardwareAcceleration: 'no-preference',
  }), {
    codec: 'vp9',
    quality,
    hardwareAcceleration: 'no-preference',
  });
  assert.deepEqual(conversionVideoOptions({
    sourceCodec: 'vp9',
    targetCodec: 'vp9',
    quality,
    hardwareAcceleration: 'prefer-hardware',
  }), { codec: 'vp9' });
});

test('converter page has every referenced control and only local assets', () => {
  const html = readFileSync('converter.html', 'utf8');
  const script = readFileSync('js/converter.js', 'utf8');
  const core = readFileSync('js/converter-core.js', 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of script.matchAll(/\$\(['"]([^'"]+)['"]\)/g)) assert.ok(ids.includes(id), id);
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#?]+)(?:\?[^"#]*)?"/g)) assert.ok(existsSync(path), path);
  assert.doesNotMatch(script, /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
  assert.match(html, /影片與音樂只在瀏覽器內處理/);
  assert.match(html, /id="converter-input"[^>]*accept="[^"]*video\/webm[^"]*\.webm/);
  assert.match(html, /支援 MP4、MOV、WebM/);
  const mainHtml = readFileSync('index.html', 'utf8');
  assert.match(mainHtml, /href="\.\/converter\.html"[\s\S]*?<strong>任意轉<\/strong>/);
  assert.doesNotMatch(mainHtml, /href="\.\/converter\.html"[^>]*target="_blank"/);
  assert.match(readFileSync('scripts/serve.js', 'utf8'), /"converter\.html"/);
  assert.match(core, /chooseVideoAcceleration\(/);
  assert.doesNotMatch(core, /videoOptions\s*=\s*\{[^}]*\b(?:width|height|fit)\b/s);
  assert.doesNotMatch(core, /hardwareAcceleration:\s*['"]prefer-hardware['"]/);
});
