import test from "node:test";
import assert from "node:assert/strict";
import { createVideoProjectFile, projectFilename, readVideoProjectFile } from "../js/video-project-file.js";

test("video prompt project uses a custom binary container with a zip filename", async () => {
  const date = new Date(2026, 8, 14, 9, 8, 7);
  const media = new File([new Uint8Array([1, 2, 3, 4])], "Image1.png", { type: "image/png", lastModified: 1234 });
  const file = await createVideoProjectFile({ storyboards: [{ start: "0", end: "5" }] }, [media], date);
  assert.equal(file.name, "video_prompt_20260914_090807.zip");
  assert.equal(file.type, "application/octet-stream");
  assert.notEqual((await file.slice(0, 2).text()), "PK");
  const restored = await readVideoProjectFile(file);
  assert.deepEqual(restored.metadata, { storyboards: [{ start: "0", end: "5" }] });
  assert.equal(restored.binaries[0].name, "Image1.png");
  assert.equal(restored.binaries[0].type, "image/png");
  assert.deepEqual([...new Uint8Array(await restored.binaries[0].arrayBuffer())], [1, 2, 3, 4]);
  assert.equal(projectFilename(date), file.name);
});

test("video prompt project rejects regular zip files and truncated media", async () => {
  await assert.rejects(() => readVideoProjectFile(new Blob(["PK regular zip"])), /不是有效/);
  const valid = await createVideoProjectFile({ resources: [1] }, [new Blob(["media"])]);
  await assert.rejects(() => readVideoProjectFile(valid.slice(0, valid.size - 1)), /媒體資料已損壞/);
});
