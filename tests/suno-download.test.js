import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("Suno download page resolves, downloads, previews and applies public M4A audio", () => {
  const html = readFileSync("suno-download.html", "utf8");
  const script = readFileSync("js/suno-download.js", "utf8");
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of script.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(ids.includes(id), id);
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#?]+)(?:\?[^"#]*)?"/g)) assert.ok(existsSync(path), path);
  assert.match(html, /id="suno-url"[^>]*placeholder="https:\/\/suno\.com\/s\/\.\.\."/);
  assert.match(html, /id="suno-player"[^>]*controls/);
  assert.match(html, /id="suno-download"[^>]*>下載音樂（M4A）</);
  assert.match(html, /id="suno-apply"[^>]*>套用到主畫面</);
  assert.match(script, /model-proxy\.yustellar\.idv\.tw\/suno\/resolve/);
  assert.match(script, /audioBlob = await readAudioResponse\(await fetch\(result\.audioUrl/);
  assert.match(script, /URL\.createObjectURL\(audioBlob\)/);
  assert.match(script, /saveStoredMedia\("audio", file\)/);
  assert.match(script, /location\.href = "\.\/index\.html"/);
  assert.doesNotMatch(script, /localStorage\.setItem\([^,]+,\s*(?:audioBlob|audioUrl)/);
  assert.match(readFileSync("index.html", "utf8"), /href="\.\/suno-download\.html"[^>]*>Suno 下載<\/a>/);
  assert.match(readFileSync("scripts/build.js", "utf8"), /"suno-download\.html"/);
  assert.match(readFileSync("scripts/serve.js", "utf8"), /"suno-download\.html"/);
});
