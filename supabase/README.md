# Supabase 會員登入設定

Supabase 只負責 Google OAuth 與登入 Session。會員資料、剩餘額度及交易紀錄保存在 Cloudflare D1，不會建立可由前端查詢的 Supabase 資料表。

## 1. 啟用 Google OAuth

1. 在 Google Cloud 建立 Web application OAuth client。
2. Google 的 Authorized redirect URI 填入 Supabase Dashboard 顯示的 callback URL，通常為 `https://<project-ref>.supabase.co/auth/v1/callback`。
3. 在 Supabase Dashboard 的 **Authentication > Providers > Google** 填入 Google Client ID 與 Client Secret。
4. 在 **Authentication > URL Configuration** 將 `https://the-music.app/account.html` 加入 Redirect URLs。本機測試可另外加入 `http://localhost:3000/account.html`。

Google Client Secret 只放在 Supabase Dashboard，不能寫入本專案。

## 2. 設定前端公開金鑰

修改 `js/supabase-config.js`：

```js
export const SUPABASE_URL = "https://<project-ref>.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "<publishable-key>";
```

這兩個值設計上可公開。請勿放入 Supabase secret key 或 `service_role` key。

## 3. 設定會員 API

部署 `member-api` Worker 與 D1 後，將公開 Worker 網址填入 `js/member-api-config.js`。D1 binding 與 `MEMBER_ADMIN_SECRET` 只存在 Cloudflare Worker，不得加入主網站。
