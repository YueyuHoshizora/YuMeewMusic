import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pages = [
  "index.html",
  "account.html",
  "admin.html",
  "settings.html",
  "subtitle-editor.html",
  "converter.html",
  "video-editor.html",
  "image-video.html",
  "vocal-separator.html",
  "music-rating.html",
  "suno-tool.html",
  "image-generator.html",
  "video-generator.html",
  "ai-mastering.html",
];

test("every page loads the AdSense publisher script once", () => {
  for (const page of pages) {
    const html = readFileSync(page, "utf8");
    const matches = html.match(/<script async src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-7132586781018963" crossorigin="anonymous"><\/script>/g) || [];
    assert.equal(matches.length, 1, page);
  }
});

test("every page presents and dismisses the shared feature loading screen", () => {
  for (const page of pages) {
    const html = readFileSync(page, "utf8");
    assert.match(html, /<body[^>]*aria-busy="true"/, page);
    assert.match(html, /id="feature-loading"[^>]*role="status"/, page);
    assert.match(html, /src="\.\/js\/loading-screen\.js"/, page);
  }
  const script = readFileSync("js/loading-screen.js", "utf8");
  const css = readFileSync("css/style.css", "utf8");
  assert.match(script, /DOMContentLoaded/);
  assert.match(script, /classList\.add\("is-complete"\)/);
  assert.match(css, /\.feature-loading\s*\{[^}]*radial-gradient\([^}]*var\(--primary\)/s);
  assert.match(css, /\.feature-loading-card\s*\{[^}]*background:\s*linear-gradient\([^}]*var\(--primary\)/s);
  assert.match(css, /\.feature-loading-card strong\s*\{[^}]*color:\s*var\(--primary-text\)/s);
});

test("large saved media restores outside the initial render path", () => {
  for (const file of ["js/app.js", "js/video-editor.js", "js/vocal-separator.js", "js/image-generator.js", "js/video-generator.js"]) {
    assert.match(readFileSync(file, "utf8"), /requestIdleCallback/, file);
  }
  const generator = readFileSync("js/video-generator.js", "utf8");
  assert.match(generator, /loadGenerationHistory\(\)\.then\(async \(\) => \{[\s\S]*restorePendingGeneration\(\)[\s\S]*restoreWhenIdle\(\(\) => restoreLastGeneratedVideo\(\)\)/);
  assert.doesNotMatch(generator, /syncDraftStatus\(\);\s*void restoreCharacterTemplates\(\);\s*void restoreLastGeneratedVideo\(\)/);
});



test("production build minifies JavaScript and CSS without rewriting source files", () => {
  const build = readFileSync("scripts/build.js", "utf8");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(build, /minifyJavaScript/);
  assert.match(build, /minifyCss/);
  assert.match(build, /from "esbuild"/);
  assert.match(build, /from "lightningcss"/);
  assert.ok(packageJson.devDependencies.esbuild);
  assert.ok(packageJson.devDependencies.lightningcss);
  assert.ok(packageJson.dependencies["@supabase/supabase-js"]);
  assert.match(build, /bundleJavaScript/);
  assert.match(build, /vendor\/supabase\.min\.mjs/);
});

test("GitHub Pages installs and runs the minifying production build", () => {
  const workflow = readFileSync(".github/workflows/pages.yml", "utf8");
  assert.match(workflow, /cache: npm/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /name: Build and minify static website\s+run: npm run build/);
  assert.match(workflow, /path: dist/);
});
