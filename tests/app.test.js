import { trimAudio as realTrimAudio } from "../js/trim.js";
import { moveTrimRange } from "../js/trim-range.js";
import { formatTrimTime, parseTrimTime } from "../js/trim-time.js";
import { videoDimensions } from "../js/dimensions.js";
import { STYLES } from "../js/styles.js";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { getFormat, exportFilename, FORMATS } from "../js/formats.js";
import { DEFAULT_SETTINGS } from "../js/settings.js";

test("editor initializes, switches formats and reaches download for every format", async () => {
  const durations = [];
  const downloads = [],
    encoded = [],
    elements = new Map();
  function element() {
    return {
      open: false,
      showModal() { this.open = true; },
      close() { this.open = false; this.listeners.close?.(); },
      focus() {},
      value: "",
      textContent: "",
      disabled: false,
      hidden: false,
      currentTime: 0,
      paused: true,
      volume: 1,
      style: {},
      dataset: {},
      children: [],
      listeners: {},
      classList: { toggle() {} },
      setAttribute() {},
      append(...children) {
        this.children.push(...children);
      },
      remove() {},
      querySelector() {
        return element();
      },
      addEventListener(type, handler) {
        this.listeners[type] = handler;
      },
      pause() { this.paused = true; this.listeners.pause?.(); },
      async play() { this.paused = false; this.listeners.play?.(); },
      click() {
        if (this.download) downloads.push(this.download);
      },
    };
  }
  const html = readFileSync("index.html", "utf8");
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, element());
  const buffer = { duration: 65, length: 3120000, sampleRate: 48000, numberOfChannels: 2 };
  buffer.getChannelData = () => new Float32Array(buffer.length);
  const context = vm.createContext({
    trimAudio: (source, start, end) => realTrimAudio(source, start, end, options => ({...options, duration:options.length/options.sampleRate, getChannelData:()=>new Float32Array(options.length)})),
    saveStoredMedia: async () => {},
    loadStoredMedia: async () => null,
    deleteStoredMedia: async () => {},
    unpackStoredMedia: record => record,
    navigator: { storage: { persist: async () => true } },
    document: {
      fullscreenElement: null,
      listeners: {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
      async exitFullscreen() { this.fullscreenElement = null; this.listeners.fullscreenchange?.(); },
      getElementById: (id) => elements.get(id),
      querySelectorAll: () => [],
      querySelector: () => element(),
      createElementNS: element,
      createElement: element,
      body: element(),
    },
    window: { addEventListener() {} },
    requestAnimationFrame() {},
    setTimeout() {},
    AbortController,
    URL: { createObjectURL: () => "blob:local-test", revokeObjectURL() {} },
    AudioContext: class {
      constructor() { this.destination = {}; this.state = "suspended"; }
      async decodeAudioData() {
        return buffer;
      }
      createMediaElementSource() { return { connect() {} }; }
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      async resume() { this.state = "running"; }
      async close() {}
    },
    videoDimensions,
    STYLES,
    moveTrimRange, formatTrimTime, parseTrimTime,
    DEFAULT_SETTINGS,
    clearSettings: () => true,
    getFormat,
    exportFilename,
    loadSettings: () => ({ ...DEFAULT_SETTINGS }),
    saveSettings() {},
    applyTheme() {},
    draw() {},
    encodeMedia: async (options) => {
      encoded.push(options.format);
      durations.push(options.buffer.duration);
      assert.equal(options.settings.songTitle, "測試歌曲");
      assert.equal(options.settings.lyricist, "測試作詞");
      assert.equal(options.settings.composer, "測試作曲");
      return new Blob(["test"]);
    },
  });
  elements.get("preview-frame").requestFullscreen = async () => {
    context.document.fullscreenElement = elements.get("preview-frame");
    context.document.listeners.fullscreenchange?.();
  };
  // Execute the full UI module with only browser and encoding boundaries substituted.
  const source = readFileSync("js/app.js", "utf8").replace(/^import .*;\n/gm, "");
  vm.runInContext(source, context);
  assert.equal(elements.get("duration").textContent, "00:00");
  assert.equal(elements.get("export").textContent, "↓ 匯出 MP4 ↗");
  assert.equal(elements.get("export").disabled, true);
  await elements.get("preview-frame").listeners.click();
  assert.equal(context.document.fullscreenElement, elements.get("preview-frame"));
  assert.equal(elements.get("fullscreen-hint").textContent, "↙ 點擊恢復");
  await elements.get("preview-frame").listeners.click();
  assert.equal(context.document.fullscreenElement, null);
  assert.equal(elements.get("fullscreen-hint").textContent, "⛶ 點擊全螢幕");
  await vm.runInContext(
    'loadAudio({ name: "song.wav", size: 100, arrayBuffer: async () => new ArrayBuffer(0) })',
    context,
  );
  assert.equal(elements.get("duration").textContent, "01:05");
  assert.match(elements.get("audio-info").textContent, /01:05/);
  elements.get("loop-playback").listeners.click();
  assert.equal(vm.runInContext("state.loopPlayback", context), true);
  elements.get("audio").paused = false;
  elements.get("audio").currentTime = 65;
  vm.runInContext("enforceTrimEnd()", context);
  assert.equal(elements.get("audio").currentTime, 0);
  assert.equal(elements.get("audio").paused, false);
  elements.get("loop-playback").listeners.click();
  assert.equal(vm.runInContext("state.loopPlayback", context), false);
  elements.get("audio").pause();
  elements.get("exportVolume").value = "10";
  elements.get("exportVolume").listeners.input();
  assert.equal(elements.get("audio").volume, .1);
  await elements.get("play").listeners.click();
  assert.equal(vm.runInContext("previewGain.gain.value", context), .1);
  elements.get("exportVolume").value = "200";
  elements.get("exportVolume").listeners.input();
  assert.equal(vm.runInContext("previewGain.gain.value", context), 2);
  assert.equal(elements.get("audio").volume, 1);
  elements.get("play").listeners.click();
  elements.get("songTitle").value = "測試歌曲";
  elements.get("lyricist").value = "測試作詞";
  elements.get("composer").value = "測試作曲";
  for (const [format, type] of Object.entries(FORMATS)) {
    elements.get("format").value = format;
    elements.get("format").listeners.change();
    assert.equal(elements.get("export").textContent, `↓ 匯出 ${format.toUpperCase()} ↗`);
    assert.equal(elements.get("export").disabled, false);
    assert.equal(elements.get("video-export-settings").hidden, !type.video);
    assert.equal(elements.get("profile-export-settings").hidden, type.videoCodec !== "avc");
    assert.equal(elements.get("resolution").disabled, false);
    assert.equal(elements.get("fps").disabled, false);
    await elements.get("export").listeners.click();
    assert.equal(encoded.at(-1), format);
    assert.equal(downloads.at(-1), exportFilename("song.wav", format, "1080", "60"));
    assert.match(elements.get("message-text").textContent, /下載已開始/);
    assert.equal(elements.get("export").disabled, false);
  }
  elements.get("aspect-ratio").value = "9:16";
  elements.get("aspect-ratio").listeners.change();
  assert.equal(elements.get("preview").width, 720);
  assert.equal(elements.get("preview").height, 1280);
  assert.equal(elements.get("preview-aspect").textContent, "9:16");
  elements.get("trim-start").value = "00:10.00";
  elements.get("trim-end").value = "01:05.00";
  await elements.get("trim-apply").listeners.click();
  assert.equal(vm.runInContext("state.buffer.duration", context),55);
  elements.get("trim-end").value = "00:30.00";
  elements.get("trim-end").listeners.input();
  await elements.get("export").listeners.click();
  assert.equal(durations.at(-1),20);
  assert.equal(vm.runInContext("state.trimStart + state.buffer.duration", context),30);
  elements.get("trim-end").value = "00:25.00";
  await elements.get("trim-end").listeners.change();
  assert.equal(vm.runInContext("state.buffer.duration", context),15);
  elements.get("trim-reset").listeners.click();
  await elements.get("export").listeners.click();
  assert.equal(durations.at(-1),65);
  assert.equal(elements.get("trim-end").value,"00:25.00");
  context.window.confirm = () => { throw Error("Native confirm must not be used"); };
  elements.get("reset-settings").listeners.click();
  assert.equal(elements.get("aspect-ratio").value, "9:16");
  assert.equal(elements.get("reset-dialog").open, true);
  elements.get("reset-dialog-cancel").listeners.click();
  assert.equal(elements.get("reset-dialog").open, false);
  assert.equal(elements.get("aspect-ratio").value, "9:16");
  elements.get("reset-settings").listeners.click();
  elements.get("reset-dialog-confirm").listeners.click();
  assert.equal(elements.get("reset-dialog").open, false);
  assert.equal(elements.get("aspect-ratio").value, "16:9");
  assert.equal(elements.get("format").value, "mp4");
  assert.equal(elements.get("songTitle").value, "");
  assert.equal(elements.get("appearance-mode").value, "dark");
  assert.equal(elements.get("export").disabled, false);
  assert.match(elements.get("audio-info").textContent, /01:05/);
  assert.equal(downloads.length, Object.keys(FORMATS).length + 2);
  elements.get("trim-start").value = "00:10.00";
  elements.get("trim-end").value = "00:30.00";
  elements.get("trim-start-range").value = "10";
  elements.get("trim-end-range").value = "30";
  vm.runInContext("state.buffer = {duration:20}; state.trimStart = 10", context);
  elements.get("trim-reset").listeners.click();
  assert.equal(elements.get("trim-start").value, "00:10.00");
  assert.equal(elements.get("trim-end").value, "00:30.00");
  assert.equal(elements.get("trim-start-range").value, "10");
  assert.equal(elements.get("trim-markers").hidden, false);
  assert.equal(elements.get("trim-selection-duration").textContent, "00:20.00");
  assert.equal(elements.get("trim-start-label").textContent, "開始 00:10.00");
  assert.equal(elements.get("trim-end-label").textContent, "結束 00:30.00");
  assert.equal(elements.get("seek").max, 65);
  assert.equal(elements.get("trim-end-range").value, "30");
  assert.equal(vm.runInContext("state.buffer === state.originalBuffer && state.trimStart === 0", context), true);
  assert.equal(elements.get("duration").textContent, "01:05");
});
