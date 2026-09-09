import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { imageSequenceAt, imageSequenceDuration, serializeImageSequence } from "../js/image-sequence.js";
import { createPngMov } from "../js/png-mov.js";

test("image sequence uses consecutive durations and finds the active image", () => {
  const slides = [{ name: "a", duration: 2 }, { name: "b", duration: 3 }];
  assert.equal(imageSequenceDuration(slides), 5);
  assert.deepEqual(imageSequenceAt(slides, 1.9), { slide: slides[0], index: 0, start: 0, time: 1.9 });
  assert.deepEqual(imageSequenceAt(slides, 2), { slide: slides[1], index: 1, start: 2, time: 2 });
  assert.equal(imageSequenceAt(slides, 6, true).slide, slides[0]);
});

test("stored image sequence contains blobs and editable timing without DOM objects", () => {
  const file = new Blob(["png"], { type: "image/png" });
  file.name = "透明.png";
  file.lastModified = 123;
  const project = serializeImageSequence([{
    file, name: file.name, element: {}, url: "blob:temporary", duration: 4,
    enterEffect: "fade", enterDuration: .5, exitEffect: "zoom", exitDuration: .5,
  }], { outputName: "result.mov", width: 1280, height: 720, aspectRatio: "16:9", fps: 30 });
  assert.equal(project.outputName, "result.mov");
  assert.equal(project.slides[0].blob, file);
  assert.equal(project.slides[0].duration, 4);
  assert.equal("element" in project.slides[0], false);
  assert.equal("url" in project.slides[0], false);
});

test("PNG MOV holds repeated still frames with one sample duration", async () => {
  const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });
  const blob = createPngMov([png, png, png], 1280, 720, 30);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);
  assert.equal(blob.type, "video/quicktime");
  assert.match(text, /ftypqt  /);
  assert.match(text, /moov/);
  assert.match(text, /png /);
  assert.equal([...bytes].filter((value, index) => value === 137 && bytes[index + 1] === 80 && bytes[index + 2] === 78 && bytes[index + 3] === 71).length, 1);
  const stts = text.indexOf("stts");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(stts + 8), 1);
  assert.equal(view.getUint32(stts + 12), 1);
  assert.equal(view.getUint32(stts + 16), 3);
});

test("圖轉影片 page exposes multiple images, MOV settings and both export paths", () => {
  const html = readFileSync("image-video.html", "utf8");
  const script = readFileSync("js/image-video.js", "utf8");
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of script.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(ids.includes(id), id);
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#?]+)(?:\?[^"#]*)?"/g)) assert.ok(existsSync(path), path);
  assert.match(html, /id="images-input"[^>]*multiple/);
  assert.match(html, /id="export-image-video"/);
  assert.match(html, /id="export-image-video-to-main"/);
  assert.match(html, /id="image-video-transparency"/);
  assert.match(html, /PNG 影格保留透明通道/);
  assert.doesNotMatch(html, /輸出格式|<select[^>]*format/);
  assert.match(script, /saveStoredMedia\("image", file\)/);
  assert.match(script, /saveStoredValue\("image-video-project", project\)/);
  assert.match(script, /new m\.Mp4OutputFormat\(\)/);
  assert.match(script, /deleteStoredValue\("image-video-project"\)/);
  assert.match(script, /window\.confirm\("返回主畫面將不會保留目前的圖片與設定，是否確定？"\)/);
  assert.match(script, /settings\.resolution/);
  assert.match(script, /settings\.fps/);
  assert.doesNotMatch(script, /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
});
