# Supabase 會員服務設定

## 1. 建立資料表

在 Supabase Dashboard 的 SQL Editor 執行：

`migrations/20260915000000_member_credits.sql`

這會建立會員資料、剩餘額度、儲值／消費紀錄、註冊初始化 trigger，以及僅供可信任後端使用的交易函式。

## 2. 啟用 Google OAuth

1. 在 Google Cloud 建立 Web application OAuth client。
2. Google 的 Authorized redirect URI 填入 Supabase Dashboard 顯示的 callback URL，通常為 `https://<project-ref>.supabase.co/auth/v1/callback`。
3. 在 Supabase Dashboard 的 **Authentication > Providers > Google** 填入 Google Client ID 與 Client Secret。
4. 在 **Authentication > URL Configuration** 將 `https://ezmusic.yustellar.idv.tw/account.html` 加入 Redirect URLs。本機測試可另外加入 `http://localhost:3000/account.html`。

Google Client Secret 只放在 Supabase Dashboard，不能寫入本專案。

## 3. 設定前端公開金鑰

修改 `js/supabase-config.js`：

```js
export const SUPABASE_URL = "https://<project-ref>.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "<publishable-key>";
```

這兩個值設計上可公開。請勿放入 Supabase secret key 或 `service_role` key。

## 4. 後端記錄額度

可信任的 Worker 或其他後端可使用 Supabase `service_role` 呼叫：

```sql
select public.record_credit_transaction(
  p_user_id := '<會員 UUID>',
  p_kind := 'topup',
  p_amount := 100,
  p_description := '儲值 100 點',
  p_reference_id := '<付款平台唯一交易編號>'
);
```

- 儲值：`topup`，金額為正數。
- 消費：`consumption`，金額為負數。
- 退款：`refund`，金額為正數。
- 人工作業：`adjustment`，金額可正可負。

`p_reference_id` 具備每位會員內的唯一限制，重複請求會回傳原紀錄，避免重複扣款或儲值。交易函式會鎖定並同步更新餘額，且不允許扣成負數。
