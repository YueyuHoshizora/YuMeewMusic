import { createClient } from "../vendor/supabase.min.mjs";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from "./supabase-config.js";

let client;

export { isSupabaseConfigured };

export function getAuthClient() {
  if (!isSupabaseConfigured()) return null;
  client ||= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "yumeew.auth.v1",
    },
  });
  return client;
}

export async function getCurrentSession() {
  const authClient = getAuthClient();
  if (!authClient) return { session: null, error: null };
  const { data, error } = await authClient.auth.getSession();
  return { session: data.session, error };
}

export async function signInWithGoogle() {
  const authClient = getAuthClient();
  if (!authClient) throw new Error("會員服務尚未設定。");
  const redirectTo = new URL("./account.html", location.href).href;
  const { data, error } = await authClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const authClient = getAuthClient();
  if (!authClient) return;
  const { error } = await authClient.auth.signOut();
  if (error) throw error;
}

export function onAuthStateChange(callback) {
  const authClient = getAuthClient();
  if (!authClient) return () => {};
  const { data } = authClient.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}
