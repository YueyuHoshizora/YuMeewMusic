// Cloudflare Worker 的公開網址。D1 綁定與管理密鑰只存在 Worker 端。
export const MEMBER_API_URL = "https://member-api.the-music.app";

export function isMemberApiConfigured() {
  try {
    return new URL(MEMBER_API_URL).protocol === "https:";
  } catch {
    return false;
  }
}
