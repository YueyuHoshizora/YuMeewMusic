import { getCurrentSession } from "./auth.js";
import {
  createAdminTopup, deleteAdminApiKey, fetchAdminTopupSettings, listAdminApiKeys,
  saveAdminApiKey, searchAdminMembers, updateAdminTopupSettings,
} from "./member-api.js";
import { loadSettings } from "./settings.js";
import { applyTheme } from "./themes.js";

applyTheme(loadSettings().mode, loadSettings().theme);
const $ = id => document.getElementById(id);
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const state = { session: null, members: [], selectedUserId: "", apiKeys: [], pendingTopup: null, pendingDeleteProvider: "" };

function setStatus(message, error = false) {
  $("admin-status").textContent = message;
  $("admin-status").classList.toggle("error", error);
}

function showAccess(title, message) {
  $("admin-access").hidden = false;
  $("admin-access").querySelector("h2").textContent = title;
  $("admin-access").querySelector("p").textContent = message;
  $("admin-dashboard").hidden = true;
}

function renderMargin(setting) {
  $("margin-percent").value = String(setting.marginPercent);
  $("margin-preview").textContent = `會員可取得換算金額的 ${Number(setting.payoutPercent).toFixed(2).replace(/\.00$/, "")}%`;
}

function renderMembers() {
  const selected = state.selectedUserId;
  $("member-results").replaceChildren(...state.members.map(member => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `member-result${member.user_id === selected ? " selected" : ""}`;
    const memberName = document.createElement("strong");
    memberName.textContent = member.display_name || "未設定名稱";
    const email = document.createElement("small");
    email.textContent = member.email || member.user_id;
    const balance = document.createElement("b");
    balance.textContent = usd.format(Number(member.balance || 0));
    button.append(memberName, email, balance);
    button.addEventListener("click", () => selectMember(member.user_id));
    return button;
  }));
  if (!state.members.length) $("member-results").textContent = "找不到符合條件的會員。";
}

function selectMember(userId) {
  state.selectedUserId = userId;
  const member = state.members.find(item => item.user_id === userId);
  $("selected-member").textContent = member ? `已選擇：${member.display_name || member.email || member.user_id} · 目前餘額 ${usd.format(Number(member.balance || 0))}` : "尚未選擇會員";
  for (const id of ["admin-topup-amount", "admin-topup-description", "admin-topup-submit"]) $(id).disabled = !member;
  renderMembers();
}

async function loadMembers(query = "") {
  const result = await searchAdminMembers(state.session, query);
  state.members = result.members || [];
  if (!state.members.some(member => member.user_id === state.selectedUserId)) selectMember("");
  else renderMembers();
}

function renderApiKeys() {
  $("admin-api-keys").replaceChildren(...state.apiKeys.map(record => {
    const row = document.createElement("article");
    row.className = "api-key-row";
    const provider = document.createElement("div");
    provider.className = "api-key-provider";
    const heading = document.createElement("div");
    heading.className = "api-key-provider-heading";
    const label = document.createElement("strong");
    label.textContent = record.label;
    heading.append(label);
    if (record.provider === "openai") {
      const billing = document.createElement("a");
      billing.className = "api-key-billing";
      billing.href = "https://platform.openai.com/settings/organization/billing/overview";
      billing.target = "_blank";
      billing.rel = "noopener noreferrer";
      billing.textContent = "加值";
      heading.append(billing);
    }
    const status = document.createElement("small");
    status.textContent = record.configured ? `已設定 ${record.masked}` : "未設定";
    provider.append(heading, status);
    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "new-password";
    input.placeholder = record.configured ? "輸入新金鑰以覆寫" : "輸入 API KEY";
    input.setAttribute("aria-label", `${record.label} API KEY`);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "api-key-save";
    save.textContent = "儲存";
    save.addEventListener("click", () => void saveProviderKey(record, input, save));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "api-key-delete";
    remove.textContent = "刪除";
    remove.disabled = !record.configured;
    remove.addEventListener("click", () => requestDeleteKey(record));
    row.append(provider, input, save, remove);
    return row;
  }));
}

async function refreshApiKeys() {
  const result = await listAdminApiKeys(state.session);
  state.apiKeys = result.keys || [];
  renderApiKeys();
}

