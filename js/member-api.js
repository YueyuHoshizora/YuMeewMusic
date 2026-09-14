import { MEMBER_API_URL, isMemberApiConfigured } from "./member-api-config.js";

export { isMemberApiConfigured };

export async function fetchMemberAccount(session, { ledger = true } = {}) {
  if (!isMemberApiConfigured()) throw new Error("會員資料服務尚未設定。");
  if (!session?.access_token) throw new Error("請先登入會員帳號。");
  const url = new URL("./v1/account", `${MEMBER_API_URL.replace(/\/+$/, "")}/`);
  url.searchParams.set("ledger", ledger ? "1" : "0");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${session.access_token}`, Accept: "application/json" },
  });
  let result;
  try {
    result = await response.json();
  } catch {
    result = {};
  }
  if (!response.ok) throw new Error(result.message || result.error || `會員資料服務回傳 ${response.status}`);
  return result;
}

export async function fetchUsdTwdExchangeRate() {
  if (!isMemberApiConfigured()) throw new Error("會員資料服務尚未設定。");
  const url = new URL("./v1/exchange-rates/usd-twd", `${MEMBER_API_URL.replace(/\/+$/, "")}/`);
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  let result;
  try {
    result = await response.json();
  } catch {
    result = {};
  }
  if (!response.ok) throw new Error(result.message || result.error || `匯率服務回傳 ${response.status}`);
  return result;
}

async function fetchAdminJson(session, path, { method = "GET", body } = {}) {
  if (!isMemberApiConfigured()) throw new Error("會員資料服務尚未設定。");
  if (!session?.access_token) throw new Error("請先登入會員帳號。");
  const url = new URL(path.replace(/^\/+/, ""), `${MEMBER_API_URL.replace(/\/+$/, "")}/`);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let result;
  try { result = await response.json(); } catch { result = {}; }
  if (!response.ok) throw new Error(result.message || result.error || `管理員服務回傳 ${response.status}`);
  return result;
}

export function fetchAdminTopupSettings(session) {
  return fetchAdminJson(session, "/v1/admin/settings/topup");
}

export function updateAdminTopupSettings(session, marginPercent) {
  return fetchAdminJson(session, "/v1/admin/settings/topup", { method: "PUT", body: { marginPercent } });
}

export function searchAdminMembers(session, query = "") {
  return fetchAdminJson(session, `/v1/admin/members?query=${encodeURIComponent(query)}`);
}

export function createAdminTopup(session, input) {
  return fetchAdminJson(session, "/v1/admin/credits/topup", { method: "POST", body: input });
}

export function listAdminApiKeys(session) {
  return fetchAdminJson(session, "/v1/admin/api-keys");
}

export function saveAdminApiKey(session, provider, apiKey) {
  return fetchAdminJson(session, `/v1/admin/api-keys/${encodeURIComponent(provider)}`, { method: "PUT", body: { apiKey } });
}

export function deleteAdminApiKey(session, provider) {
  return fetchAdminJson(session, `/v1/admin/api-keys/${encodeURIComponent(provider)}`, { method: "DELETE" });
}
