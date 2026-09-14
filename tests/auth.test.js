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
  assert.match(script, /header\.querySelector\("\.header-actions"\) \|\| header/);
  assert.match(script, /fetchMemberAccount/);
  assert.match(script, /avatar_url/);
});

test("Google OAuth uses a persistent PKCE Supabase session", () => {
  const auth = readFileSync("js/auth.js", "utf8");
  assert.match(auth, /flowType: "pkce"/);
  assert.match(auth, /persistSession: true/);
  assert.match(auth, /provider: "google"/);
  assert.match(auth, /account\.html/);
  const config = readFileSync("js/supabase-config.js", "utf8");
  assert.match(config, /SUPABASE_PUBLISHABLE_KEY = "sb_publishable_/);
  assert.doesNotMatch(config, /eyJ[A-Za-z0-9_-]+\./);
});

test("member center reads the balance, top-up history and consumption history", () => {
  const html = readFileSync("account.html", "utf8");
  const script = readFileSync("js/account.js", "utf8");
  for (const label of ["剩餘額度", "儲值紀錄", "消費紀錄", "使用 Google 登入", "臺灣銀行美元即期匯率"]) assert.match(html, new RegExp(label));
  assert.match(html, /id="topup-twd"[^>]*type="number"[^>]*value="1000"[^>]*inputmode="numeric"/);
  assert.match(html, /id="topup-usd">可取得 \$—/);
  assert.match(html, /id="account-topup"[^>]*disabled>儲值<\/button>/);
  assert.match(script, /fetchMemberAccount/);
  assert.match(script, /fetchUsdTwdExchangeRate/);
  assert.match(script, /TOPUP_PAYOUT_RATE = 0\.85/);
  assert.match(script, /amount \/ usdTwdRate \* TOPUP_PAYOUT_RATE/);
  assert.match(script, /`可取得 \$\{usdFormatter\.format\(total\)\}`/);
  assert.match(script, /中間匯率[\s\S]*85% 計價（平台保留 15%）/);
  assert.match(script, /style: "currency", currency: "USD"/);
  assert.doesNotMatch(script, /\.from\(/);
  const api = readFileSync("js/member-api.js", "utf8");
  assert.match(api, /\/v1\/account/);
  assert.match(api, /\/v1\/exchange-rates\/usd-twd/);
  assert.match(api, /session\.access_token/);
  assert.match(api, /Authorization/);
  assert.equal(existsSync("vendor/supabase-LICENSE"), true);
  assert.match(readFileSync("js/member-status.js", "utf8"), /usdFormatter\.format\(Number\(data\.balance \|\| 0\)\)/);
  assert.match(readFileSync("scripts/build.js", "utf8"), /"account\.html"/);
});

test("the browser reaches credit data only through the member Worker", () => {
  const config = readFileSync("js/member-api-config.js", "utf8");
  assert.match(config, /MEMBER_API_URL = "https:\/\/member-api\.yustellar\.idv\.tw"/);
  assert.doesNotMatch(config, /database_id|MEMBER_ADMIN_SECRET|service_role/i);
  for (const file of ["js/account.js", "js/member-status.js", "js/member-api.js"])
    assert.doesNotMatch(readFileSync(file, "utf8"), /D1Database|MEMBERS_DB|MEMBER_ADMIN_SECRET/, file);
});
