# Worker 事件與限額

本文件記錄 YuMeew 使用的 Cloudflare Workers、公開事件與目前限額，方便日後維護。正式網站來源固定為 `https://ezmusic.yustellar.idv.tw`。

## 限額摘要

| 功能 | Worker／路徑 | 限額 | 計數方式 |
| --- | --- | --- | --- |
| Flux 圖片生成 | `flux-klein` `POST /generate` | 每 2 分鐘 1 次 | IP；Durable Object 精確冷卻 |
| Flux 題詞補全 | `flux-klein` `POST /autocomplete` | 每分鐘 10 次 | IP；Workers Rate Limiting Binding |
| 分鏡 AI 分析 | `storyboard-checker` `POST /api/storyboard/check` | 每 5 分鐘 1 次 | IP；Durable Object 精確冷卻 |
| 歌詞辨識 | `lyrics-transcriber` `POST /` | 每分鐘 1 次 | IP；Workers Rate Limiting Binding |
| Suno 解析 | `model-proxy` `POST /suno/resolve` | 每分鐘 10 次 | IP；Workers Rate Limiting Binding |
| 影片／圖片生成 | `model-proxy` `POST /*/video/generate`、`POST /openai/image/generate` | 每分鐘 10 次 | IP；Workers Rate Limiting Binding |
| 資源上傳 | `model-proxy` `POST /resources/upload` | 每分鐘 20 次 | IP；Workers Rate Limiting Binding |
| 會員影片額度預扣 | `member-api` `POST /v1/credits/video-reservations` | 每分鐘 60 次 | IP；D1 原子檢查會員可用餘額 |
| 預扣確認／釋放 | `member-api` `POST /v1/internal/credits/reservations` | 每分鐘 30 次 | 服務 IP；HMAC 驗證 |
| 靈感聊天 | `inspiration-chat` `POST /api/inspiration/chat` | 每 5 秒 1 次 | IP；Durable Object 精確冷卻 |

所有 `OPTIONS` 預檢、健康檢查、模型與短效資源讀取、影片／查詢任務的查詢與下載目前不計入上述限額。

超過限制時回傳 HTTP `429 Too Many Requests`，回應包含：

- `Retry-After`：建議等待秒數。
- `code: "rate_limit_exceeded"`：供前端辨識。
- `retryAfter`：剩餘等待秒數。
- 可直接顯示的中文 `error` 訊息。

## model-proxy

正式端點：`https://model-proxy.yustellar.idv.tw`

| 事件 | 用途 | 限額／附註 |
| --- | --- | --- |
| `OPTIONS *` | CORS 預檢 | 不計入 |
| `GET /health` | 服務健康檢查 | 不計入 |
| `POST /resources/upload` | 上傳圖片、音訊或影片參考資源 | 每分鐘 20 次；每個檔案最多 50 MB（邊讀邊計算位元組數強制執行，不受 `Content-Length` 是否誠實回報影響）；不接受 `image/svg+xml`，避免瀏覽器直接開啟資源網址時執行內嵌腳本 |
| `GET /resources/:id` | 模型服務讀取短效參考資源 | 不計入；資源預設保留 2 小時 |
| `GET /models/:filename` | 下載瀏覽器端允許清單內的模型 | 不計入 |
| `POST /suno/resolve` | 解析公開 Suno 分享連結 | 每分鐘 10 次 |
| `POST /openai/image/generate` | 建立 OpenAI 圖片生成請求 | 每分鐘 10 次 |
| `POST /minimax/video/generate` | 建立 MiniMax 影片任務 | 每分鐘 10 次 |
| `POST /minimax/video/query` | 查詢 MiniMax 任務 | 不計入 |
| `POST /minimax/video/download` | 代理下載 MiniMax 結果 | 不計入 |
| `POST /byteplus/video/generate` | 建立 Seedance 影片任務 | 每分鐘 10 次 |
| `POST /byteplus/video/query` | 查詢 Seedance 任務 | 不計入 |
| `POST /byteplus/video/download` | 代理下載 Seedance 結果 | 不計入 |
| `POST /google/video/generate` | 建立 Veo 影片任務 | 每分鐘 10 次 |
| `POST /google/video/query` | 查詢 Veo 任務 | 不計入 |
| `POST /google/video/download` | 代理下載 Veo 結果 | 不計入 |
| Cron `0 * * * *` | 每小時刪除過期參考資源 | 排程事件 |

Rate Limiting Binding：

- `SUNO_RATE_LIMITER`，namespace `7132501`，`10 / 60 秒`（`/suno/resolve`）。
- `GENERATION_RATE_LIMITER`，namespace `7132504`，`10 / 60 秒`（三個服務商的 `/*/video/generate` 與 `/openai/image/generate` 共用同一個限流器）。
- `UPLOAD_RATE_LIMITER`，namespace `7132505`，`20 / 60 秒`（`/resources/upload`）。

