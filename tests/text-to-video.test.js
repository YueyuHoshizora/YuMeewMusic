import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("text-to-video page provides a model-ready generation workspace", () => {
  const html = readFileSync("text-to-video.html", "utf8");
  const script = readFileSync("js/text-to-video.js", "utf8");
  const css = readFileSync("css/text-to-video.css", "utf8");
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of script.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(ids.includes(id), id);
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#?]+)(?:\?[^"#]*)?"/g)) assert.ok(existsSync(path), path);
  assert.match(html, /<title>文生影 · YuMeew<\/title>/);
  assert.match(html, /id="video-keywords"[^>]*maxlength="500"/);
  assert.match(html, /id="video-prompt"[^>]*maxlength="2048"/);
  assert.match(html, /id="enhance-video-prompt"[^>]*checked/);
  assert.match(html, /id="video-model"[^>]*disabled[\s\S]*尚未設定模型/);
  assert.match(html, /id="video-api-key"[^>]*disabled>未設定<\/button>/);
  assert.match(html, /id="generate-video"[^>]*disabled>▶ 生成影片<\/button>/);
  assert.match(html, /id="generated-video"[^>]*controls[^>]*playsinline[^>]*hidden/);
  assert.match(html, /id="download-video"[^>]*disabled/);
  assert.match(html, /id="apply-video-background"[^>]*disabled/);
  assert.match(css, /#video-prompt\s*\{[^}]*height:\s*112px/);
  assert.match(script, /applyTheme\(settings\.mode, settings\.theme\)/);
  assert.match(readFileSync("index.html", "utf8"), /href="\.\/text-to-video\.html"[^>]*>文生影<\/a>/);
  assert.match(readFileSync("scripts/build.js", "utf8"), /"text-to-video\.html"/);
  assert.match(readFileSync("scripts/serve.js", "utf8"), /"text-to-video\.html"/);
});
