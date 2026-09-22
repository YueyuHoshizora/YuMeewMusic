# AGENTS.md

這份文件是給在 YuMeew Music Studio 上工作的 AI 協作代理（Claude、Codex 或其他支援 `AGENTS.md` 慣例的工具）看的專案指南，是本專案 AI 協作文件的**主文件**。人類貢獻者請優先參考 [README.md](./README.md)；本文件著重在「AI 動手改程式前應該知道的事」，README.md、SECURITY.md 說過的內容不重複展開，但會在相關段落交叉引用。

如果你是 Claude Code／Claude（Cowork）：另外看一下 [CLAUDE.md](./CLAUDE.md)，那份是這份文件的**輔助文件**，專門講「怎麼在這個專案做安全審查與 Code Review」，不重複這份文件已經說過的架構內容。

## 專案是什麼

YuMeew Music Studio 是一個**純前端**的瀏覽器音樂視覺化工作室：原生 HTML、CSS、JavaScript（ES modules），沒有任何前端框架（沒有 React／Vue／Svelte）。使用者在瀏覽器內載入音樂、繪製頻譜／節奏動畫、加字幕，再用瀏覽器原生能力（WebCodecs／MediaBunny 等）編碼輸出成影片或音訊。正式網站：https://the-music.app/（自訂網域，部署在 GitHub Pages）。

核心原則：**能在瀏覽器本機完成的事，就不要送到伺服器**。這既是隱私承諾也是安全邊界——每多一個會把資料送出瀏覽器的路徑，就多一個可能外洩或被濫用的攻擊面。改動任何功能前，先確認這個原則有沒有被破壞——詳細的「哪些功能會送出什麼資料」對照表在 README.md 的〈檔案與隱私〉一節，等同於本專案的隱私承諾，改動時要一併更新那張表，並確認 [PRIVACY-POLICY.md](./PRIVACY-POLICY.md) 的措辭還對得上。

## 網站功能總覽

以下是目前上線的頁面與功能，摘自 README.md 但收斂成 AI 代理需要的重點；完整使用者視角的說明、限制與操作細節以 README.md 為準，這裡只列「這功能是什麼、用了哪些模型／技術」。**新增或修改功能時，除了改程式碼，也要回來更新這一節**（連同 README.md 對應段落）。

### 音樂視覺工作室（`index.html`，主畫面）

- **素材與畫面**：載入音樂（MP3／WAV／M4A／FLAC）、背景圖片或靜音循環影片、歌曲資訊、字幕（SRT／ASS／含時間碼 TXT）、個人識別（文字或圖片浮水印）。
- **字幕大小**：主畫面支援 100%～500%，預覽、影片輸出與瀏覽器保存設定使用相同範圍。
- **節奏動畫**：30 種樣式（見 `js/styles.js` 的 `STYLES` 陣列）＋「無」，都是 Canvas 2D 即時繪製，資料來源是 `js/visualizer.js` 的 `spectrum()`（64-bin FFT）。黑膠唱片樣式額外支援封套滑出＋每分鐘 33⅓ 轉動畫。
- **播放與裁剪**：瀏覽器內即時預覽、裁剪範圍、三段 EQ，裁剪只影響播放／輸出範圍，不修改原始檔案。
- **字幕編輯器**（`subtitle-editor.html`）：獨立頁面，波形＋可拖曳字幕時間帶，AI 字幕辨識先在瀏覽器用 Spleeter 分離人聲，再把處理過的人聲（單聲道／16 kHz／16-bit PCM WAV）送到 `lyrics-transcriber` Worker。

### 獨立工具

