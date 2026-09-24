import { getCurrentSession, isSupabaseConfigured, onAuthStateChange, signInWithGoogle, signOut } from "./auth.js";
import { fetchMemberAccount, fetchUsdTwdExchangeRate, isMemberApiConfigured } from "./member-api.js";
import { loadSettings } from "./settings.js";
import { applyTheme } from "./themes.js";
import { locale, t } from "./i18n.js";

const appearance = loadSettings();
applyTheme(appearance.mode, appearance.theme);

const setupPanel = document.getElementById("account-setup");
const signedOutPanel = document.getElementById("account-signed-out");
const signedInPanel = document.getElementById("account-signed-in");
const status = document.getElementById("account-status");
const loginButton = document.getElementById("google-login");
const logoutButton = document.getElementById("account-logout");
const adminLink = document.getElementById("account-admin");
const avatar = document.getElementById("account-avatar");
const name = document.getElementById("account-name");
const email = document.getElementById("account-email");
const balance = document.getElementById("account-balance");
const topupTwd = document.getElementById("topup-twd");
const topupUsd = document.getElementById("topup-usd");
const topupExchangeNote = document.getElementById("topup-exchange-note");
const topupRows = document.getElementById("topup-rows");
const consumptionRows = document.getElementById("consumption-rows");
const TOPUP_PAGE_SIZE = 5;
const CONSUMPTION_PAGE_SIZE = 10;
const ledgerViews = {
  topup: {
    container: topupRows,
    previous: document.getElementById("topup-prev"),
    next: document.getElementById("topup-next"),
    indicator: document.getElementById("topup-page"),
    pageSize: TOPUP_PAGE_SIZE,
    page: 1,
    entries: [],
    emptyMessage: "目前沒有儲值紀錄",
  },
  consumption: {
    container: consumptionRows,
    previous: document.getElementById("consumption-prev"),
    next: document.getElementById("consumption-next"),
    indicator: document.getElementById("consumption-page"),
    pageSize: CONSUMPTION_PAGE_SIZE,
    page: 1,
    entries: [],
    emptyMessage: "目前沒有消費紀錄",
  },
};
let usdTwdRate = 0;
const MIN_TOPUP_TWD = 300;
const MAX_TOPUP_TWD = 3_000;
let topupPayoutRate = 0.85;
let topupMarginPercent = 15;
const usdFormatter = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const setStatus = (message, error = false) => {
  status.textContent = message;
  status.classList.toggle("error", error);
};

