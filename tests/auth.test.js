import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const allPages = [
  "index.html", "account.html", "admin.html", "settings.html", "subtitle-editor.html", "converter.html",
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

test("administrator page manages margin, member top-ups and provider API keys through the Worker", () => {
  const html = readFileSync("admin.html", "utf8");
  const script = readFileSync("js/admin.js", "utf8");
  const api = readFileSync("js/member-api.js", "utf8");
  const providerBilling = readFileSync("js/provider-billing.js", "utf8");
  for (const label of ["儲值換算設定", "會員人工加值", "計費設定", "平台 API KEY"]) assert.match(html, new RegExp(label));
  for (const panel of ["margin-settings", "member-topup", "billing-settings", "platform-api-keys"]) assert.match(html, new RegExp(`data-admin-panel="${panel}"`));
  assert.match(html, /class="panel admin-sidebar"[\s\S]*role="tablist"/);
  assert.match(script, /function selectAdminPanel\(panelId\)[\s\S]*button\.dataset\.adminPanel[\s\S]*panel\.hidden = panel\.id !== panelId/);
  assert.match(script, /function showBillingModel\(model\)[\s\S]*fields\.hidden = !selected[\s\S]*input\.disabled = !selected/);
  assert.match(html, /id="margin-percent"[^>]*min="0"[^>]*max="99"[^>]*step="0\.01"/);
  assert.match(html, /id="admin-topup-amount"[^>]*step="0\.01"/);
  assert.match(html, /id="billing-model"[\s\S]*value="minimax-h3">MiniMax H3/);
  assert.match(html, /value="seedance-2-0">Seedance 2\.0/);
  assert.match(html, /value="seedance-2-5">Seedance 2\.5/);
  assert.match(html, /value="veo-3-1">Veo 3\.1/);
  for (const value of ["0.303", "0.4651", "1", "2.5", "5.0761"]) assert.match(html, new RegExp(`value="${value.replace(".", "\\.")}"`));
  assert.match(html, /name="roundUpDecimals"[^>]*type="number"[^>]*value="2"[^>]*readonly/);
  assert.match(html, /基本係數 × 解析度倍率[\s\S]*無條件進位至小數第二位[\s\S]*再乘以影片秒數/);
  assert.match(html, /data-billing-fields="seedance-2-5"[\s\S]*value="0\.6785"[\s\S]*value="1\.525"/);
  assert.match(html, /data-billing-fields="veo-3-1"[\s\S]*name="audio720PerSecond"[^>]*value="0\.40"[\s\S]*name="audio1080PerSecond"[^>]*value="0\.40"[\s\S]*name="silent720PerSecond"[^>]*value="0\.20"[\s\S]*name="silent1080PerSecond"[^>]*value="0\.20"/);
  assert.match(html, /name="multiplier480"[^>]*>[\s\S]*data-billing-preview="multiplier480"/);
  assert.match(html, /name="multiplier720"[^>]*>[\s\S]*data-billing-preview="multiplier720"/);
  assert.match(script, /function roundBillingUp\(value, decimals = 2\)[\s\S]*Math\.ceil/);
  assert.match(script, /function calculateSeedanceCharge\(base, multiplier, seconds, decimals = 2\)[\s\S]*roundBillingUp\(base \* multiplier, decimals\)[\s\S]*unitRate \* seconds/);
  assert.match(script, /function renderBillingPreview\(model\)[\s\S]*data-billing-preview[\s\S]*calculateSeedanceCharge\(base, multiplier, 1, decimals\)[\s\S]*usd\.format\(total\)/);
  assert.match(html, /音效免費部數[\s\S]*音效超過後每部/);
  for (const value of ["0.08", "0.13", "999", "0.00", "5", "0.04"]) assert.match(html, new RegExp(`value="${value.replace(".", "\\.")}"`));
  assert.match(script, /crypto\.randomUUID\(\)/);
  assert.match(script, /getCurrentSession/);
  assert.match(script, /revalidateAdminPermission/);
  assert.match(script, /verifyAdminAccess\(session\)/);
  for (const operation of ["updateAdminTopupSettings(session", "updateAdminBillingSettings(session", "createAdminTopup(session", "saveAdminApiKey(session", "deleteAdminApiKey(session"]) assert.match(script, new RegExp(operation.replace("(", "\\(")));
  assert.match(script, /import \{ PROVIDER_BILLING_URLS \} from "\.\/provider-billing\.js"/);
  assert.match(providerBilling, /https:\/\/platform\.openai\.com\/settings\/organization\/billing\/overview/);
  assert.match(providerBilling, /https:\/\/platform\.minimax\.io\/console\/recharge-records/);
  assert.match(providerBilling, /https:\/\/console\.byteplus\.com\/finance\/overview/);
  assert.match(providerBilling, /https:\/\/aistudio\.google\.com\/billing\?billing=01FAA5-296897-6F043C&project=yueyuhoshizora/);
  for (const route of ["settings/topup", "admin/billing", "admin/members", "credits/topup", "admin/api-keys"]) assert.match(api, new RegExp(route));
  assert.doesNotMatch(script, /MEMBER_ADMIN_SECRET|PLATFORM_API_KEYS/);
  assert.match(readFileSync("scripts/build.js", "utf8"), /"admin\.html"/);
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
  assert.match(html, /id="topup-twd"[^>]*type="number"[^>]*min="300"[^>]*max="3000"[^>]*step="100"[^>]*value="500"[^>]*inputmode="numeric"/);
  assert.match(html, /id="topup-usd">可取得 \$—/);
  assert.match(html, /id="account-topup"[^>]*disabled>儲值<\/button>/);
  assert.match(script, /fetchMemberAccount/);
  assert.match(script, /fetchUsdTwdExchangeRate/);
  assert.match(script, /topupPayoutRate = 0\.85/);
  assert.match(script, /MIN_TOPUP_TWD = 300/);
  assert.match(script, /MAX_TOPUP_TWD = 3_000/);
  assert.match(script, /amount >= MIN_TOPUP_TWD && amount <= MAX_TOPUP_TWD/);
  assert.match(script, /addEventListener\("change", enforceTopupRange\)/);
  assert.match(script, /TOPUP_PAGE_SIZE = 5/);
  assert.match(script, /CONSUMPTION_PAGE_SIZE = 10/);
  assert.match(script, /Date\.parse\(right\.created_at\) - Date\.parse\(left\.created_at\)/);
  for (const id of ["topup-prev", "topup-page", "topup-next", "consumption-prev", "consumption-page", "consumption-next"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Copyright © 2026 YuMeewMusic/);
  assert.match(html, /href="https:\/\/github\.com\/YueyuHoshizora\/YuMeewMusic\/blob\/main\/PRIVACY-POLICY\.md"[^>]*>隱私權政策<\/a>/);
  assert.match(script, /amount \/ usdTwdRate \* topupPayoutRate/);
  assert.match(script, /Math\.floor\(calculated \* 100\) \/ 100/);
  assert.match(script, /`可取得 \$\{usdFormatter\.format\(total\)\}`/);
  assert.match(script, /platformMarginPercent/);
  assert.match(html, /id="account-admin"[^>]*href="\.\/admin\.html"[^>]*hidden>管理員<\/a>/);
  assert.match(script, /adminLink\.hidden = !account\.isAdmin/);
  for (const page of allPages.filter(page => !["account.html", "admin.html"].includes(page))) assert.doesNotMatch(readFileSync(page, "utf8"), /href="\.\/admin\.html"/, page);
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
