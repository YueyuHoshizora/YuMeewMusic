import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const secondaryPages = [
  "settings.html",
  "subtitle-editor.html",
  "converter.html",
  "video-editor.html",
  "image-video.html",
  "vocal-separator.html",
  "text-to-image.html",
  "video-generator.html",
];

test("secondary pages use the logo as their only header return control", () => {
  for (const page of secondaryPages) {
    const html = readFileSync(page, "utf8");
    const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0] || "";
    assert.match(header, /<a[^>]*class="brand"[^>]*href="\.\/"|<a[^>]*href="\.\/"[^>]*class="brand"/, page);
    assert.doesNotMatch(header, />\s*← 返回主畫面\s*</, page);
  }
});
