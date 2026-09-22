import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { presentRating, ratingVerdict, scoreToPercent } from "../js/music-rating-core.js";

test("APEX 1–5 aesthetic scores are mapped to 0–100", () => {
  assert.equal(scoreToPercent(1), 0);
  assert.equal(scoreToPercent(3), 50);
  assert.equal(scoreToPercent(5), 100);
});

test("song rating uses all five aesthetic dimensions equally", () => {
  const result = presentRating({ coherence: 1, musicality: 2, memorability: 3, clarity: 4, naturalness: 5, streams: 55.5, likes: 44.5 });
  assert.equal(result.overall, 50);
  assert.deepEqual(result.metrics.map(metric => metric.score), [0, 25, 50, 75, 100]);
  assert.equal(result.streams, 55.5);
  assert.equal(result.likes, 44.5);
});

test("song rating page is linked and deployable", () => {
  assert.match(readFileSync("index.html", "utf8"), /<details class="tools-menu">[\s\S]*href="\.\/converter\.html"[\s\S]*href="\.\/music-rating\.html"[\s\S]*href="\.\/suno-tool\.html"[\s\S]*<\/details>/);
  assert.match(readFileSync("music-rating.html", "utf8"), /APEX 正式評分模型/);
  assert.match(readFileSync("music-rating.html", "utf8"), /id="rating-suno-url"[^>]*https:\/\/suno\.com\/s\/\.\.\./);
  const script = readFileSync("js/music-rating.js", "utf8");
  assert.match(script, /resolveSunoAudio/);
  assert.doesNotMatch(script, /loadStoredMedia/);
  assert.match(readFileSync("music-rating.html", "utf8"), /data-rating-mode="single"[\s\S]*data-rating-mode="compare"/);
  assert.match(readFileSync("music-rating.html", "utf8"), /id="rating-suno-url-a"[\s\S]*id="rating-suno-url-b"/);
  assert.match(script, /renderComparison/);
  assert.match(script, /優勢/);
  assert.match(script, /可改善/);
  assert.match(readFileSync("scripts\/build.js", "utf8"), /music-rating\.html/);
  assert.equal(ratingVerdict(85), "表現非常突出");
});

test("comparison mode reserves more room for two audio players", () => {
  const css = readFileSync("css/music-rating.css", "utf8");
  assert.match(css, /\.rating-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 260px/);
  assert.match(css, /\.rating-compare-files > article\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.rating-compare-files audio\s*\{[^}]*max-width:\s*100%/);
});

