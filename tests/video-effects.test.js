import test from "node:test";
import assert from "node:assert/strict";
import { effectDuration, layerEffectState, VIDEO_EFFECTS } from "../js/video-effects.js";

test("every requested video effect is available", () => {
  assert.deepEqual(Object.keys(VIDEO_EFFECTS), [
    "none", "fade", "dissolve", "slide-left", "slide-right", "slide-up", "slide-down",
    "zoom", "blur", "flash-white", "flash-black", "circle", "blinds", "pixelate", "rgb-glitch",
  ]);
});

test("a layer has one independent entrance and exit effect", () => {
  const layer = { type: "video", start: 2, end: 10, enterEffect: "slide-left", exitEffect: "blur", enterDuration: 2, exitDuration: 1 };
  assert.deepEqual(layerEffectState(layer, 2.5), { effect: "slide-left", phase: "enter", progress: .25 });
  assert.deepEqual(layerEffectState(layer, 6), { effect: "none", phase: "steady", progress: 1 });
  assert.deepEqual(layerEffectState(layer, 9.75), { effect: "blur", phase: "exit", progress: .25 });
});

test("effect durations stay within the supported numeric range", () => {
  assert.equal(effectDuration(undefined), 1);
  assert.equal(effectDuration(0), .1);
  assert.equal(effectDuration(.01), .1);
  assert.equal(effectDuration(99), 10);
});