| 頁面 | 功能 | 用到的模型／Worker |
| --- | --- | --- |
| `image-generator.html` 圖片生成 | 文字生成圖片，依生成比例（1:1／4:3／3:4／16:9／9:16）自動列出寬高皆 <2000px 的常用解析度可選（16:9 最高到 1920×1080、9:16 最高到 1080×1920），預設 1280×720 | Flux.2 Klein 4B（`flux-klein`，免費）、GPT-Image-2.5 Flare／Sunburst（OpenAI，經 `model-proxy` 帳戶扣點或使用者自帶 Key） |
| `video-generator.html` 影片生成 | 分鏡編排＋文字生成影片，支援人物模板、多種鏡頭／燈光／動作描述 | MiniMax H3、Seedance 2.0／2.5（BytePlus）、Veo 3.1 Preview（Google），都經 `model-proxy` 代理 |
| `vocal-separator.html` 人聲分離 | 最長 8 分鐘／150 MB 音樂分離人聲與伴奏，全程瀏覽器內執行 | Spleeter 2-stems 或 BS PolarFormer（ONNX Runtime Web，WebGPU 優先、WASM 備援），模型檔存 IndexedDB |
| `image-video.html` 圖轉影片 | 多張圖片／影片素材排序＋進退場特效，輸出 MP4／透明 PNG MOV | 純瀏覽器端編碼，無外部服務 |
| `video-editor.html` 影片編輯 | 在主畫面影片上疊加圖層、特效、音訊 | 純瀏覽器端編碼，無外部服務 |
| 其他工具（`converter.html`／`music-rating.html`／`suno-tool.html`） | 格式轉換、Suno 單曲評分（APEX 模型，`flux-klein` Worker 的 `runStoryboardCheck` 之外的另一套本機推論）、Suno 分享連結解析（`model-proxy` `/suno/resolve`） | 見各檔案 |

歌曲評分的 APEX／MERT 直接使用 WASM CPU，不嘗試 WebGPU。執行緒上限依序為 16→8→4→1（工作程序失敗時重試），實際數量不超過 `navigator.hardwareConcurrency`；未隔離時固定為 1。Service Worker 為頁面與工作程序回應補上跨來源隔離標頭，工作程序從網路或既有快取載入時都必須帶有 `Cross-Origin-Embedder-Policy: credentialless`，否則隔離頁面會阻擋啟動。
頁面 `rating-capacity` 顯示主執行緒回報的邏輯核心數與預估可用推論執行緒；`rating-engine` 使用工作程序 `status`／`result` 訊息的 `threads` 欄位顯示目前 WASM 設定，避免降級後仍顯示初始上限。數值不代表實體核心数或即時 CPU 使用率。
歌曲評分的總分由 `js/music-rating-core.js` 的 `presentRating()` 統一計算，單曲與雙曲比較共用：五項 APEX 原始分數先由 1–5 換算至 0–100，再套用音樂性 25%、記憶點 25%、結構連貫 20%、混音清晰 15%、自然度 15% 的本站權重。串流吸引力與按讚傾向不參與總分，各項指標的顯示分數維持不加權。

分鏡合理性檢查是影片生成內建的輔助功能，不是獨立頁面。主要引擎退回原本的 `storyboard-checker` Worker（Cloudflare Workers AI `@cf/zai-org/glm-4.7-flash`），失敗時退回 `inspiration-chat` Worker（呼叫 OpenRouter 的 `nex-agi/nex-n2.5-pro:free` 免費模型；這顆 Worker 原本是已下架的「靈感激發」聊天頁面後端，目前先保留當備用引擎，之後有需要再切回來當主要）當備援，兩邊維持一致的分析標準與請求／回應格式。

`suno-tool.html` 支援 `?q=<Suno 分享網址>` 查詢字串，載入時自動帶入分享連結輸入框（僅預填，不自動送出）。取得音樂後除了「套用到主畫面」（存進 `media-store.js` 的 `"audio"` IndexedDB 槽並跳轉 `index.html`），也可「套用並辨識字幕」，同樣存進 `"audio"` 槽後跳轉 `subtitle-editor.html?recognize=1`；`subtitle-editor.js` 讀到 `recognize=1` 且音訊／波形已就緒、目前沒有既有字幕時，會直接呼叫既有的 AI 字幕辨識（`requestSubtitleRecognition()` → Spleeter 人聲分離 → 上傳 `lyrics-transcriber`），把兩個工具串成一次操作；此路徑刻意不繞過既有的「已有字幕先跳確認覆寫對話框」邏輯。

### 會員與帳戶扣點

