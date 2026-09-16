# CLAUDE.md

這份文件是給在 YuMeew Music Studio 上工作的 Claude（或其他 AI 協作代理）看的專案指南。人類貢獻者請優先參考 [README.md](./README.md)；本文件著重在「AI 動手改程式前應該知道的事」，並以**安全**為主軸——這個專案處理使用者的媒體檔案、API KEY 與金流額度，任何改動都可能牽動信任邊界，README.md、SECURITY.md 說過的內容不重複展開，但會在相關段落交叉引用。

## 專案是什麼

YuMeew Music Studio 是一個**純前端**的瀏覽器音樂視覺化工作室：原生 HTML、CSS、JavaScript（ES modules），沒有任何前端框架（沒有 React／Vue／Svelte）。使用者在瀏覽器內載入音樂、繪製頻譜／節奏動畫、加字幕，再用瀏覽器原生能力（WebCodecs／MediaBunny 等）編碼輸出成影片或音訊。正式網站：https://ezmusic.yustellar.idv.tw/（自訂網域，部署在 GitHub Pages）。

核心原則：**能在瀏覽器本機完成的事，就不要送到伺服器**。這既是隱私承諾也是安全邊界——每多一個會把資料送出瀏覽器的路徑，就多一個可能外洩或被濫用的攻擊面。改動任何功能前，先確認這個原則有沒有被破壞——詳細的「哪些功能會送出什麼資料」對照表在 README.md 的〈檔案與隱私〉一節，等同於本專案的隱私承諾，改動時要一併更新那張表，並確認 [PRIVACY-POLICY.md](./PRIVACY-POLICY.md) 的措辭還對得上。

## 儲存庫佈局

這個資料夾（`YuMeewMusic`）只是**主站**的 git 儲存庫。同一個資料夾底下還放了五個各自獨立的 git 儲存庫（各自有自己的 `.git`、遠端、CI），它們是主站背後的 Cloudflare Workers，主站的 `.gitignore` 已排除它們（`/member-api/`、`/model-proxy/`、`/flux-klein/`、`/lyrics-transcriber/`、`/storyboard-checker/`），**不要**指望 `git status`／`git add -A` 在主站儲存庫裡能看到它們的變動：

| 目錄 | 遠端 repo | 角色 |
| --- | --- | --- |
| `member-api/` | `YueyuHoshizora/YuMeewMusicMember` | 會員／額度／儲值扣款，Supabase Auth + Cloudflare D1 |
| `model-proxy/` | `model-proxy-worker` | 代理 MiniMax／Seedance／Veo 影片生成、GPT Image 帳戶扣點圖片生成、Suno 連結解析 |
| `flux-klein/` | 獨立 Worker | Flux.2 Klein 4B 圖片生成（免費資源） |
| `lyrics-transcriber/` | 獨立 Worker | AI 字幕辨識 |
| `storyboard-checker/` | 獨立 Worker | 分鏡合理性 AI 分析 |

每個 Worker 子專案自己有一份 `AGENTS.md`，內容是「這個 Worker 自己的規矩」（角色、端點、限流機制、程式碼風格、測試慣例），跟這份 CLAUDE.md 互補、不重複。它們實際存在於磁碟上（只是被主站 `.gitignore` 排除），下面直接匯入內容，方便在主站這邊工作時也能看到：

@member-api/AGENTS.md
@model-proxy/AGENTS.md
@flux-klein/AGENTS.md
@lyrics-transcriber/AGENTS.md
@storyboard-checker/AGENTS.md

改一個功能如果同時牽涉主站與某個 Worker（例如額度計費），要記得這是**兩個獨立的 git 歷史**，分開 commit、分開推送，訊息裡不要假設對方 repo 也一起動了。

主站本身的目錄結構、各獨立工具頁面、19 種節奏動畫清單，請見 README.md 的〈專案結構〉一節，這裡不重複。

## 開發指令

```sh
npm run dev      # node scripts/serve.js，啟動 http://localhost:3000（直接讀原始檔）
npm test         # node --test tests/*.test.js
npm run build    # node scripts/build.js，輸出到 dist/（見下方「建置」）
npm run preview  # node scripts/serve.js --dist，預覽 dist/
```

Node.js 需求：22 以上。**主站沒有任何 npm 執行期相依套件**（`@supabase/supabase-js` 只在建置時被打包進 `vendor/supabase.min.mjs`，執行期直接載入靜態檔案，不會動態 `npm install` 任何東西進使用者瀏覽器——這也是供應鏈安全的一部分，見下方〈安全架構〉）。`devDependencies` 只有 `esbuild` 和 `lightningcss`，純粹是建置工具。

