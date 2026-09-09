import test from "node:test";
import assert from "node:assert/strict";
import { isBackgroundVideo, loopingVideoTimestamp } from "../js/background-video.js";

test("background video accepts MP4, MOV and WebM while rejecting images", () => {
  for (const [name, type] of [["loop.mp4", "video/mp4"], ["loop.mov", "video/quicktime"], ["loop.webm", "video/webm"], ["LOOP.MP4", ""]]) {
    assert.equal(isBackgroundVideo({ name, type }), true);
  }
  assert.equal(isBackgroundVideo({ name: "cover.webp", type: "image/webp" }), false);
});

test("background video time loops without leaving its duration", () => {
  assert.equal(loopingVideoTimestamp(0, 2.5), 0);
  assert.equal(loopingVideoTimestamp(3, 2.5), .5);
  assert.equal(loopingVideoTimestamp(8, 2.5), .5);
  assert.equal(loopingVideoTimestamp(-.5, 2.5), 2);
  assert.equal(loopingVideoTimestamp(5, 0), 0);
});