所有頁面右上角顯示會員頭像與剩餘額度。會員身分、額度、交易紀錄由 `member-api`（Supabase Auth + Cloudflare D1）管理，瀏覽器只送 Supabase JWT，不直接碰 D1。「帳戶扣點」是圖片／影片生成的其中一種付款方式（另一種是使用者自帶第三方 API KEY），完整設計見下方〈限制與金流設計〉。

### 輸出規格速查

| 格式 | 內容 | 編碼 |
| --- | --- | --- |
| MP4 | 影片＋音訊 | H.264 + AAC 192 kbps |
| MOV | QuickTime 影片＋音訊（支援透明通道） | H.264 + AAC 192 kbps |
| WebM | 影片＋音訊 | VP9 + Opus 192 kbps |
| MP3／M4A／FLAC／WAV | 純音訊 | MP3／AAC／FLAC／16-bit PCM |

影片尺寸支援 16:9（854×480／1280×720／1920×1080）與 9:16（480×854／720×1280／1080×1920）、30／60 fps；H.264 Profile 可選自動／Baseline／Main／High。編碼器選擇順序是硬體優先 → 瀏覽器自動 → 軟體優先，實際用 GPU 或 CPU 由瀏覽器／作業系統決定，`js/video-acceleration.js` 只負責表達偏好，不保證結果。完整規格以 README.md〈輸出規格〉為準。

### 專案結構（檔案樹）

```text
├── index.html                 # 音樂視覺工作室（主畫面）
├── subtitle-editor.html       # 字幕編輯器
├── image-generator.html       # 圖片生成
├── video-generator.html       # 影片生成
├── vocal-separator.html       # 人聲分離
├── image-video.html           # 圖轉影片
├── video-editor.html          # 影片編輯
├── converter.html             # 任意轉
├── music-rating.html          # 歌曲評分
├── suno-tool.html             # Suno 工具
├── ai-mastering.html          # AI 母帶
├── settings.html              # 設定與快取管理
├── css/                       # 頁面樣式（跟 html/js 同名三胞胎，見下方架構慣例）
├── js/                        # UI、DSP、Canvas 與編碼邏輯（見下方模組地圖）
├── vendor/                    # 隨網站提供的瀏覽器套件與授權
├── scripts/                   # 本機伺服器（serve.js）與建置工具（build.js）
└── tests/                     # Node.js 測試（node --test）
```

### `js/` 模組地圖（依關注點分類，不是逐檔案窮舉）

| 分類 | 檔案（舉例） | 用途 |
| --- | --- | --- |
| 頁面控制器（三胞胎的 JS） | `image-generator.js`／`video-generator.js`／`vocal-separator.js`／`image-video.js`／`video-editor.js`／`converter.js`／`music-rating.js`／`suno-tool.js`／`ai-mastering.js`／`subtitle-editor.js`／`app.js`（主畫面） | 每個頁面自己的事件綁定、狀態機、與後端／Worker 溝通邏輯 |
| 視覺渲染 | `visualizer.js`（Canvas 2D 頻譜／節奏動畫）、`styles.js`（30 種樣式定義） | 主畫面的即時繪製核心 |
| 音訊處理 | `audio-eq.js`（三段 EQ）、`trim.js`／`trim-range.js`／`trim-time.js`（裁剪）、`export.js`（PCM 縮放、frame timing）、`vocal-separator-core.js`／`vocal-separator-worker.js`（Spleeter／PolarFormer 分離）、`vocal-autotune-core.js`／`vocal-autotune-worker.js`（人聲自動調音） | DSP 與音訊編輯，多半搭配 Web Worker 跑重運算 |
| 編碼與輸出 | `formats.js`（輸出格式定義）、`video-profile.js`（H.264 Profile／Level 對應解析度與 fps）、`png-mov.js`（透明通道 MOV）、`dimensions.js`（解析度換算）、`video-effects.js`（進退場特效）、`image-sequence.js`（圖轉影片排程） | 對接 WebCodecs／MediaBunny 的編碼參數計算，本身不直接碰編碼器 API |
| 字幕與素材 | `subtitles.js`（SRT／ASS／TXT 解析）、`fonts.js`（內建字幕字型）、`background-video.js`（循環背景影片） | |
| 儲存與快取 | `media-store.js`（IndexedDB 媒體封裝／解封裝）、`settings.js`（`localStorage` 設定，白名單制只存必要欄位）、`indexeddb-model-cache.js`（AI 模型檔快取）、`undo-history.js`（共用復原／重做，字幕編輯器與其他編輯器共用同一個 factory） | |
| 會員與計費 | `auth.js`（Supabase session）、`account.js`／`member-status.js`（會員狀態顯示）、`api-keys.js`（第三方 API KEY 存取＋`usesAccountCredits()`）、`provider-billing.js`（第三方費率查詢 URL）、`video-billing.js`（`roundUpCurrency()`、額度是否足夠判斷）、`admin.js`（管理後台） | 額度顯示與計費輔助邏輯；實際扣款在 Worker 端（見下方〈金流設計〉） |
| 影片生成專屬 | `video-prompt-mode.js`（分鏡文字模式解析）、`video-project-file.js`（專案檔匯入／匯出）、`video-resources.js`（引用資源管理）、`video-editor-core.js`（圖層時間計算）、`video-generator-pwa.js`（PWA／離線） | |
| 共用小工具 | `themes.js`（深色／淺色主題，**只能改 CSS 屬性，不能動到渲染或輸出設定**）、`client-identity.js`（`X-YuMeew-Client-ID` 標頭產生與讀取）、`image-generation-identifiers.js`／`image-generation-settings.js`（見下方安全與金流章節）、`loading-screen.js`、`model-settings.js` | |

