import test from "node:test";
import assert from "node:assert/strict";
import { formatResourceSize, nextResourceReference, resourceKind, resourceTypeLabel } from "../js/video-resources.js";

test("video resources identify images, audio and video from MIME or extension", () => {
  assert.equal(resourceKind({ type: "image/png", name: "unknown" }), "image");
  assert.equal(resourceKind({ type: "audio/wav", name: "unknown" }), "audio");
  assert.equal(resourceKind({ type: "video/webm", name: "unknown" }), "video");
  assert.equal(resourceKind({ type: "", name: "clip.mov" }), "video");
  assert.equal(resourceKind({ type: "application/pdf", name: "notes.pdf" }), "");
});

test("resource references remain monotonic after an earlier resource is deleted", () => {
  const resources = [{ kind: "image", referenceName: "Image1" }, { kind: "image", referenceName: "Image3" }];
  assert.deepEqual(nextResourceReference(resources, "image", { image: 4 }), { referenceName: "Image5", nextNumber: 5 });
  assert.deepEqual(nextResourceReference([], "audio", {}), { referenceName: "Audio1", nextNumber: 1 });
  assert.deepEqual(nextResourceReference([], "video", {}), { referenceName: "Video1", nextNumber: 1 });
});

test("resource metadata uses concise Traditional Chinese labels", () => {
  assert.equal(formatResourceSize(1024 * 1024), "1.0 MB");
  assert.equal(resourceTypeLabel("image"), "圖片");
  assert.equal(resourceTypeLabel("audio"), "音頻");
  assert.equal(resourceTypeLabel("video"), "影片");
});
