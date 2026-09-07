import { STYLES } from "../js/styles.js";
import test from "node:test";
import assert from "node:assert/strict";
import { spectrum, draw } from "../js/visualizer.js";
import { frameTiming } from "../js/export.js";
import { readFileSync, existsSync } from "node:fs";
const buffer = (data) => ({ sampleRate: 48000, getChannelData: () => data });
test("FFT responds to audio and safely handles silence and end padding", () => {
  const silence = buffer(new Float32Array(4096));
  assert.ok(spectrum(silence, 0).every((x) => x === 0));
  assert.ok(spectrum(silence, 10).every((x) => x === 0));
  const sine = buffer(
    Float32Array.from({ length: 4096 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000)),
  );
  const values = spectrum(sine, 0);
  assert.ok(Math.max(...values) > 0.5);
  assert.ok(values.every((x) => Number.isFinite(x) && x >= 0 && x <= 1));
});
test("all twelve renderers work at both requested resolutions", () => {
  for (const height of [720, 1080])
    for (let style = 0; style < STYLES.length; style++) {
      let calls = 0;
      const context = new Proxy(
        {},
        {
          get: (_, key) =>
            key === "createRadialGradient"
              ? () => ({ addColorStop() {} })
              : (...args) => {
                  calls++;
                  for (const n of args) if (typeof n === "number") assert.ok(Number.isFinite(n));
                },
          set: () => true,
        },
      );
      draw({ width: (height * 16) / 9, height, getContext: () => context }, 0, null, null, {
        style,
        color: "#c5fa75",
        strength: 70,
        darkness: 45,
      });
      assert.ok(calls > 10);
    }
});
test("30 and 60 fps preserve fractional final duration", () => {
  for (const fps of [30, 60])
    for (const duration of [0.01, 1, 2.31]) {
      const count = Math.ceil(duration * fps),
        last = frameTiming(count - 1, fps, duration);
      assert.ok(last.duration > 0 && last.duration <= 1 / fps);
      assert.ok(Math.abs(last.timestamp + last.duration - duration) < 1e-9);
    }
});
test("every statically referenced UI element exists and public assets are local", () => {
  const html = readFileSync("index.html", "utf8"),
    app = readFileSync("js/app.js", "utf8");
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  const references = [...app.matchAll(/\$\(["']([^"']+)["']\)/g)];
  assert.ok(references.length > 20);
  for (const [, id] of references) assert.ok(ids.includes(id), id);
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g))
    assert.ok(existsSync(path), path);
  assert.doesNotMatch(app, /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
});

test("new animations respond to audio and reproduce the same frame when seeking", () => {
  const silent = buffer(new Float32Array(96000));
  const tone = buffer(
    Float32Array.from({ length: 96000 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000)),
  );
  function render(style, audio) {
    const commands = [];
    const context = new Proxy(
      {},
      {
        get: (_, key) =>
          key === "createRadialGradient"
            ? () => ({ addColorStop() {} })
            : (...args) => commands.push([key, ...args]),
        set: (_, key, value) => {
          commands.push([key, typeof value === "object" ? "gradient" : value]);
          return true;
        },
      },
    );
    draw({ width: 1280, height: 720, getContext: () => context }, 0.5, audio, null, {
      style,
      color: "#c5fa75",
      strength: 70,
      darkness: 45,
    });
    return commands;
  }
  for (let style = 6; style < STYLES.length; style++) {
    assert.deepEqual(render(style, tone), render(style, tone));
    assert.notDeepEqual(render(style, tone), render(style, silent));
  }
});

test('position transforms only animation after background and restores every frame', () => {
  for (const height of [720, 1080]) for (let style = 0; style < STYLES.length; style++) {
    const calls = [];
    const context = new Proxy({}, {
      get: (_, key) => key === 'createRadialGradient' ? () => ({addColorStop() {}}) : (...args) => calls.push([key, ...args]),
      set: () => true,
    });
    const width = height * 16 / 9;
    const canvas = {width, height, getContext:()=>context};
    const settings = {style, color:'#c5fa75', strength:70, darkness:45, positionX:25, positionY:-20};
    draw(canvas, .5, null, null, settings);
    const translation = calls.findIndex(call => call[0] === 'translate');
    assert.deepEqual(calls[translation], ['translate', width * .25, -height * .2]);
    assert.equal(calls[translation - 1][0], 'save');
    assert.ok(calls.slice(0, translation).some(call => call[0] === 'fillRect'));
    assert.equal(calls.at(-1)[0], 'restore');
  }
});

test('song title and credits are painted inside landscape and portrait frames in every style', () => {
  for (const [width, height] of [[1920,1080],[1080,1920]]) for (let style = 0; style < STYLES.length; style++) {
    const text = [];
    const c = new Proxy({}, {
      get: (_, key) => key === 'createRadialGradient' ? () => ({addColorStop(){}}) : key === 'fillText' ? (...args) => text.push(args) : () => {},
      set: () => true,
    });
    draw({width,height,getContext:()=>c}, 0, null, null, {style,color:'#c5fa75',strength:70,darkness:45,positionX:50,positionY:50,songTitle:'測試歌曲',lyricist:'甲',composer:'乙'});
    assert.deepEqual(text.slice(-3).map(line=>line[0]), ['測試歌曲','作詞：甲','作曲：乙']);
    for (const [,x,y] of text.slice(-3)) assert.ok(x > 0 && x < width && y > 0 && y < height);
  }
});