新增檔案時先判斷屬於哪一類、看同類檔案的既有寫法，不要自己發明新的資料流模式（例如不要繞過 `media-store.js` 自己操作 IndexedDB）。

## 儲存庫佈局

這個資料夾（`YuMeewMusic`）只是**主站**的 git 儲存庫。同一個資料夾底下還放了五個各自獨立的 git 儲存庫（各自有自己的 `.git`、遠端、CI），它們是主站背後的 Cloudflare Workers，主站的 `.gitignore` 已排除它們（`/member-api/`、`/model-proxy/`、`/flux-klein/`、`/lyrics-transcriber/`、`/storyboard-checker/`），**不要**指望 `git status`／`git add -A` 在主站儲存庫裡能看到它們的變動：

| 目錄 | 遠端 repo | 角色 |
| --- | --- | --- |
| `member-api/` | `YueyuHoshizora/YuMeewMusicMember` | 會員／額度／儲值扣款，Supabase Auth + Cloudflare D1 |
| `model-proxy/` | `model-proxy-worker` | 代理 MiniMax／Seedance／Veo 影片生成、GPT Image 帳戶扣點圖片生成、Suno 連結解析、YouTube 公開影片／頻道資訊解析 |
| `flux-klein/` | 獨立 Worker | Flux.2 Klein 4B 圖片生成（免費資源） |
| `lyrics-transcriber/` | 獨立 Worker | AI 字幕辨識 |
| `storyboard-checker/` | 獨立 Worker | 分鏡合理性 AI 分析（Cloudflare Workers AI，現為備援） |
| `inspiration-chat/` | 獨立 Worker | 原「靈感激發」聊天頁面代理，頁面已下架；程式碼保留改做分鏡 AI 分析備用引擎（OpenRouter 免費模型），目前先保留備用，主要引擎退回 storyboard-checker |

每個 Worker 子專案自己有一份 `AGENTS.md`，內容是「這個 Worker 自己的規矩」（角色、端點、限流機制、程式碼風格、測試慣例），跟這份主文件互補、不重複。它們實際存在於磁碟上（只是被主站 `.gitignore` 排除），下面直接匯入內容，方便在主站這邊工作時也能看到：

@member-api/AGENTS.md
@model-proxy/AGENTS.md
@flux-klein/AGENTS.md
@lyrics-transcriber/AGENTS.md
@storyboard-checker/AGENTS.md
@inspiration-chat/AGENTS.md