五個 Worker 子專案各自用 `npm test` 跑自己的測試（`member-api` 是 `node --test`，其餘四個是 vitest／`cloudflare:test`，各自的 `AGENTS.md` 有說明），`npm run dev` 是 `wrangler dev`。改 Worker 程式碼後記得進該子目錄單獨跑測試，不會被主站的 `npm test` 一併執行到。

## 架構與慣例

- **每個工具頁面是一組三胞胎**：`X.html` + `css/X.css` + `js/X.js`（例如 `image-generator.html` / `css/image-generator.css` / `js/image-generator.js`）。`css/style.css` 是唯一沒有對應 JS 的檔案，是所有頁面共用的基礎樣式。新增頁面請照這個三胞胎模式，並把它加進 `scripts/build.js`、`scripts/serve.js` 裡的白名單陣列（兩邊都要加，`serve.js` 的 `allowed` 集合和 `build.js` 的 `htmlFiles`／複製清單是各自獨立寫死的，不會自動同步）。
- **開發模式不經過任何 bundler**：`<script type="module">` 直接讀原始 `.js`，瀏覽器原生 ES modules 解析 import。所以本機開發時路徑、副檔名都要精確（沒有 webpack/vite 那種模糊解析）。
- **建置**（`scripts/build.js`）才會用 esbuild／lightningcss 做 minify，並用全站內容的 sha256 雜湊當作版本號，幫每個 `.js`/`.css` 引用加上 `?v=<hash>` 做 cache-busting。加新的靜態檔案（圖示、字型、新頁面）記得同步加進這支腳本的複製清單，否則 `npm run build` 後會 404。
- **沒有 ESLint／Prettier 設定檔**——風格慣例是照抄現有程式碼：雙引號字串、有分號、箭頭函式、`const`／`let` 不用 `var`、能省略大括號的單行 `if` 常常省略、原生 DOM API（`document.createElement`／`append`）優先於 `innerHTML`（見下方安全一節）。改程式碼前先看該檔案鄰近程式碼的寫法，跟著既有風格走，不要引入新的格式化工具。
- **`vendor/` 目錄**放隨網站一起提供的第三方瀏覽器套件（Mediabunny、ONNX Runtime Web、Spleeter 等），連同各自的授權文件。加新的第三方瀏覽器端相依套件，照這個模式放進 `vendor/`，不要用 CDN 動態載入（會違反「不外送資料」與可稽核性的原則，也是供應鏈攻擊面——CDN 隨時可能被置換內容），並更新 README.md 的〈第三方元件與模型〉表格。

## 安全架構

這一節整合主站與五個 Worker 共通的安全模式，是本文件的重點。漏洞通報範圍、處理流程見 [SECURITY.md](./SECURITY.md)；這裡講的是「寫程式碼時要延續哪些既有的安全設計」。

### 前端信任邊界

- **XSS／`innerHTML` 清洗**：`js/video-generator.js` 大量使用 `innerHTML`，但都是先經過自寫的遞迴清洗函式 `sanitizedImportedHtml()`（處理使用者匯入的專案檔案／分鏡資料）才寫入 DOM：只保留文字節點、`<br>`、白名單內的資源標記，`<script>`／`<iframe>`／`<object>` 等危險標籤與所有屬性都會被拆解掉，只留下子節點內容。**任何會把「使用者可控或從檔案匯入的字串」寫進 `innerHTML` 的地方，都必須先經過等同等級的清洗**，不能因為「反正是本機處理」就跳過——本機處理不代表沒有 XSS 風險（惡意的匯入檔案、貼上的內容都算使用者可控輸入）。新增匯入／貼上功能時，優先重用 `sanitizedImportedHtml()`，不要各自發明一套清洗邏輯。其餘一般文字通常用 `document.createElement` + `.textContent` 手刻 DOM，這是本專案的預設寫法，`innerHTML` 是例外而不是常態。
- **API KEY 儲存**：使用者自行輸入的第三方 API KEY（OpenAI、MiniMax…）存在同一來源的 `localStorage`，不會上傳到本專案任何伺服器（只會在使用者直接呼叫該第三方服務時當作請求標頭送出）。這個設計能避免金鑰經過專案伺服器，但不能抵抗已取得同源 JS 執行能力、瀏覽器設定檔或裝置控制權的攻擊者——這個既有限制不算漏洞，SECURITY.md 的範圍章節有明確排除。新增任何會讀取／顯示已儲存 API KEY 的程式碼，都不能把明碼值意外寫進日誌、URL 或跨來源請求。
- **不要用 CDN 動態載入第三方瀏覽器套件**（見上方〈架構與慣例〉的 `vendor/` 規則），這同時是隱私與供應鏈安全的要求。

### 跨 Worker 共通的伺服器端安全模式

五個 Worker 雖然各自獨立部署，但共用同一套安全慣例，新增 Worker 或端點時延續這些模式：

