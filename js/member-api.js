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
