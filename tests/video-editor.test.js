import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  clampLayerTiming,
  coverRect,
  formatEditorTime,
  isLayerActive,
  layerEnd,
  nudgeLayerTime,
  projectDuration,
} from "../js/video-editor-core.js";

test("video and image layers produce stable timeline ranges", () => {
  const video = { type: "video", start: 2, end: 8, audio: false };
  const image = { type: "image", start: 7, duration: 5 };
  assert.equal(layerEnd(video), 8);
  assert.equal(layerEnd(image), 12);
  assert.equal(projectDuration([video, image]), 12);
  assert.equal(projectDuration([video], 20), 20);
  assert.equal(isLayerActive(video, 2), true);
  assert.equal(isLayerActive(video, 8), false);
  assert.equal(isLayerActive(image, 11.9), true);
  assert.equal(formatEditorTime(62.35), "01:02.4");
});

test("nudging a start moves the whole layer while nudging an end changes only the end", () => {
  const video = { type: "video", start: 2, end: 8, audio: false };
  assert.deepEqual(nudgeLayerTime(video, "start", .5), { ...video, start: 2.5, end: 8.5 });
  assert.deepEqual(nudgeLayerTime(video, "end", -.5), { ...video, end: 7.5 });
  assert.deepEqual(nudgeLayerTime({ ...video, start: .2 }, "start", -.5), { ...video, start: 0, end: 7.8 });
  const image = { type: "image", start: 1, duration: 5 };
  assert.deepEqual(nudgeLayerTime(image, "start", .5), { ...image, start: 1.5 });
});

test("layer timing cannot become negative or zero length", () => {
  assert.deepEqual(clampLayerTiming({ type: "video", start: 0, end: 4 }, { start: -2, end: 0 }), {
    type: "video", start: 0, end: .1,
  });
  assert.deepEqual(clampLayerTiming({ type: "image", start: 1, duration: 5 }, { duration: 0 }), {
    type: "image", start: 1, duration: .1,
  });
});

test("cover sizing fills the frame without distortion", () => {
  assert.deepEqual(coverRect(1920, 1080, 720, 1280), {
    x: -777.7777777777778,
    y: 0,
    width: 2275.5555555555557,
    height: 1280,
  });
});

test("語喵影片 exposes local layer controls and fixed top overlays", () => {
  const html = readFileSync("video-editor.html", "utf8");
  const script = readFileSync("js/video-editor.js", "utf8");
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of script.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(ids.includes(id), id);
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#?]+)(?:\?[^"#]*)?"/g)) assert.ok(existsSync(path), path);
  assert.match(html, /字幕與個人識別會自動置於最上層/);
  assert.match(html, /id="base-layer"[^>]*>.*主畫面影片本體.*基礎鎖定/s);
  assert.match(html, /id="layer-audio"[^>]*type="checkbox"/);
  assert.doesNotMatch(html, /id="layer-audio"[^>]*checked/);
  assert.equal((html.match(/data-time-field="start"/g) || []).length, 4);
  assert.equal((html.match(/data-time-field="end"/g) || []).length, 4);
  for (const delta of ["0.5", "0.1", "-0.5", "-0.1"]) assert.equal((html.match(new RegExp(`data-delta="${delta.replace("-", "\\-")}"`, "g")) || []).length, 2);
  assert.match(html, /id="timeline"[^>]*aria-label="可拖曳播放時間軸"/);
  assert.match(script, /loadStoredMedia\("subtitle"\)/);
  assert.match(script, /loadStoredMedia\("audio"\)/);
  assert.match(script, /loadStoredMedia\("image"\)/);
  assert.match(script, /drawBase\(canvas, time\)/);
  assert.match(script, /!state\.layers\.length && !state\.base\.audioBuffer/);
  assert.match(script, /addEventListener\("pointerdown"/);
  assert.match(script, /addEventListener\("pointermove"/);
  assert.match(script, /setPointerCapture/);
  assert.match(script, /drawSubtitles/);
  assert.match(script, /drawIdentity/);
  assert.doesNotMatch(script, /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
  assert.match(readFileSync("index.html", "utf8"), /href="\.\/converter\.html">任意轉<\/a>\s*<a class="tool-link" href="\.\/video-editor\.html">語喵影片<\/a>/);
  assert.match(readFileSync("scripts/serve.js", "utf8"), /"video-editor\.html"/);
});