1. **Origin allowlist 是第一道關卡**：每個 Worker 的 `fetch()` 一開始就檢查 `Origin` 標頭是否等於正式站網域（`https://ezmusic.yustellar.idv.tw`），不符合就直接 403（`OPTIONS` 預檢也一樣檢查）。這個檢查在**限流之前**執行——沒有正確 Origin 的請求連限流計數都不會消耗，避免被拿來當放大器。新增端點不能繞過這個檢查。
2. **雙層限流**：短週期、高頻的端點用 Workers Rate Limiting Binding（例如 `AUTOCOMPLETE_RATE_LIMITER`、`LYRICS_RATE_LIMITER`，60 秒週期），需要更長冷卻時間（2～5 分鐘）的用 SQLite Durable Object（`CooldownLimiter` 類別，`flux-klein`／`storyboard-checker` 都有各自一份）。限流鍵是 `CF-Connecting-IP` ＋前端產生並存在 `localStorage` 的 32 位隨機瀏覽器識別碼（`X-YuMeew-Client-ID` 標頭）組合而成，讓共用網路的不同瀏覽器分開計數；識別碼格式不符時 fallback 成 `anonymous`，**不能直接把任意標頭內容當成限流鍵**（會被用來繞過限流或污染其他使用者的計數）。完整規則、目前哪些端點不計入限流，見 [LIMIT.md](./LIMIT.md)——**改動任何端點的限流數值、新增端點、改變是否計入限流，都必須同步更新 LIMIT.md**，這是文件本身聲明的規則，不是選配。
3. **機密只存在伺服器端，不回傳給瀏覽器**：平台自己的 API 金鑰（供帳戶扣點路徑使用）存在 `member-api`／`model-proxy` 共用的 `PLATFORM_API_KEYS` KV namespace（`8b01eb4ed3fb418eb74233d3ac7ae71f`），key 命名慣例是 `provider:${provider}`，只有 Worker 內部讀取，任何 API 回應都不能把這個值序列化進 JSON 或錯誤訊息。使用者自帶的 API KEY 走另一條路徑（見上方前端信任邊界），兩者不要混用同一組儲存或同一段程式碼。
4. **Worker 之間的內部呼叫用 HMAC，不是明碼比對**：`model-proxy` 呼叫 `member-api` 的 `/v1/internal/credits/reservations` 時，用共用密鑰＋時間戳算 HMAC-SHA256 簽章（`X-YuMeew-Service`／`X-YuMeew-Timestamp`／`X-YuMeew-Signature` 標頭），`member-api` 端驗證簽章與時間戳容許範圍，並用 `constantTimeEqual()` 做抗時序攻擊的比對。這個端點**不是使用者可以直接打的**，改動這段驗證邏輯時，`model-proxy` 的簽章產生（`reservationCommand()`）跟 `member-api` 的驗證（`verifyInternalSignature()`）要保持一致，兩邊分屬不同 repo，容易改一邊忘了改另一邊。
5. **金流資料的完整性靠資料庫層的原子操作，不是應用層邏輯**：影片與圖片生成的扣款都走「預扣（`pending`）→ 正式扣款（`capture`）→ 完成／退款／釋放（`complete`／`refund`／`release`）」三段式流程。**所有狀態轉換都必須是 D1 的原子 `UPDATE ... WHERE status = '<期望狀態>'`**，不能先 `SELECT` 讀狀態、判斷完再無條件 `UPDATE`——並發的兩個請求可能同時通過 `SELECT` 檢查，只有一個 `UPDATE` 真的會生效。**一定要檢查 `.run()` 回傳的 `result.meta.changes`**，是 0 就代表這次操作沒有真的改到任何列，必須重新讀取當下最新狀態再決定回應內容，不能直接回傳「成功」。（`capture` 這裡先前就真的因為漏了這個檢查而有過一次競態條件的假陽性成功回應——使用者可能被重複扣款或收到錯誤的成功訊息——已經修過，但這個模式在新增其他狀態轉換〔例如圖片計費新增的 `createImageReservation`〕時很容易重蹈覆轍。）退款（`refund`）用 `INSERT OR IGNORE ... WHERE refunded_at IS NULL` 搭配對應的 `UPDATE ... WHERE refunded_at IS NULL`、放進同一個 `env.MEMBERS_DB.batch([...])`，這是目前唯一「天生防重複」寫對的例子，可以當作範本。額度、金額一律用**整數分（cents）**存在 D1，只有在組回應 JSON 給前端時才用 `publicAmount()` 轉成一般金額顯示，避免浮點數誤差導致金額對不齊。
6. **輸入驗證要在計費／耗費運算資源之前做完**：所有 Worker 都遵守「先驗證格式與大小限制、驗證通過才佔用限流或冷卻、再花錢呼叫上游模型」的順序（例如 `storyboard-checker` 先檢查 `scenes` 陣列長度與每個 scene 的必要欄位，才呼叫 `STORYBOARD_COOLDOWN`；`lyrics-transcriber` 先檢查音訊檔存在且 ≤ 20 MB，才計入 `LYRICS_RATE_LIMITER`）。新增端點時延續這個順序，不要讓格式錯誤的請求也消耗限流額度或觸發昂貴的上游呼叫。