改一個功能如果同時牽涉主站與某個 Worker（例如額度計費），要記得這是**兩個獨立的 git 歷史**，分開 commit、分開推送，訊息裡不要假設對方 repo 也一起動了。

主站本身的目錄結構、各獨立工具頁面、30 種節奏動畫清單，請見 README.md 的〈專案結構〉一節，這裡不重複。

## 限制與金流設計

### 限流與冷卻（完整數字直接匯入 LIMIT.md，避免兩邊數字兜不起來）

@LIMIT.md

### 金流設計（額度預扣模式）

圖片與影片生成的付款方式有兩種：使用者自帶第三方 API KEY（直接從瀏覽器呼叫該服務，不經過本專案伺服器），或「帳戶扣點」（從會員額度扣款，經 `model-proxy` → `member-api` 代理）。帳戶扣點統一走「預扣（`pending`）→ 正式扣款（`capture`）→ 完成／退款／釋放（`complete`／`refund`／`release`）」三段式流程，邏輯在 `member-api/src/index.ts` 的 `handleReservationCommand()`，發起方在 `model-proxy/src/index.ts`。

目前的計費模型（`member-api` 的 `BILLING_MODELS`）：

| `billingId` | 服務商 | 計價方式（概念） |
| --- | --- | --- |
| `minimax-h3` | MiniMax | 依輸出秒數（768p／2K 費率不同）＋超出免費額度的圖片／音效／影片資源附加費 |
| `seedance-2-0` | BytePlus | 基本秒費率 × 解析度倍率（480p／720p／1080p／4K）× 秒數 |
| `seedance-2-5` | BytePlus | 同上，480p／720p 倍率（無 1080p／4K） |
| `veo-3-1` | Google | 依輸出秒數，720p／1080p 費率不同，含音效／靜音兩種費率 |
| `gpt-image-2-5` | OpenAI | 依 token 估算（文字輸入、參考圖片輸入、輸出），因 OpenAI 未公開圖片生成確切 tokenizer 公式，是近似值，實際請以帳單為準並調整 `imageReservationAmount()` 裡的三個單價常數 |

每個模型的預設費率寫死在程式碼的 `defaults`，也可以透過 `/v1/admin/billing/:model` 動態覆寫存進 D1（讀不到動態設定才 fallback 回 `defaults`）。所有金額在 D1 一律存整數分（cents），只有組 JSON 回應給前端時才轉成一般金額顯示。新增計費模型時，`member-api`（新增 `BILLING_MODELS` 項目＋對應 `*ReservationAmount()` 計價函式＋ `/v1/credits/*-reservations` 路由）與 `model-proxy`（新增 `reserve*Credit()`＋`createAccountBilled*()`＋對應路由）兩邊都要加，照抄既有模型的骨架。

### `credit_reservations` 資料表（`member-api` D1，`migrations/0004~0006`）

```sql
id               TEXT PRIMARY KEY        -- crypto.randomUUID()
user_id          TEXT REFERENCES members(user_id)
amount           INTEGER CHECK (amount > 0)   -- 整數分（cents）
status           TEXT CHECK (status IN ('pending','captured','released','expired'))
provider         TEXT                    -- 'minimax' / 'byteplus' / 'google' / 'openai'
model            TEXT                    -- billingId，例如 'gpt-image-2-5'
task_id          TEXT                    -- 上游任務 ID 或（圖片）合成的 UUID
description      TEXT
idempotency_key  TEXT                    -- 前端產生的 UUID，UNIQUE(user_id, idempotency_key)
metadata         TEXT                    -- 原始請求 JSON（json_valid 檢查）
expires_at       TEXT                    -- 建立時固定 +10 分鐘
captured_at      TEXT
released_at      TEXT
result_url       TEXT                    -- 影片完成後的來源 URL（圖片不用，因為是同步回應）
refunded_at      TEXT                    -- 有值代表已退款，配合 refund_reason
refund_reason    TEXT
```

沒有獨立的 `'refunded'`／`'complete'` 狀態值——完成與退款是用 `captured` 狀態上疊加 `result_url`／`refunded_at` 這兩個欄位表示，不是切換 `status`。新增退款相關邏輯時，判斷「是否已退款」要看 `refunded_at IS NULL`，不是看 `status`。

