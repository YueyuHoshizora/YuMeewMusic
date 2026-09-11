import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  SEPARATOR_MAX_DURATION,
  encodeStereoWav,
  hannWindow,
  prepareSeparatorInput,
  reconstructVocals,
  separatorFilename,
} from "../js/vocal-separator-core.js";

test("vocal separator page exposes its complete local workflow", () => {
  const html = readFileSync("vocal-separator.html", "utf8");
  const script = readFileSync("js/vocal-separator.js", "utf8");
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of script.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(ids.includes(id), id);
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#?]+)(?:\?[^"#]*)?"/g)) assert.ok(existsSync(path), path);
  assert.match(html, /音樂只在瀏覽器內處理/);
  assert.match(html, /WebGPU/);
  assert.match(html, /下載人聲 WAV/);
  assert.match(readFileSync("index.html", "utf8"), /href="\.\/vocal-separator\.html"[^>]*>人聲分離<\/a>/);
  assert.match(readFileSync("scripts/serve.js", "utf8"), /"vocal-separator\.html"/);
  assert.doesNotMatch(script, /sendBeacon|XMLHttpRequest|WebSocket/);
});

test("separator WAV output is valid stereo PCM with safe file names", async () => {
  const left = Float32Array.from([-2, -0.5, 0, 0.5, 2]);
  const blob = encodeStereoWav(left, left, 44100);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), "WAVE");
  assert.equal(new DataView(bytes.buffer).getUint16(22, true), 2);
  assert.equal(new DataView(bytes.buffer).getUint32(24, true), 44100);
  assert.equal(blob.size, 44 + left.length * 4);
  assert.equal(separatorFilename("我的/歌曲.mp3", "vocals"), "我的-歌曲-vocals.wav");
  assert.throws(() => separatorFilename("song.mp3", "drums"));
  assert.equal(SEPARATOR_MAX_DURATION, 300);
});

test("STFT and inverse STFT preserve the interior signal with an identity mask", () => {
  const length = 16384;
  const left = Float32Array.from({ length }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / 44100));
  const right = Float32Array.from({ length }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 880 * i / 44100));
  const window = hannWindow();
  const prepared = prepareSeparatorInput(left, right, window);
  const mask = new Float32Array(2050 * prepared.frames * 2);
  for (let band = 0; band < 2050; band++) for (let time = 0; time < prepared.frames; time++) {
    mask[(band * prepared.frames + time) * 2] = 1;
  }
  const result = reconstructVocals(mask, prepared, window, length);
  let error = 0, signal = 0;
  for (let i = 2048; i < length - 2048; i++) {
    error += (result.left[i] - left[i]) ** 2 + (result.right[i] - right[i]) ** 2;
    signal += left[i] ** 2 + right[i] ** 2;
  }
  assert.ok(Math.sqrt(error / signal) < 1e-4);
});
