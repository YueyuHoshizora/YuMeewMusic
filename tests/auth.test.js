import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const allPages = [
  "index.html", "account.html", "settings.html", "subtitle-editor.html", "converter.html",
  "video-editor.html", "image-video.html", "vocal-separator.html", "music-rating.html",
  "suno-tool.html", "image-generator.html", "video-generator.html",
];

test("every page exposes the shared member avatar and balance entry", () => {
  for (const page of allPages) {
    const html = readFileSync(page, "utf8");
    assert.match(html, /src="\.\/js\/member-status\.js"/, page);
  }
  const script = readFileSync("js/member-status.js", "utf8");
  assert.match(script, /className = "member-widget"/);
  assert.match(script, /credit_accounts/);
  assert.match(script, /avatar_url/);
});

test("Google OAuth uses a persistent PKCE Supabase session", () => {
  const auth = readFileSync("js/auth.js", "utf8");
  assert.match(auth, /flowType: "pkce"/);
  assert.match(auth, /persistSession: true/);
  assert.match(auth, /provider: "google"/);
  assert.match(auth, /account\.html/);
  const config = readFileSync("js/supabase-config.js", "utf8");
  assert.match(config, /SUPABASE_PUBLISHABLE_KEY = ""/);
  assert.doesNotMatch(config, /eyJ[A-Za-z0-9_-]+\./);
});

test("member center reads the balance, top-up history and consumption history", () => {
  const html = readFileSync("account.html", "utf8");
  const script = readFileSync("js/account.js", "utf8");
  for (const label of ["剩餘額度", "儲值紀錄", "消費紀錄", "使用 Google 登入"]) assert.match(html, new RegExp(label));
  assert.match(script, /from\("credit_accounts"\)/);
  assert.match(script, /from\("credit_ledger"\)/);
  assert.match(script, /kind === "topup"/);
  assert.match(script, /kind === "consumption"/);
  assert.equal(existsSync("vendor/supabase-LICENSE"), true);
  assert.match(readFileSync("scripts/build.js", "utf8"), /"account\.html"/);
});

test("credit schema protects writes and limits members to their own records", () => {
  const sql = readFileSync("supabase/migrations/20260915000000_member_credits.sql", "utf8");
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /auth\.uid\(\)\) = user_id/);
  assert.match(sql, /record_credit_transaction/);
  assert.match(sql, /revoke all[\s\S]*authenticated/);
  assert.match(sql, /grant execute[\s\S]*service_role/);
  assert.match(sql, /after insert on auth\.users/);
});
