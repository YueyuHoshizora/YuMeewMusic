import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, validateSettings } from "../js/settings.js";

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test("settings survive another load and exclude all media-related data", () => {
  const storage = memoryStorage();
  const settings = {
    style: 5,
    color: "#A1B2C3",
    strength: 0,
    darkness: 100,
    resolution: "720",
    fps: "60",
    format: "flac",
  };
  assert.equal(
    saveSettings(
      { ...settings, buffer: [1, 2], image: "pixels", name: "private.mp3", url: "blob:private" },
      () => storage,
    ),
    true,
  );
  assert.deepEqual(
    loadSettings(() => storage),
    { ...settings, color: "#a1b2c3" },
  );
  assert.deepEqual(
    Object.keys(JSON.parse(storage.getItem("yumeew.settings.v1"))),
    Object.keys(DEFAULT_SETTINGS),
  );
});

test("invalid stored fields default individually without losing valid settings", () => {
  assert.deepEqual(
    validateSettings({
      style: -1,
      color: "red",
      strength: Infinity,
      darkness: "50",
      resolution: "4k",
      fps: "60",
    }),
    { ...DEFAULT_SETTINGS, fps: "60" },
  );
  const storage = { getItem: () => "{broken" };
  assert.deepEqual(
    loadSettings(() => storage),
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(
    loadSettings(() => memoryStorage()),
    DEFAULT_SETTINGS,
  );
});

test("unavailable storage and quota errors do not break the editor", () => {
  const unavailable = () => {
    throw Error("SecurityError");
  };
  assert.deepEqual(loadSettings(unavailable), DEFAULT_SETTINGS);
  assert.equal(saveSettings(DEFAULT_SETTINGS, unavailable), false);
  assert.equal(
    saveSettings(DEFAULT_SETTINGS, () => ({
      getItem: () => null,
      setItem: () => {
        throw Error("QuotaExceededError");
      },
    })),
    false,
  );
});
