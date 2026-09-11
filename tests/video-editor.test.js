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
  projectTrimRange,
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

test("project trimming clamps a valid export range and preserves a full-range sentinel", () => {
  assert.deepEqual(projectTrimRange(20, 5, 12), { start: 5, end: 12, duration: 7 });
  assert.deepEqual(projectTrimRange(20, 0, null), { start: 0, end: 20, duration: 20 });
  assert.deepEqual(projectTrimRange(20, 19.999, 25), { start: 19.99, end: 20, duration: .010000000000001563 });
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

test("影片編輯 exposes editable media layers and locked visual overlays", () => {
  const html = readFileSync("video-editor.html", "utf8");
  const script = readFileSync("js/video-editor.js", "utf8");
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of script.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(ids.includes(id), id);
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#?]+)(?:\?[^"#]*)?"/g)) assert.ok(existsSync(path), path);
  assert.match(html, /動態特效固定在倒數第二層，字幕與個人識別固定在最上層/);
  assert.match(html, /id="dynamic-layer"[^>]*>.*動態特效.*固定倒數第二層.*鎖定/s);
  assert.doesNotMatch(script, /type: "dynamic"/);
  assert.match(html, /id="base-layer"[^>]*>.*主畫面影片本體.*基礎鎖定/s);
  assert.match(html, /id="layer-audio"[^>]*type="checkbox"/);
  assert.doesNotMatch(html, /id="layer-audio"[^>]*checked/);
  assert.equal((html.match(/data-time-field="start"/g) || []).length, 4);
  assert.equal((html.match(/data-time-field="end"/g) || []).length, 4);
  for (const delta of ["0.5", "0.1", "-0.5", "-0.1"]) assert.equal((html.match(new RegExp(`data-delta="${delta.replace("-", "\\-")}"`, "g")) || []).length, 2);
  assert.match(html, /id="timeline"[^>]*aria-label="可拖曳播放時間軸"/);
  for (const id of ["trim-start", "trim-end", "trim-selection", "trim-drag-start", "trim-drag-body", "trim-drag-end", "trim-apply", "trim-reset"]) assert.ok(ids.includes(id), id);
  assert.match(html, /拖曳色帶或兩端 · 放開自動套用/);
  assert.doesNotMatch(html, />↓ 匯出影片<\/button>/);
  assert.match(html, /id="apply-project"[^>]*>套用到主畫面 →<\/button>/);
  assert.match(html, /id="editor-format"[^>]*type="hidden"[^>]*value="webm"/);
  assert.doesNotMatch(html, /<label[^>]*for="editor-format"/);
  assert.match(script, /const format = "webm"/);
  for (const id of ["enter-effect", "enter-duration", "exit-effect", "exit-duration"]) assert.ok(ids.includes(id), id);
  assert.equal((html.match(/id="(?:enter|exit)-duration"[^>]*value="0\.5"/g) || []).length, 2);
  assert.equal((html.match(/<option value="rgb-glitch">RGB 色差故障<\/option>/g) || []).length, 2);
  assert.equal((html.match(/<option value="none">無<\/option>/g) || []).length, 2);
  assert.equal((html.match(/data-confirm-return/g) || []).length, 2);
  assert.match(script, /window\.confirm\("返回主畫面則不會保留所有修改結果，是否確定？"\)/);
  assert.match(script, /loadStoredMedia\("subtitle"\)/);
  assert.match(script, /loadStoredMedia\("audio"\)/);
  assert.match(script, /loadStoredMedia\("image"\)/);
  assert.match(script, /isBackgroundVideo\(file\)/);
  assert.match(script, /createLoopingVideoDecoder\(m, state\.base\.backgroundFile\)/);
  assert.match(script, /function drawBase\(canvas, time, background = state\.base\.image\)/);
  assert.match(script, /function mediaLayers\(\)/);
  assert.match(script, /addEventListener\("pointerdown"/);
  assert.match(script, /addEventListener\("pointermove"/);
  assert.match(script, /setPointerCapture/);
  assert.match(script, /const sourceTime = range\.start \+ time/);
  assert.match(script, /mixProjectAudio\(mediaLayers\(\), range, signal\)/);
  assert.doesNotMatch(script, /drawDynamicLayer\(canvas, sourceTime/);
  assert.doesNotMatch(script, /drawOverlays\(context, sourceTime\)/);
  assert.match(script, /saveStoredMedia\("image", file\)/);
  assert.match(script, /saveStoredMedia\("audio"/);
  assert.match(script, /window\.location\.href = "\.\/"/);
  assert.match(script, /drawSubtitles/);
  assert.match(script, /drawLayerWithEffect/);
  assert.match(script, /originalBuffer: state\.base\.audioBuffer \|\| \{ duration: timelineDuration\(\) \}/);
  assert.match(script, /drawIdentity/);
  assert.doesNotMatch(script, /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
  assert.match(readFileSync("index.html", "utf8"), /href="\.\/image-video\.html">圖轉影片<\/a>\s*<a class="tool-link" href="\.\/video-editor\.html">影片編輯<\/a>\s*<a class="tool-link" href="\.\/converter\.html">任意轉<\/a>/);
  assert.match(readFileSync("scripts/serve.js", "utf8"), /"video-editor\.html"/);
});