帳戶扣點的影片任務會在呼叫模型前建立十分鐘 D1 預扣，取得任務 ID 後正式扣款；模型拒絕建立任務時立即釋放。成功任務的預扣識別碼與服務商對應會在 KV 保留兩小時，供後續查詢與下載授權使用。

## flux-klein

正式端點：`https://flux-klein-worker.yustellar.idv.tw`

| 事件 | 用途 | 限額／附註 |
| --- | --- | --- |
| `OPTIONS *` | CORS 預檢 | 不計入 |
| `POST /autocomplete` | 將零散詞語組成題詞 | 每分鐘 10 次 |
| `POST /generate` | 使用 Flux.2 Klein 4B 生成圖片 | 每 2 分鐘 1 次 |

題詞補全 Binding：`AUTOCOMPLETE_RATE_LIMITER`，namespace `7132502`，`10 / 60 秒`。

圖片生成使用 `GENERATION_COOLDOWN` Durable Object。成功取得額度時立即開始 120 秒冷卻；失敗或無效的請求在完成基本參數驗證前不會占用冷卻。

## lyrics-transcriber

正式端點：`https://lyrics-transcriber.yustellar.idv.tw`

| 事件 | 用途 | 限額／附註 |
| --- | --- | --- |
| `OPTIONS /` | CORS 預檢 | 不計入 |
| `GET /` | 模型、模式與服務狀態 | 不計入 |
| `POST /` | 接收人聲音訊與完整歌詞並產生 SRT | 每分鐘 1 次；音訊最多 20 MB |

歌詞辨識 Binding：`LYRICS_RATE_LIMITER`，namespace `7132503`，`1 / 60 秒`。檔案、歌詞與基本參數通過驗證後才會計入。

## storyboard-checker

正式端點：`https://storyboard-checker.yustellar.idv.tw`

| 事件 | 用途 | 限額／附註 |
| --- | --- | --- |
| `OPTIONS *` | CORS 預檢 | 不計入 |
| `GET /` | 服務與模型狀態 | 不計入 |
| `POST /api/storyboard/check` | 使用 AI 分析分鏡合理性 | 每 5 分鐘 1 次；單次最多 100 個 Scene |
| `POST /api/storyboard/check/status` | 舊佇列狀態端點 | 已停用，固定回傳 410；不計入 |

分鏡分析使用 `STORYBOARD_COOLDOWN` Durable Object。分鏡資料通過驗證後才會開始 300 秒冷卻。

## inspiration-chat

正式端點：`https://inspiration-chat.yustellar.idv.tw`

| 事件 | 用途 | 限額／附註 |
| --- | --- | --- |
| `OPTIONS *` | CORS 預檢 | 不計入 |
| `GET /` | 服務資訊 | 不計入 |
| `POST /api/inspiration/chat` | 代理呼叫 OpenRouter 的 `nex-agi/nex-n2.5-pro:free`，以 SSE 串流回覆 | 每 5 秒 1 次；單次最多 40 則訊息、單則最多 4000 字、總長最多 20000 字 |

聊天請求使用 `INSPIRATION_COOLDOWN` Durable Object。冷卻時間刻意設為全站最短的 5 秒，因為這是對話式介面，使用者本來就會每隔幾秒送出一則訊息，不同於一次性生成類工具。

前端（`inspiration.html`／`js/inspiration.js`）會在對話累積到約 12000 字或 30 則訊息時，主動把較舊的內容送一次請求給這個端點濃縮成摘要，只保留最近幾輪逐字內容，讓使用者可以理論上無限聊下去而不用手動開新對話；這次「壓縮請求」跟一般聊天訊息共用同一個端點與同一顆冷卻，Worker 端完全無感、不需要另外處理。上面的 40 則訊息／20000 字上限因此在正常使用下很少會被真的打到，主要是防止繞過前端直接打 API 的濫用情境。

## 維護注意事項

- Workers Rate Limiting Binding 的計數器由 Cloudflare 各節點維護，適合限制突發流量，但不是精確計費系統。
- 2 分鐘與 5 分鐘限制使用 SQLite Durable Objects，避免 60 秒週期無法表達較長冷卻時間。
- 限流鍵只使用 `CF-Connecting-IP`（Cloudflare 邊緣網路自行填入，客戶端無法偽造）。過去曾額外混入前端在 `localStorage` 產生、透過 `X-YuMeew-Client-ID` 傳送的瀏覽器識別碼，用意是讓共用網路的不同瀏覽器分開計數；但這個值完全由前端自行產生、沒有簽章也沒有驗證，攻擊者只要每次請求換一個新的合法格式字串，就能讓限流器把每次請求都當成「新使用者」而完全繞過限制。弱點掃描發現此問題後已改為只用 IP 當限流鍵；`X-YuMeew-Client-ID` header 仍會被接受（CORS 允許清單保留），但不再影響限流判斷。
- `Origin` 限制與頻率限制分開運作。請求必須先通過正式網站來源檢查。
- 修改數值時，需同步更新 Worker 程式、`wrangler.jsonc`、測試與本文件。
