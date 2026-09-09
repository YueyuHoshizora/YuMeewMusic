import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteStoredMedia,
  deleteStoredValue,
  loadStoredMedia,
  loadStoredValue,
  packStoredMedia,
  saveStoredMedia,
  saveStoredValue,
  unpackStoredMedia,
} from "../js/media-store.js";

class TestFile extends Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = name;
    this.lastModified = options.lastModified;
  }
}

test("stored media preserves binary data, name, type and modification time", async () => {
  const original = new TestFile([Uint8Array.from([0, 1, 2, 255])], "字幕.srt", {
    type: "application/x-subrip",
    lastModified: 12345,
  });
  const packed = packStoredMedia(original);
  const restored = unpackStoredMedia(packed, TestFile);
  assert.equal(restored.name, original.name);
  assert.equal(restored.type, original.type);
  assert.equal(restored.lastModified, original.lastModified);
  assert.deepEqual([...new Uint8Array(await restored.arrayBuffer())], [0, 1, 2, 255]);
});

test("invalid stored media records are rejected", () => {
  assert.throws(() => unpackStoredMedia(null, TestFile));
  assert.throws(() => unpackStoredMedia({ blob: new Blob() }, TestFile));
});

function memoryIndexedDb() {
  const data = new Map();
  let created = false;
  const request = operation => {
    const result = {};
    queueMicrotask(() => {
      try {
        result.result = operation();
        result.onsuccess?.();
      } catch (error) {
        result.error = error;
        result.onerror?.();
      }
    });
    return result;
  };
  const database = {
    objectStoreNames: { contains: () => created },
    createObjectStore() { created = true; },
    transaction() {
      return {
        objectStore() {
          return {
            put(value, key) { return request(() => { data.set(key, value); return key; }); },
            get(key) { return request(() => data.get(key)); },
            delete(key) { return request(() => data.delete(key)); },
          };
        },
      };
    },
    close() {},
  };
  return {
    open() {
      const result = {};
      queueMicrotask(() => {
        result.result = database;
        if (!created) result.onupgradeneeded?.();
        result.onsuccess?.();
      });
      return result;
    },
  };
}

test("IndexedDB media store saves, loads, replaces and deletes each supported file", async () => {
  const database = memoryIndexedDb();
  const first = new TestFile(["first"], "first.mp3", { type: "audio/mpeg" });
  const second = new TestFile(["second"], "second.mp3", { type: "audio/mpeg" });
  await saveStoredMedia("audio", first, database);
  assert.equal((await loadStoredMedia("audio", database)).name, "first.mp3");
  await saveStoredMedia("audio", second, database);
  assert.equal((await loadStoredMedia("audio", database)).name, "second.mp3");
  await deleteStoredMedia("audio", database);
  assert.equal(await loadStoredMedia("audio", database), null);
  await assert.rejects(saveStoredMedia("identity", first, database), /不支援/);
});

test("image-to-video project data can be stored beside the rendered background file", async () => {
  const database = memoryIndexedDb();
  const project = { version: 1, slides: [{ blob: new Blob(["image"]), duration: 5 }] };
  await saveStoredValue("image-video-project", project, database);
  assert.deepEqual(await loadStoredValue("image-video-project", database), project);
  await deleteStoredValue("image-video-project", database);
  assert.equal(await loadStoredValue("image-video-project", database), null);
  await assert.rejects(saveStoredValue("other", project, database), /不支援/);
});
