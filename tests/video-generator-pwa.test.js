import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const secondaryPages = [
  "index.html",
  "settings.html",
  "subtitle-editor.html",
  "converter.html",
  "video-editor.html",
  "image-video.html",
  "vocal-separator.html",
  "music-rating.html",
  "suno-tool.html",
  "text-to-image.html",
];

test("only the video generator advertises the installable desktop app", () => {
  const generator = readFileSync("video-generator.html", "utf8");
  assert.match(generator, /rel="manifest" href="\.\/video-generator\.webmanifest"/);
  assert.match(generator, /id="install-video-generator"[^>]*hidden/);
  assert.match(generator, /src="\.\/js\/video-generator-pwa\.js"/);
  for (const page of secondaryPages) {
    const html = readFileSync(page, "utf8");
    assert.doesNotMatch(html, /rel="manifest"|install-video-generator|video-generator-pwa\.js/, page);
  }
});

test("video generator manifest launches only the generator as a standalone app", () => {
  const manifest = JSON.parse(readFileSync("video-generator.webmanifest", "utf8"));
  assert.equal(manifest.id, "./video-generator.html");
  assert.equal(manifest.start_url, "./video-generator.html");
  assert.equal(manifest.scope, "./video-generator.html");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ["192x192", "512x512", "512x512"]);
  assert.equal(manifest.icons.at(-1).purpose, "maskable");
  for (const icon of manifest.icons) assert.equal(existsSync(icon.src.replace("./", "")), true, icon.src);
});

test("desktop install control uses the browser PWA prompt and stays hidden on mobile", () => {
  const script = readFileSync("js/video-generator-pwa.js", "utf8");
  assert.match(script, /beforeinstallprompt/);
  assert.match(script, /mobileUserAgent/);
  assert.match(script, /installPrompt\.prompt\(\)/);
  assert.match(script, /installPrompt\.userChoice/);
  assert.match(script, /appinstalled/);
  assert.match(script, /brandLink\?\.removeAttribute\("href"\)/);
  assert.match(script, /brandLink\?\.setAttribute\("aria-current", "page"\)/);
});

test("production build publishes the PWA assets and AdSense declaration", () => {
  const build = readFileSync("scripts/build.js", "utf8");
  for (const asset of ["video-generator.webmanifest", "ads.txt", "icons"]) assert.match(build, new RegExp(`"${asset}"`));
  assert.match(readFileSync("service-worker.js", "utf8"), /"manifest"/);
});
