import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  clampLayerTiming,
  coverRect,
  formatEditorTime,
  isLayerActive,
  layerEnd,
  projectDuration,
} from "../js/video-editor-core.js";

test("video and image layers produce stable timeline ranges", () => {
  const video = { type: "video", start: 2, end: 8, audio: false };
  const image = { type: "image", start: 7, duration: 5 };
  assert.equal(layerEnd(video), 8);
  assert.equal(layerEnd(image), 12);
  assert.equal(projectDuration([video, image]), 12);
  assert.equal(isLayerActive(video, 2), true);
  assert.equal(isLayerActive(video, 8), false);
  assert.equal(isLayerActive(image, 11.9), true);
  assert.equal(formatEditorTime(62.35), "01:02.4");
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
  assert.match(html, /id="layer-audio"[^>]*type="checkbox"/);
  assert.doesNotMatch(html, /id="layer-audio"[^>]*checked/);
  assert.match(script, /loadStoredMedia\("subtitle"\)/);
  assert.match(script, /drawSubtitles/);
  assert.match(script, /drawIdentity/);
  assert.doesNotMatch(script, /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
  assert.match(readFileSync("index.html", "utf8"), /href="\.\/converter\.html">任意轉<\/a>\s*<a class="tool-link" href="\.\/video-editor\.html">語喵影片<\/a>/);
  assert.match(readFileSync("scripts/serve.js", "utf8"), /"video-editor\.html"/);
});
