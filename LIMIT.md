# Worker 事件與限額

本文件記錄 YuMeew 使用的 Cloudflare Workers、公開事件與目前限額，方便日後維護。正式網站來源固定為 `https://ezmusic.yustellar.idv.tw`。

## 限額摘要

| 功能 | Worker／路徑 | 限額 | 計數方式 |
| --- | --- | --- | --- |
| Flux 圖片生成 | `flux-klein` `POST /generate` | 每 2 分鐘 1 次 | 用戶端 IP；Durable Object 精確冷卻 |
| Flux 題詞補全 | `flux-klein` `POST /autocomplete` | 每分鐘 10 次 | 用戶端 IP；Workers Rate Limiting Binding |
| 分鏡 AI 分析 | `storyboard-checker` `POST /api/storyboard/check` | 每 5 分鐘 1 次 | 用戶端 IP；Durable Object 精確冷卻 |
| 歌詞辨識 | `lyrics-transcriber` `POST /` | 每分鐘 1 次 | 用戶端 IP；Workers Rate Limiting Binding |
| Suno 解析 | `model-proxy` `POST /suno/resolve` | 每分鐘 10 次 | 用戶端 IP；Workers Rate Limiting Binding |

所有 `OPTIONS` 預檢、健康檢查、模型與短效資源讀取、影片生成任務、狀態查詢及下載目前不計入上述限額。

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
| `POST /resources/upload` | 上傳圖片、音訊或影片參考資源 | 不計入頻率限制；每個檔案最多 50 MB |
| `GET /resources/:id` | 模型服務讀取短效參考資源 | 不計入；資源預設保留 2 小時 |
| `GET /models/:filename` | 下載瀏覽器端允許清單內的模型 | 不計入 |
| `POST /suno/resolve` | 解析公開 Suno 分享連結 | 每分鐘 10 次 |
| `POST /minimax/video/generate` | 建立 MiniMax 影片任務 | 不計入 |
| `POST /minimax/video/query` | 查詢 MiniMax 任務 | 不計入 |
| `POST /minimax/video/download` | 代理下載 MiniMax 結果 | 不計入 |
| `POST /byteplus/video/generate` | 建立 Seedance 影片任務 | 不計入 |
| `POST /byteplus/video/query` | 查詢 Seedance 任務 | 不計入 |
| `POST /byteplus/video/download` | 代理下載 Seedance 結果 | 不計入 |
| `POST /google/video/generate` | 建立 Veo 影片任務 | 不計入 |
| `POST /google/video/query` | 查詢 Veo 任務 | 不計入 |
| `POST /google/video/download` | 代理下載 Veo 結果 | 不計入 |
| Cron `0 * * * *` | 每小時刪除過期參考資源 | 排程事件 |

Suno 限速 Binding：`SUNO_RATE_LIMITER`，namespace `7132501`，`10 / 60 秒`。

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

## 維護注意事項

- Workers Rate Limiting Binding 的計數器由 Cloudflare 各節點維護，適合限制突發流量，但不是精確計費系統。
- 2 分鐘與 5 分鐘限制使用 SQLite Durable Objects，避免 60 秒週期無法表達較長冷卻時間。
- 用戶端 IP 由 `CF-Connecting-IP` 取得。同一個公司、學校或共用網路可能共用限額。
- `Origin` 限制與頻率限制分開運作。請求必須先通過正式網站來源檢查。
- 修改數值時，需同步更新 Worker 程式、`wrangler.jsonc`、測試與本文件。
