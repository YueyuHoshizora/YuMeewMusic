import { STYLES } from "../js/styles.js";
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, clearSettings, loadSettings, saveSettings, validateSettings } from "../js/settings.js";

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test("settings survive another load and exclude all media-related data", () => {
  const storage = memoryStorage();
  const settings = {
    songTitle: "測試歌曲",
    lyricist: "作詞者",
    composer: "作曲者",
    textX: 35,
    textY: 60,
    textSize: 150,
    textFadeAfter: 8,
    textColor: "#ff6688",
    subtitlePosition: "left",
    subtitleMargin: 12,
    subtitleSize: 150,
    subtitleDirection: "vertical",
    subtitleTypewriter: true,
    style: 5,
    color: "#A1B2C3",
    strength: 0,
    darkness: 100,
    positionX: -23,
    positionY: 18,
    resolution: "720",
    aspectRatio: "9:16",
    fps: "60",
    format: "flac",
    mode: "light",
    theme: "ocean",
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

test("new animation choices persist while old selections remain compatible", () => {
  const storage = memoryStorage();
  for (let style = 0; style < STYLES.length; style++) {
    saveSettings({ ...DEFAULT_SETTINGS, style }, () => storage);
    assert.equal(loadSettings(() => storage).style, style);
  }
  assert.equal(validateSettings({ style: STYLES.length }).style, 0);
});

test("reset removes only this app's preferences", () => {
  const data = new Map([["yumeew.settings.v1", "{}"], ["unrelated", "keep"]]);
  assert.equal(clearSettings(() => ({ removeItem: key => data.delete(key) })), true);
  assert.equal(data.has("yumeew.settings.v1"), false);
  assert.equal(data.get("unrelated"), "keep");
  assert.equal(clearSettings(() => { throw Error("Blocked"); }), false);
});

test("song fade delay defaults to five seconds and accepts only 1–15", () => {
  for (const value of [1, 5, 15]) assert.equal(validateSettings({textFadeAfter:value}).textFadeAfter, value);
  for (const value of [0, 16, 2.5, null]) assert.equal(validateSettings({textFadeAfter:value}).textFadeAfter, 5);
});
