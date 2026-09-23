import test from "node:test";
import assert from "node:assert/strict";
import { estimateVideoGenerationCost, hasSufficientVideoCredit } from "../js/video-billing.js";

test("MiniMax estimate includes output duration and referenced resources", () => {
  const settings = {
    output768PerSecond: .08, output2kPerSecond: .13,
    audioFreeCount: 999, audioOveragePerItem: 0,
    imageFreeCount: 5, imageOveragePerItem: .04,
    video768FreeCount: 0, video768OveragePerItem: .08,
    video2kFreeCount: 0, video2kOveragePerItem: .13,
  };
  const resources = [...Array(7)].map(() => ({ kind: "image" })).concat({ kind: "video" }, { kind: "audio" });
  const result = estimateVideoGenerationCost({ billingId: "minimax-h3", resolution: "768P", duration: 10, resources }, settings);
  assert.ok(Math.abs(result.total - .96) < 1e-9);
  assert.equal(result.outputCost, .8);
  assert.equal(result.resourceCost, .16);
});

test("Seedance rounds the unit rate up before multiplying by duration", () => {
  const result = estimateVideoGenerationCost({ billingId: "seedance-2-5", resolution: "720p", duration: 10 }, {
    basePerSecond: .303, multiplier720: 1.525, roundUpDecimals: 2,
  });
  assert.equal(result.unitRate, .47);
  assert.ok(Math.abs(result.total - 4.7) < 1e-9);
});

test("Veo estimate always uses the audio rate regardless of download audio preference", () => {
  const settings = { audio720PerSecond: .4, audio1080PerSecond: .4 };
  assert.equal(estimateVideoGenerationCost({ billingId: "veo-3-1", resolution: "1080p", duration: 8 }, settings).total, 3.2);
  assert.equal(estimateVideoGenerationCost({ billingId: "veo-3-1", resolution: "1080p", duration: 8, includeAudio: false }, settings).total, 3.2);
});

test("account credit must cover the full video generation cost", () => {
  assert.equal(hasSufficientVideoCredit(4.70, 4.7), true);
  assert.equal(hasSufficientVideoCredit(4.69, 4.7), false);
  assert.equal(hasSufficientVideoCredit("5.00", 4.7), true);
  assert.equal(hasSufficientVideoCredit(undefined, 4.7), false);
});