### `model-proxy` → `member-api` 內部端點契約

`POST /v1/internal/credits/reservations`，body 是 `{ action, reservationId, provider, taskId?, resultUrl?, reason?, expectedStatus? }`，`action` 可以是 `authorize`／`release`／`refund`／`complete`／`capture`。呼叫方帶 `X-YuMeew-Service`／`X-YuMeew-Timestamp`／`X-YuMeew-Signature` 三個標頭（HMAC-SHA256，簽章內容是 `${serviceId}\n${timestamp}\nPOST\n${path}\n${body}`），`member-api` 端在 `INTERNAL_SIGNATURE_TOLERANCE_SECONDS`（300 秒）容許範圍內驗證時間戳，簽章比對用 `constantTimeEqual()`。這個端點不掛在使用者可觸及的路由前綴下，前端永遠不會、也不應該直接呼叫它。

## 開發指令

```sh
npm run dev      # node scripts/serve.js，啟動 http://localhost:3000（直接讀原始檔）
npm test         # node --test tests/*.test.js
npm run build    # node scripts/build.js，輸出到 dist/（見下方「建置」）
npm run preview  # node scripts/serve.js --dist，預覽 dist/
```

Node.js 需求：22 以上。**主站沒有任何 npm 執行期相依套件**（`@supabase/supabase-js` 只在建置時被打包進 `vendor/supabase.min.mjs`，執行期直接載入靜態檔案，不會動態 `npm install` 任何東西進使用者瀏覽器——這也是供應鏈安全的一部分，見 [CLAUDE.md](./CLAUDE.md) 的安全審查一節）。`devDependencies` 只有 `esbuild` 和 `lightningcss`，純粹是建置工具。

五個 Worker 子專案各自用 `npm test` 跑自己的測試（`member-api` 是 `node --test`，其餘四個是 vitest／`cloudflare:test`，各自的 `AGENTS.md` 有說明），`npm run dev` 是 `wrangler dev`。改 Worker 程式碼後記得進該子目錄單獨跑測試，不會被主站的 `npm test` 一併執行到。

## 架構與慣例

- **每個工具頁面是一組三胞胎**：`X.html` + `css/X.css` + `js/X.js`（例如 `image-generator.html` / `css/image-generator.css` / `js/image-generator.js`）。`css/style.css` 是唯一沒有對應 JS 的檔案，是所有頁面共用的基礎樣式。新增頁面請照這個三胞胎模式，並把它加進 `scripts/build.js`、`scripts/serve.js` 裡的白名單陣列（兩邊都要加，`serve.js` 的 `allowed` 集合和 `build.js` 的 `htmlFiles`／複製清單是各自獨立寫死的，不會自動同步）。
- **開發模式不經過任何 bundler**：`<script type="module">` 直接讀原始 `.js`，瀏覽器原生 ES modules 解析 import。所以本機開發時路徑、副檔名都要精確（沒有 webpack/vite 那種模糊解析）。
- **建置**（`scripts/build.js`）才會用 esbuild／lightningcss 做 minify，並用全站內容的 sha256 雜湊當作版本號，幫每個 `.js`/`.css` 引用加上 `?v=<hash>` 做 cache-busting。加新的靜態檔案（圖示、字型、新頁面）記得同步加進這支腳本的複製清單，否則 `npm run build` 後會 404。
- **沒有 ESLint／Prettier 設定檔**——風格慣例是照抄現有程式碼：雙引號字串、有分號、箭頭函式、`const`／`let` 不用 `var`、能省略大括號的單行 `if` 常常省略、原生 DOM API（`document.createElement`／`append`）優先於 `innerHTML`（見下方〈前端信任邊界〉）。改程式碼前先看該檔案鄰近程式碼的寫法，跟著既有風格走，不要引入新的格式化工具。
- **`vendor/` 目錄**放隨網站一起提供的第三方瀏覽器套件（Mediabunny、ONNX Runtime Web、Spleeter 等），連同各自的授權文件。加新的第三方瀏覽器端相依套件，照這個模式放進 `vendor/`，不要用 CDN 動態載入（會違反「不外送資料」與可稽核性的原則，也是供應鏈攻擊面——CDN 隨時可能被置換內容），並更新 README.md 的〈第三方元件與模型〉表格。

