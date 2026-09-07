import { STYLES } from "../js/styles.js";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { getFormat, exportFilename, FORMATS } from "../js/formats.js";
import { DEFAULT_SETTINGS } from "../js/settings.js";

test("editor initializes, switches formats and reaches download for every format", async () => {
  const downloads = [],
    encoded = [],
    elements = new Map();
  function element() {
    return {
      value: "",
      textContent: "",
      disabled: false,
      hidden: false,
      currentTime: 0,
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
      pause() {},
      click() {
        if (this.download) downloads.push(this.download);
      },
    };
  }
  const html = readFileSync("index.html", "utf8");
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, element());
  const buffer = { duration: 65, length: 3120000, sampleRate: 48000, numberOfChannels: 2 };
  const context = vm.createContext({
    document: {
      getElementById: (id) => elements.get(id),
      querySelectorAll: () => [],
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
      async decodeAudioData() {
        return buffer;
      }
      async close() {}
    },
    STYLES,
    getFormat,
    exportFilename,
    loadSettings: () => ({ ...DEFAULT_SETTINGS }),
    saveSettings() {},
    applyTheme() {},
    draw() {},
    encodeMedia: async (options) => {
      encoded.push(options.format);
      return new Blob(["test"]);
    },
  });
  // Execute the full UI module with only browser and encoding boundaries substituted.
  const source = readFileSync("js/app.js", "utf8").replace(/^import .*;\n/gm, "");
  vm.runInContext(source, context);
  assert.equal(elements.get("duration").textContent, "00:00");
  assert.equal(elements.get("export").textContent, "↓ 匯出 MP4 ↗");
  assert.equal(elements.get("export").disabled, true);
  await vm.runInContext(
    'loadAudio({ name: "song.wav", size: 100, arrayBuffer: async () => new ArrayBuffer(0) })',
    context,
  );
  assert.equal(elements.get("duration").textContent, "01:05");
  assert.match(elements.get("audio-info").textContent, /01:05/);
  for (const [format, type] of Object.entries(FORMATS)) {
    elements.get("format").value = format;
    elements.get("format").listeners.change();
    assert.equal(elements.get("export").textContent, `↓ 匯出 ${format.toUpperCase()} ↗`);
    assert.equal(elements.get("export").disabled, false);
    assert.equal(elements.get("resolution").disabled, !type.video);
    assert.equal(elements.get("fps").disabled, !type.video);
    await elements.get("export").listeners.click();
    assert.equal(encoded.at(-1), format);
    assert.equal(downloads.at(-1), exportFilename("song.wav", format, "1080", "30"));
    assert.match(elements.get("message-text").textContent, /下載已開始/);
    assert.equal(elements.get("export").disabled, false);
  }
  assert.equal(downloads.length, 5);
});
