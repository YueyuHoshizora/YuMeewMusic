import { getCurrentSession, isSupabaseConfigured, onAuthStateChange, signInWithGoogle, signOut } from "./auth.js";
import { fetchMemberAccount, fetchUsdTwdExchangeRate, isMemberApiConfigured } from "./member-api.js";
import { loadSettings } from "./settings.js";
import { applyTheme } from "./themes.js";

const appearance = loadSettings();
applyTheme(appearance.mode, appearance.theme);

const setupPanel = document.getElementById("account-setup");
const signedOutPanel = document.getElementById("account-signed-out");
const signedInPanel = document.getElementById("account-signed-in");
const status = document.getElementById("account-status");
const loginButton = document.getElementById("google-login");
const logoutButton = document.getElementById("account-logout");
const avatar = document.getElementById("account-avatar");
const name = document.getElementById("account-name");
const email = document.getElementById("account-email");
const balance = document.getElementById("account-balance");
const topupTwd = document.getElementById("topup-twd");
const topupUsd = document.getElementById("topup-usd");
const topupExchangeNote = document.getElementById("topup-exchange-note");
const topupRows = document.getElementById("topup-rows");
const consumptionRows = document.getElementById("consumption-rows");
let usdTwdRate = 0;
const MIN_TOPUP_TWD = 300;
const MAX_TOPUP_TWD = 3_000;
const TOPUP_PAYOUT_RATE = 0.85;
const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const setStatus = (message, error = false) => {
  status.textContent = message;
  status.classList.toggle("error", error);
};

function setVisible(panel) {
  for (const item of [setupPanel, signedOutPanel, signedInPanel]) item.hidden = item !== panel;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatUsd(value, signed = false) {
  const amount = Number(value || 0);
  const formatted = usdFormatter.format(Math.abs(amount));
  if (!signed || amount === 0) return amount < 0 ? `-${formatted}` : formatted;
  return `${amount > 0 ? "+" : "-"}${formatted}`;
}

function renderLedger(container, entries, emptyMessage) {
  container.replaceChildren();
  if (!entries.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "ledger-empty";
    cell.textContent = emptyMessage;
    row.append(cell);
    container.append(row);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("tr");
    const values = [
      formatDate(entry.created_at),
      entry.description || ({ topup: "儲值", consumption: "消費", refund: "退款", adjustment: "額度調整" }[entry.kind] || entry.kind),
      formatUsd(entry.amount, true),
      formatUsd(entry.balance_after),
    ];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index >= 2) cell.className = "ledger-number";
      row.append(cell);
    });
    container.append(row);
  }
}

function updateTopupEstimate() {
  const amount = Number(topupTwd.value);
  const calculated = amount >= MIN_TOPUP_TWD && amount <= MAX_TOPUP_TWD && usdTwdRate > 0 ? amount / usdTwdRate * TOPUP_PAYOUT_RATE : 0;
  const total = Math.floor(calculated * 100) / 100;
  topupUsd.textContent = total ? `可取得 ${usdFormatter.format(total)}` : "可取得 $—";
}

function enforceTopupRange() {
  const amount = Number(topupTwd.value);
  if (!(amount >= MIN_TOPUP_TWD)) topupTwd.value = String(MIN_TOPUP_TWD);
  else if (amount > MAX_TOPUP_TWD) topupTwd.value = String(MAX_TOPUP_TWD);
  updateTopupEstimate();
}

async function loadExchangeRate() {
  usdTwdRate = 0;
  updateTopupEstimate();
  topupExchangeNote.classList.remove("error");
  topupExchangeNote.textContent = "正在取得臺灣銀行美元即期匯率…";
  try {
    const result = await fetchUsdTwdExchangeRate();
    const buy = Number(result.buy);
    const sell = Number(result.sell);
    const average = Number(result.average);
    if (!(buy > 0 && sell > 0 && average > 0)) throw new Error("匯率資料無效");
    usdTwdRate = average;
    updateTopupEstimate();
    topupExchangeNote.textContent = `中間匯率 ${average.toFixed(3)} × 85% 計價（平台保留 15%）`;
  } catch (error) {
    topupExchangeNote.classList.add("error");
    topupExchangeNote.textContent = error.message || "目前無法取得臺灣銀行匯率。";
  }
}

async function loadAccountData(session) {
  if (!session?.user) {
    setVisible(signedOutPanel);
    setStatus("登入後即可查看額度與交易紀錄。");
    return;
  }
  setVisible(signedInPanel);
  void loadExchangeRate();
  const user = session.user;
  const metadata = user.user_metadata || {};
  name.textContent = metadata.full_name || metadata.name || "YuMeew 會員";
  email.textContent = user.email || "";
  const avatarUrl = metadata.avatar_url || metadata.picture;
  avatar.replaceChildren();
  if (avatarUrl) {
    const image = new Image();
    image.src = avatarUrl;
    image.alt = `${name.textContent}的會員頭像`;
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => avatar.replaceChildren(name.textContent.charAt(0)), { once: true });
    avatar.append(image);
  } else avatar.textContent = name.textContent.charAt(0);

  setStatus("正在讀取會員資料…");
  if (!isMemberApiConfigured()) {
    balance.textContent = "—";
    renderLedger(topupRows, [], "尚無法讀取儲值紀錄");
    renderLedger(consumptionRows, [], "尚無法讀取消費紀錄");
    setStatus("D1 會員資料服務尚未設定，登入功能仍可使用。", true);
    return;
  }
  try {
    const account = await fetchMemberAccount(session);
    balance.textContent = formatUsd(account.balance);
    renderLedger(topupRows, account.topups || [], "目前沒有儲值紀錄");
    renderLedger(consumptionRows, account.consumption || [], "目前沒有消費紀錄");
    setStatus("會員資料已更新。");
  } catch (error) {
    balance.textContent = "—";
    renderLedger(topupRows, [], "尚無法讀取儲值紀錄");
    renderLedger(consumptionRows, [], "尚無法讀取消費紀錄");
    setStatus(error.message || "目前無法讀取會員資料。", true);
  }
}

loginButton.addEventListener("click", async () => {
  loginButton.disabled = true;
  setStatus("正在前往 Google 登入…");
  try {
    await signInWithGoogle();
  } catch (error) {
    loginButton.disabled = false;
    setStatus(error.message || "無法開啟 Google 登入。", true);
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await signOut();
    setVisible(signedOutPanel);
    setStatus("已登出會員帳號。");
  } catch (error) {
    setStatus(error.message || "登出失敗。", true);
  } finally {
    logoutButton.disabled = false;
  }
});

topupTwd.addEventListener("input", updateTopupEstimate);
topupTwd.addEventListener("change", enforceTopupRange);

async function initialize() {
  if (!isSupabaseConfigured()) {
    setVisible(setupPanel);
    setStatus("等待設定 Supabase 公開連線資訊。");
    return;
  }
  const { session, error } = await getCurrentSession();
  if (error) setStatus(error.message || "無法讀取登入狀態。", true);
  await loadAccountData(session);
  onAuthStateChange(nextSession => void loadAccountData(nextSession));
}

void initialize();
