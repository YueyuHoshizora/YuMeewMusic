import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  SEPARATOR_MAX_DURATION,
  encodeStereoWav,
  hannWindow,
  mixSeparatedWav,
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
  assert.match(html, /id="download-mix"[^>]*>下載混合後 WAV</);
  assert.match(html, /單次最長 8 分鐘、150 MB/);
  assert.match(script, /150 \* 1024 \* 1024/);
  for (const track of ["vocals", "instrumental"]) {
    assert.match(html, new RegExp(`id="mute-${track}"[^>]*>MUTE<`));
    assert.match(html, new RegExp(`id="${track}-volume"[^>]*min="-10"[^>]*max="10"[^>]*step="0\\.3"`));
    for (const band of ["bass", "mid", "treble"]) {
      assert.match(html, new RegExp(`id="${track}-${band}"[^>]*min="-10"[^>]*max="10"[^>]*step="0\\.1"`));
    }
  }
  assert.match(script, /createBiquadFilter/);
  assert.match(script, /localStorage\.setItem\(TRACK_SETTINGS_KEY/);
  assert.match(script, /trackAudioContext\.state === "suspended"[\s\S]*?await trackAudioContext\.resume\(\)[\s\S]*?createMediaElementSource/);
  assert.doesNotMatch(script, /addEventListener\("play", \(\) => void ensureTrackAudio/);
  const workerScript = readFileSync("js/vocal-separator-worker.js", "utf8");
  assert.match(workerScript, /let sessionPromise = null/);
  assert.match(workerScript, /沿用已載入的 AI 模型/);
  assert.match(workerScript, /caches\.open\(MODEL_CACHE\)/);
  assert.match(workerScript, /cache\.match\(url\)/);
  assert.match(workerScript, /cache\.put\(url, response\.clone\(\)\)/);
  assert.match(workerScript, /new Uint8Array\(await (?:stored|response)\.arrayBuffer\(\)\)/);
  assert.doesNotMatch(workerScript, /finally\s*{\s*session\.release/);
  assert.doesNotMatch(script.match(/function finish\(\)[\s\S]*?\n}/)?.[0] || "", /terminate/);
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
  assert.equal(separatorFilename("我的/歌曲.mp3", "mixed"), "我的-歌曲-mixed.wav");
  assert.throws(() => separatorFilename("song.mp3", "drums"));
  assert.equal(SEPARATOR_MAX_DURATION, 480);
});

test("separated tracks remix with mute, EQ processing and peak protection", async () => {
  const samples = 4096;
  const vocals = encodeStereoWav(new Float32Array(samples).fill(0.8), new Float32Array(samples).fill(0.4));
  const instrumental = encodeStereoWav(new Float32Array(samples).fill(0.8), new Float32Array(samples).fill(0.2));
  const mixed = await mixSeparatedWav(vocals, instrumental, {
    vocals: { bass: 0, mid: 0, treble: 0, muted: false },
    instrumental: { bass: 0, mid: 0, treble: 0, muted: false },
  });
  const mixedView = new DataView(await mixed.arrayBuffer());
  assert.ok(Math.abs(mixedView.getInt16(44, true) / 32767 - 0.99) < 0.001);
  assert.ok(Math.abs(mixedView.getInt16(46, true) / 32767 - 0.37125) < 0.002);

  const vocalsOnly = await mixSeparatedWav(vocals, instrumental, {
    vocals: { volume: -6, bass: 0, mid: 0, treble: 0, muted: false },
    instrumental: { bass: 10, mid: 10, treble: 10, muted: true },
  });
  const vocalsView = new DataView(await vocalsOnly.arrayBuffer());
  assert.ok(Math.abs(vocalsView.getInt16(44, true) / 32767 - 0.8 * 10 ** (-6 / 20)) < 0.001);
  assert.equal(vocalsOnly.size, vocals.size);
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
