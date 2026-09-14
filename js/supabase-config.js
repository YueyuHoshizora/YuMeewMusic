// Supabase Project Settings > Data API 裡的公開連線資訊。
// Publishable Key 可放在前端；請勿在此放入 secret key 或 service_role key。
export const SUPABASE_URL = "";
export const SUPABASE_PUBLISHABLE_KEY = "";

export function isSupabaseConfigured() {
  try {
    const url = new URL(SUPABASE_URL);
    return url.protocol === "https:" && SUPABASE_PUBLISHABLE_KEY.trim().length > 20;
  } catch {
    return false;
  }
}