## 前端信任邊界

`js/video-generator.js` 大量使用 `innerHTML`，但都是先經過自寫的遞迴清洗函式 `sanitizedImportedHtml()`（處理使用者匯入的專案檔案／分鏡資料）才寫入 DOM：只保留文字節點、`<br>`、白名單內的資源標記，`<script>`／`<iframe>`／`<object>` 等危險標籤與所有屬性都會被拆解掉，只留下子節點內容。**任何會把「使用者可控或從檔案匯入的字串」寫進 `innerHTML` 的地方，都必須先經過等同等級的清洗**，不能因為「反正是本機處理」就跳過——本機處理不代表沒有 XSS 風險（惡意的匯入檔案、貼上的內容都算使用者可控輸入）。新增匯入／貼上功能時，優先重用 `sanitizedImportedHtml()`，不要各自發明一套清洗邏輯。其餘一般文字通常用 `document.createElement` + `.textContent` 手刻 DOM，這是本專案的預設寫法，`innerHTML` 是例外而不是常態。

使用者自行輸入的第三方 API KEY（OpenAI、MiniMax…）存在同一來源的 `localStorage`，不會上傳到本專案任何伺服器（只會在使用者直接呼叫該第三方服務時當作請求標頭送出）。這個設計能避免金鑰經過專案伺服器，但不能抵抗已取得同源 JS 執行能力、瀏覽器設定檔或裝置控制權的攻擊者——這個既有限制不算漏洞，SECURITY.md 的範圍章節有明確排除。

## 跨 Worker 共通的伺服器端安全模式

五個 Worker 雖然各自獨立部署，但共用同一套安全慣例，新增 Worker 或端點時延續這些模式（更完整的審查用 checklist 見 [CLAUDE.md](./CLAUDE.md)）：

1. **Origin allowlist 是第一道關卡**：每個 Worker 的 `fetch()` 一開始就檢查 `Origin` 標頭是否等於正式站網域（`https://the-music.app`），不符合就直接 403（`OPTIONS` 預檢也一樣檢查）。這個檢查在**限流之前**執行——沒有正確 Origin 的請求連限流計數都不會消耗，避免被拿來當放大器。
2. **雙層限流**：短週期、高頻的端點用 Workers Rate Limiting Binding（例如 `AUTOCOMPLETE_RATE_LIMITER`、`LYRICS_RATE_LIMITER`，60 秒週期），需要更長冷卻時間（2～5 分鐘）的用 SQLite Durable Object（`CooldownLimiter` 類別，`flux-klein`／`storyboard-checker` 都有各自一份）。限流鍵是 `CF-Connecting-IP` ＋前端產生並存在 `localStorage` 的 32 位隨機瀏覽器識別碼（`X-YuMeew-Client-ID` 標頭）組合而成。完整規則、目前哪些端點不計入限流，見 [LIMIT.md](./LIMIT.md)——**改動任何端點的限流數值、新增端點、改變是否計入限流，都必須同步更新 LIMIT.md**。
3. **機密只存在伺服器端，不回傳給瀏覽器**：平台自己的 API 金鑰（供帳戶扣點路徑使用）存在 `member-api`／`model-proxy` 共用的 `PLATFORM_API_KEYS` KV namespace（`8b01eb4ed3fb418eb74233d3ac7ae71f`），key 命名慣例是 `provider:${provider}`。
4. **Worker 之間的內部呼叫用 HMAC，不是明碼比對**：`model-proxy` 呼叫 `member-api` 的 `/v1/internal/credits/reservations` 時，用共用密鑰＋時間戳算 HMAC-SHA256 簽章，並用 `constantTimeEqual()` 做抗時序攻擊的比對。
5. **金流資料的完整性靠資料庫層的原子操作**：影片與圖片生成的扣款都走「預扣（`pending`）→ 正式扣款（`capture`）→ 完成／退款／釋放（`complete`／`refund`／`release`）」三段式流程，所有狀態轉換都必須是 D1 的原子 `UPDATE ... WHERE status = '<期望狀態>'`，並檢查 `result.meta.changes`。額度、金額一律用整數分（cents）存在 D1。
6. **輸入驗證要在計費／耗費運算資源之前做完**：先驗證格式與大小限制、驗證通過才佔用限流或冷卻、再花錢呼叫上游模型。

