export const CLIENT_ID_HEADER = "X-YuMeew-Client-ID";

const STORAGE_KEY = "yumeew.client-id.v1";
const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/;
let sessionClientId = "";

function createClientId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function getClientId() {
  if (sessionClientId) return sessionClientId;
  try {
    const stored = localStorage.getItem(STORAGE_KEY)?.trim().toLowerCase() || "";
    if (CLIENT_ID_PATTERN.test(stored)) return (sessionClientId = stored);
    sessionClientId = createClientId();
    localStorage.setItem(STORAGE_KEY, sessionClientId);
    return sessionClientId;
  } catch {
    return (sessionClientId ||= createClientId());
  }
}

export function clientIdentityHeaders() {
  return { [CLIENT_ID_HEADER]: getClientId() };
}
