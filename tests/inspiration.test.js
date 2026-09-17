import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("inspiration chat page is linked, built and served", () => {
  assert.match(
    readFileSync("index.html", "utf8"),
    /href="\.\/ai-mastering\.html">[\s\S]*?<\/a>\s*<a href="\.\/inspiration\.html">[\s\S]*?靈感激發[\s\S]*?<\/a>\s*<\/nav>/,
  );
  assert.match(readFileSync("scripts/build.js", "utf8"), /"ai-mastering\.html", "inspiration\.html"/);
  assert.match(readFileSync("scripts/build.js", "utf8"), /"css\/ai-mastering\.css", "css\/inspiration\.css"/);
  assert.match(readFileSync("scripts/serve.js", "utf8"), /"ai-mastering\.html", "inspiration\.html", "favicon\.svg"/);
});

test("inspiration chat page has the expected chat UI elements", () => {
  const html = readFileSync("inspiration.html", "utf8");
  assert.match(html, /id="inspiration-form"/);
  assert.match(html, /id="inspiration-input"[^>]*maxlength="4000"/);
  assert.match(html, /id="inspiration-send"/);
  assert.match(html, /id="inspiration-clear"/);
  assert.match(html, /id="inspiration-messages"[^>]*role="log"/);
  assert.match(html, /id="inspiration-error"[^>]*role="alert"/);
  assert.match(html, /<link rel="stylesheet" href="\.\/css\/inspiration\.css" \/>/);
  assert.match(html, /<script type="module" src="\.\/js\/inspiration\.js"><\/script>/);
});

test("inspiration chat calls the dedicated Worker and never the user's own OpenRouter key", () => {
  const script = readFileSync("js/inspiration.js", "utf8");
  assert.match(script, /https:\/\/inspiration-chat\.yustellar\.idv\.tw\/api\/inspiration\/chat/);
  assert.doesNotMatch(script, /OPENROUTER_API_KEY|openrouter\.ai/i);
  assert.match(script, /COOLDOWN_SECONDS\s*=\s*5/);
  assert.match(script, /MAX_MESSAGE_CHARS\s*=\s*4000/);
});

test("conversations stay in memory only and are never written to browser storage", () => {
  const script = readFileSync("js/inspiration.js", "utf8");
  assert.doesNotMatch(script, /localStorage\.setItem/);
  assert.doesNotMatch(script, /sessionStorage\.setItem/);
  assert.doesNotMatch(script, /\bindexedDB\.|saveStoredMedia\(/);
});

test("aborting a reply keeps whatever text streamed in so far instead of losing it silently", () => {
  const script = readFileSync("js/inspiration.js", "utf8");
  assert.match(script, /AbortError/);
  assert.match(script, /已中止/);
});

test("long conversations get auto-compressed instead of hitting a hard length wall", () => {
  const script = readFileSync("js/inspiration.js", "utf8");
  assert.match(script, /COMPRESS_TRIGGER_CHARS\s*=\s*12000/);
  assert.match(script, /COMPRESS_TRIGGER_MESSAGES\s*=\s*30/);
  assert.match(script, /COMPRESS_KEEP_RECENT\s*=\s*6/);
  assert.match(script, /async function compressConversation\(/);
  // 壓縮只能在一輪對話「已經結束」時觸發，不能砍到還沒回覆完的半截對話
  assert.match(script, /if \(activeController \|\| compressing\) return;/);
});

test("the 限制 panel on the page explains auto-compression instead of telling users to start over", () => {
  const html = readFileSync("inspiration.html", "utf8");
  assert.match(html, /自動把較舊的內容濃縮成摘要/);
  assert.doesNotMatch(html, /超過請重新整理頁面開新對話/);
});