function setVisible(panel) {
  for (const item of [setupPanel, signedOutPanel, signedInPanel]) item.hidden = item !== panel;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(locale, {
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

function safeResultUrl(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "");
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function appendLedgerItem(cell, entry) {
  const fallback = ({ topup: "儲值", consumption: "消費", refund: "退款", adjustment: "額度調整" }[entry.kind] || entry.kind);
  const modelName = entry.model_name || entry.description || fallback;
  const taskId = typeof entry.task_id === "string" ? entry.task_id.trim() : "";
  if (!taskId) {
    cell.textContent = modelName;
    return;
  }
  const item = document.createElement("span");
  item.className = "ledger-item";
  const model = document.createElement("span");
  model.textContent = modelName;
  item.append(model);
  const resultUrl = safeResultUrl(entry.result_url);
  const task = document.createElement(resultUrl ? "a" : "span");
  task.className = "ledger-task-id";
  task.textContent = taskId;
  if (resultUrl) {
    task.href = resultUrl;
    task.target = "_blank";
    task.rel = "noopener noreferrer";
    task.title = "在新分頁開啟生成結果";
  }
  item.append(task);
  cell.append(item);
}

function renderLedgerPage(view) {
  const totalPages = Math.max(1, Math.ceil(view.entries.length / view.pageSize));
  view.page = Math.min(Math.max(view.page, 1), totalPages);
  view.container.replaceChildren();
  if (!view.entries.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "ledger-empty";
    cell.textContent = view.emptyMessage;
    row.append(cell);
    view.container.append(row);
  } else {
    const start = (view.page - 1) * view.pageSize;
    for (const entry of view.entries.slice(start, start + view.pageSize)) {
      const row = document.createElement("tr");
      const values = [formatDate(entry.created_at), null, formatUsd(entry.amount, true), formatUsd(entry.balance_after)];
      values.forEach((value, index) => {
        const cell = document.createElement("td");
        if (index === 1) appendLedgerItem(cell, entry);
        else cell.textContent = value;
        if (index >= 2) cell.className = "ledger-number";
        row.append(cell);
      });
      view.container.append(row);
    }
  }
  view.indicator.textContent = view.entries.length ? `第 ${view.page} / ${totalPages} 頁 · 共 ${view.entries.length} 筆` : "共 0 筆";
  view.previous.disabled = view.page <= 1;
  view.next.disabled = view.page >= totalPages;
}

function setLedgerEntries(type, entries, emptyMessage) {
  const view = ledgerViews[type];
  view.entries = [...entries].sort((left, right) => {
    const timeDifference = Date.parse(right.created_at) - Date.parse(left.created_at);
    return Number.isNaN(timeDifference) || timeDifference === 0 ? Number(right.id || 0) - Number(left.id || 0) : timeDifference;
  });
  view.page = 1;
  view.emptyMessage = emptyMessage;
  renderLedgerPage(view);
}

function changeLedgerPage(type, offset) {
  const view = ledgerViews[type];
  view.page += offset;
  renderLedgerPage(view);
}

function updateTopupEstimate() {
  const amount = Number(topupTwd.value);
  const calculated = amount >= MIN_TOPUP_TWD && amount <= MAX_TOPUP_TWD && usdTwdRate > 0 ? amount / usdTwdRate * topupPayoutRate : 0;
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
    const payoutRate = Number(result.payoutRate);
    const marginPercent = Number(result.platformMarginPercent);
    if (!(buy > 0 && sell > 0 && average > 0)) throw new Error("匯率資料無效");
    usdTwdRate = average;
    if (Number.isFinite(payoutRate) && payoutRate >= 0 && payoutRate <= 1) topupPayoutRate = payoutRate;
    if (Number.isFinite(marginPercent) && marginPercent >= 0 && marginPercent <= 99) topupMarginPercent = marginPercent;
    updateTopupEstimate();
    topupExchangeNote.textContent = `中間匯率 ${average.toFixed(3)} × ${(topupPayoutRate * 100).toFixed(2).replace(/\.00$/, "")}% 計價（平台保留 ${topupMarginPercent.toFixed(2).replace(/\.00$/, "")}%）`;
  } catch (error) {
    topupExchangeNote.classList.add("error");
    topupExchangeNote.textContent = error.message || "目前無法取得臺灣銀行匯率。";
  }
}

async function loadAccountData(session) {
  if (!session?.user) {
    adminLink.hidden = true;
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
    image.alt = t("{0}的會員頭像", name.textContent);
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => avatar.replaceChildren(name.textContent.charAt(0)), { once: true });
    avatar.append(image);
  } else avatar.textContent = name.textContent.charAt(0);

  setStatus("正在讀取會員資料…");
  if (!isMemberApiConfigured()) {
    balance.textContent = "—";
    setLedgerEntries("topup", [], "尚無法讀取儲值紀錄");
    setLedgerEntries("consumption", [], "尚無法讀取消費紀錄");
    setStatus("D1 會員資料服務尚未設定，登入功能仍可使用。", true);
    return;
  }
  try {
    const account = await fetchMemberAccount(session);
    balance.textContent = formatUsd(account.balance);
    adminLink.hidden = !account.isAdmin;
    setLedgerEntries("topup", account.topups || [], "目前沒有儲值紀錄");
    setLedgerEntries("consumption", account.consumption || [], "目前沒有消費紀錄");
    setStatus("會員資料已更新。");
  } catch (error) {
    adminLink.hidden = true;
    balance.textContent = "—";
    setLedgerEntries("topup", [], "尚無法讀取儲值紀錄");
    setLedgerEntries("consumption", [], "尚無法讀取消費紀錄");
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
    adminLink.hidden = true;
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
ledgerViews.topup.previous.addEventListener("click", () => changeLedgerPage("topup", -1));
ledgerViews.topup.next.addEventListener("click", () => changeLedgerPage("topup", 1));
ledgerViews.consumption.previous.addEventListener("click", () => changeLedgerPage("consumption", -1));
ledgerViews.consumption.next.addEventListener("click", () => changeLedgerPage("consumption", 1));

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