## 測試慣例（容易踩到的坑）

主站測試是 `node --test`（Node 內建測試跑者），沒有額外測試框架。幾個要注意的地方：

1. **`tests/visualizer.test.js` 用 `Proxy` 模擬 canvas 2D context**，而且**同一個檔案裡出現了好幾份幾乎一樣但各自獨立的 mock**（不是共用一個 helper）。如果在 `js/visualizer.js` 裡新增一種 canvas API 呼叫（例如新的漸層類型 `createLinearGradient`、新的圖形方法），**要逐一檢查並更新該測試檔案裡的每一份 mock**，不能只改第一個遇到的，否則其他測試會因為 mock 回傳 `undefined` 而在呼叫 `.addColorStop()` 之類的方法時丟出 `TypeError`。用 `grep -n "createRadialGradient" tests/visualizer.test.js` 先看有幾處再動手。
2. 那些 mock 有一條共同規則：**傳給任何 canvas 方法的數字參數都必須是有限數（`Number.isFinite`）**，新寫的繪圖公式要注意除以零、`Math.log` 負數、陣列越界等會產生 `NaN`／`Infinity` 的情況。
3. 主站的 `tests/*.test.js` 常常直接用正規表示式檢查 `index.html`／各頁面 HTML 與對應 `.js` 的原始碼字串（例如檢查元素 id 是否存在、`$("...")` 引用的 id 有沒有定義），改 HTML 結構或 JS 裡 `$()` 的呼叫時，記得同步檢查有沒有測試在斷言舊的字串樣式。
4. `member-api`、`model-proxy` 等 Worker 的測試多半是**檢查原始碼字串樣式**（例如斷言 SQL 片段裡有 `status = 'captured'`），不是真的對 D1／KV 跑整合測試。這代表**測試通過不保證邏輯正確**，尤其是併發／競態條件這類問題，測試基本抓不到，必須人工推演（見 [CLAUDE.md](./CLAUDE.md) 的真實案例）。

## Git 工作流程

- **每次完成一項修改後，自動 `git add` + `git commit` 到本地**，commit 訊息用中文、說明「為什麼改」而不只是「改了什麼」。**絕對不要主動 `git push`**——推送與否、推到哪個分支，永遠等使用者明確說「推送」才執行。這條規則對主站與五個 Worker 子專案的獨立儲存庫都適用。
- 主站與每個 Worker 是分開的 git 歷史，改動涉及多個儲存庫時，在每個儲存庫各自 commit，不要試圖用一個 commit 訊息涵蓋全部。
- 這幾個儲存庫目前只有 `main` 分支在使用，沒有 PR 工作流程（沒有 feature branch 慣例），直接在 `main` 上 commit 是目前的常態，除非使用者另外要求。

## 其他必讀文件

- [CLAUDE.md](./CLAUDE.md)：這份主文件的輔助文件，講「怎麼在這個專案做安全審查與 Code Review」，Claude 系列工具請優先看。
- [README.md](./README.md)：功能總覽、專案結構、輸出規格、第三方元件清單、部署方式。
- [LIMIT.md](./LIMIT.md)：所有 Worker 的事件、限額、Durable Object 冷卻時間——改後端端點前必看。
- [SECURITY.md](./SECURITY.md)：安全通報範圍與流程，定義了「哪些算是本專案的漏洞」。
- [PRIVACY-POLICY.md](./PRIVACY-POLICY.md)：對外的隱私權政策，任何會新增「資料送出瀏覽器」的功能，措辭與範圍都要能對得上這份文件，對不上就要一併修改它。