async function saveProviderKey(record, input, button) {
  const value = input.value.trim();
  if (!value) return setStatus(`請輸入 ${record.label} API KEY。`, true);
  button.disabled = true;
  try {
    await saveAdminApiKey(state.session, record.provider, value);
    input.value = "";
    await refreshApiKeys();
    setStatus(`${record.label} API KEY 已保存到 KV。`);
  } catch (error) { setStatus(error.message || "API KEY 儲存失敗。", true); }
  finally { button.disabled = false; }
}

function requestDeleteKey(record) {
  state.pendingDeleteProvider = record.provider;
  $("api-key-delete-message").textContent = `確定刪除 ${record.label} 的平台 API KEY？使用帳戶扣點的相關功能將無法呼叫此服務商。`;
  $("api-key-delete-dialog").returnValue = "";
  $("api-key-delete-dialog").showModal();
}

$("margin-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const setting = await updateAdminTopupSettings(state.session, Number($("margin-percent").value));
    renderMargin(setting);
    setStatus("儲值換算比例已更新。最多約五分鐘後套用到既有快取頁面。");
  } catch (error) { setStatus(error.message || "無法更新儲值比例。", true); }
  finally { button.disabled = false; }
});

$("member-search-form").addEventListener("submit", async event => {
  event.preventDefault();
  setStatus("正在搜尋會員…");
  try { await loadMembers($("member-query").value.trim()); setStatus(`找到 ${state.members.length} 位會員。`); }
  catch (error) { setStatus(error.message || "會員搜尋失敗。", true); }
});

$("topup-form").addEventListener("submit", event => {
  event.preventDefault();
  const member = state.members.find(item => item.user_id === state.selectedUserId);
  const amount = Number($("admin-topup-amount").value);
  if (!member || !Number.isFinite(amount) || amount <= 0) return setStatus("請選擇會員並輸入有效的加值金額。", true);
  state.pendingTopup = { member, amount, description: $("admin-topup-description").value.trim() || "管理員人工加值" };
  $("topup-confirm-message").textContent = `確定替 ${member.display_name || member.email || member.user_id} 加值 ${usd.format(amount)}？此操作會寫入永久交易紀錄。`;
  $("topup-confirm-dialog").returnValue = "";
  $("topup-confirm-dialog").showModal();
});

$("topup-confirm-dialog").addEventListener("close", async () => {
  const pending = state.pendingTopup;
  state.pendingTopup = null;
  if ($("topup-confirm-dialog").returnValue !== "confirm" || !pending) return;
  $("admin-topup-submit").disabled = true;
  setStatus("正在寫入會員加值紀錄…");
  try {
    const result = await createAdminTopup(state.session, {
      userId: pending.member.user_id,
      amount: pending.amount,
      description: pending.description,
      referenceId: `admin-${crypto.randomUUID()}`,
    });
    pending.member.balance = result.transaction?.balance_after ?? pending.member.balance;
    $("admin-topup-amount").value = "";
    selectMember(pending.member.user_id);
    setStatus(`已替會員加值 ${usd.format(pending.amount)}。`);
  } catch (error) { setStatus(error.message || "會員加值失敗。", true); }
  finally { $("admin-topup-submit").disabled = !state.selectedUserId; }
});

$("api-key-delete-dialog").addEventListener("close", async () => {
  const provider = state.pendingDeleteProvider;
  state.pendingDeleteProvider = "";
  if ($("api-key-delete-dialog").returnValue !== "confirm" || !provider) return;
  try { await deleteAdminApiKey(state.session, provider); await refreshApiKeys(); setStatus("平台 API KEY 已刪除。"); }
  catch (error) { setStatus(error.message || "API KEY 刪除失敗。", true); }
});

async function initialize() {
  const { session, error } = await getCurrentSession();
  if (error || !session?.user) {
    showAccess("請先登入會員", "請先至會員中心使用具備管理員權限的 Google 帳號登入。");
    setStatus(error?.message || "尚未登入會員帳號。", true);
    return;
  }
  state.session = session;
  try {
    const [setting, members, keys] = await Promise.all([
      fetchAdminTopupSettings(session), searchAdminMembers(session), listAdminApiKeys(session),
    ]);
    renderMargin(setting);
    state.members = members.members || [];
    state.apiKeys = keys.keys || [];
    renderMembers();
    renderApiKeys();
    $("admin-access").hidden = true;
    $("admin-dashboard").hidden = false;
    setStatus("管理員功能已載入。若要加值，請先選擇會員。");
  } catch (adminError) {
    showAccess("無法開啟管理員功能", adminError.message || "目前帳號沒有管理員權限。");
    setStatus(adminError.message || "管理員驗證失敗。", true);
  }
}

void initialize();