### 這算不算安全問題？

判斷一個改動或發現算不算安全問題，先對照 [SECURITY.md 的〈範圍〉章節](./SECURITY.md#範圍)：那份文件明確列出「XSS／內容注入」「本機資料外洩」「金鑰意外暴露」「IndexedDB／localStorage 跨來源存取」「檔案解析導致程式碼執行」「PWA 快取供應鏈風險」「第三方服務請求繞過來源或權限界線」「依賴或 CI 工作流程的供應鏈風險」屬於範圍內；也列出哪些**不算**（需要先控制使用者裝置、使用者自行貼上不受信任程式碼、介面已說明的資料傳送、單純缺少安全標頭但無可證明攻擊路徑、對第三方服務的濫用測試等）。寫程式碼或做 code review 時，可以直接拿這張表對照有沒有踩到範圍內的問題。

## 測試慣例（容易踩到的坑）

主站測試是 `node --test`（Node 內建測試跑者），沒有額外測試框架。幾個要注意的地方：

1. **`tests/visualizer.test.js` 用 `Proxy` 模擬 canvas 2D context**，而且**同一個檔案裡出現了好幾份幾乎一樣但各自獨立的 mock**（不是共用一個 helper）。如果在 `js/visualizer.js` 裡新增一種 canvas API 呼叫（例如新的漸層類型 `createLinearGradient`、新的圖形方法），**要逐一檢查並更新該測試檔案裡的每一份 mock**，不能只改第一個遇到的，否則其他測試會因為 mock 回傳 `undefined` 而在呼叫 `.addColorStop()` 之類的方法時丟出 `TypeError`。用 `grep -n "createRadialGradient" tests/visualizer.test.js` 先看有幾處再動手。
2. 那些 mock 有一條共同規則：**傳給任何 canvas 方法的數字參數都必須是有限數（`Number.isFinite`）**，新寫的繪圖公式要注意除以零、`Math.log` 負數、陣列越界等會產生 `NaN`／`Infinity` 的情況。
3. 主站的 `tests/*.test.js` 常常直接用正規表示式檢查 `index.html`／各頁面 HTML 與對應 `.js` 的原始碼字串（例如檢查元素 id 是否存在、`$("...")` 引用的 id 有沒有定義），改 HTML 結構或 JS 裡 `$()` 的呼叫時，記得同步檢查有沒有測試在斷言舊的字串樣式。
4. `member-api`、`model-proxy` 等 Worker 的測試多半是**檢查原始碼字串樣式**（例如斷言 SQL 片段裡有 `status = 'captured'`），不是真的對 D1／KV 跑整合測試。這代表**測試通過不保證邏輯正確**，尤其是併發／競態條件這類問題，測試基本抓不到，必須人工推演（見上方〈安全架構〉的真實案例）。

## Git 工作流程

- **每次完成一項修改後，自動 `git add` + `git commit` 到本地**，commit 訊息用中文、說明「為什麼改」而不只是「改了什麼」。**絕對不要主動 `git push`**——推送與否、推到哪個分支，永遠等使用者明確說「推送」才執行。這條規則對主站與五個 Worker 子專案的獨立儲存庫都適用。
- 主站與每個 Worker 是分開的 git 歷史，改動涉及多個儲存庫時，在每個儲存庫各自 commit，不要試圖用一個 commit 訊息涵蓋全部。
- 這幾個儲存庫目前只有 `main` 分支在使用，沒有 PR 工作流程（沒有 feature branch 慣例），直接在 `main` 上 commit 是目前的常態，除非使用者另外要求。

## 其他必讀文件

- [README.md](./README.md)：功能總覽、專案結構、輸出規格、第三方元件清單、部署方式。
- [LIMIT.md](./LIMIT.md)：所有 Worker 的事件、限額、Durable Object 冷卻時間——改後端端點前必看。
- [SECURITY.md](./SECURITY.md)：安全通報範圍與流程，定義了「哪些算是本專案的漏洞」，上方〈安全架構〉一節的規則就是為了不要踩進這份文件列出的範圍。
- [PRIVACY-POLICY.md](./PRIVACY-POLICY.md)：對外的隱私權政策，任何會新增「資料送出瀏覽器」的功能，措辭與範圍都要能對得上這份文件，對不上就要一併修改它。
