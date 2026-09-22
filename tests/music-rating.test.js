import test from "node:test";
import assert from "node:assert/strict";
import { presentRating, scoreToPercent } from "../js/music-rating-core.js";

test("APEX 1–5 aesthetic scores are mapped to 0–100", () => {
  assert.equal(scoreToPercent(1), 0);
  assert.equal(scoreToPercent(3), 50);
  assert.equal(scoreToPercent(5), 100);
});

test("song rating weights musicality and memorability above production quality", () => {
  const result = presentRating({ coherence: 1, musicality: 2, memorability: 3, clarity: 4, naturalness: 5, streams: 55.5, likes: 44.5 });
  assert.equal(result.overall, 45);
  assert.deepEqual(result.metrics.map(metric => metric.score), [0, 25, 50, 75, 100]);
  assert.equal(result.streams, 55.5);
  assert.equal(result.likes, 44.5);
});


