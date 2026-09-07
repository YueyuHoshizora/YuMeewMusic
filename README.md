# YuMeew Music Studio

純 HTML、CSS、原生 JavaScript 音樂頻譜工作室。無 React、JSX、TypeScript、Tailwind、Vinext 或伺服器端應用程式。

## 結構

- `index.html`：頁面與原生表單控制項
- `css/style.css`：響應式樣式
- `js/app.js`：本機檔案讀取、播放、介面事件與狀態
- `js/visualizer.js`：FFT 音訊分析與六種 Canvas 頻譜
- `js/export.js`：客戶端 MP4／MOV 影片與 MP3／M4A／FLAC 音訊編碼
- `js/settings.js`：驗證與保留本機偏好設定
- `vendor/`：隨站提供的 Mediabunny 1.55.7 與 MPL-2.0 授權
- `scripts/`：可選的本機靜態伺服器與檔案複製工具
- `tests/`：Node.js 內建測試

## 執行與部署

不需要安裝 npm 相依套件。使用 Node.js 22 以上執行 `npm run dev`，開啟 `http://localhost:3000`。也可以用任何靜態 HTTP 伺服器提供專案中的公開檔案；ES modules 需要 HTTP(S)，不使用 `file://` 雙擊開啟。

`npm run build` 只會把公開檔案複製到 `dist/`，沒有轉譯或打包步驟。可將 `dist/` 部署到任何 HTTPS 靜態主機。`npm run preview` 預覽 `dist/`，`npm test` 執行測試。

## 功能及隱私

- 本機音樂與 JPG／PNG／WebP 圖片
- 六種頻譜、配色、強度與暗度調整
- 1280×720 或 1920×1080，30 或 60 fps MP4，包含 AAC 音訊
- 原始檔案、解碼資料、圖片與輸出檔案 全程留在客戶端；沒有上傳 API、雲端轉碼、遠端媒體儲存或 CDN 相依
- 不支援瀏覽器編碼時顯示錯誤，不會上傳檔案作為替代方式

需要支援 WebCodecs H.264／AAC 編碼的瀏覽器。音樂限制 300 MB／20 分鐘，圖片限制 30 MB。輸出檔案在記憶體中產生，長影片需要較多記憶體；匯出時保持頁面開啟。

## 驗證範圍

測試 FFT 靜音／正弦訊號、六種繪圖模式與兩種解析度、影格時間、HTML／JS 元素對應。完整瀏覽器互動及實際 MP4 輸出仍需端到端驗證。選用 WebMCP API 以功能偵測註冊，目前未有可用的驗證環境。

## 第三方授權

`vendor/mediabunny.min.mjs` 原封不動取自 npm `mediabunny@1.55.7`。原始碼：https://github.com/Vanilagy/mediabunny/tree/v1.55.7 。授權全文見 `vendor/LICENSE.mediabunny`。

## 自動保留設定

頻譜樣式、色彩、動態強度、背景暗度、解析度、影格率與輸出格式會即時儲存到 `localStorage`（`yumeew.settings.v1`），下次開啟同一網站時自動還原。只儲存這七個設定，不包含音樂、圖片、影片、檔名或播放進度。不同網址／瀏覽器不共用設定。瀏覽器若封鎖儲存或資料損毀，網站仍可操作，必要時使用預設值。

## 輸出格式

| 格式 | 內容 | 編碼 |
| --- | --- | --- |
| MP4 | 頻譜影片與音訊 | H.264 + AAC |
| MOV | QuickTime 頻譜影片與音訊 | H.264 + AAC |
| MP3 | 純音訊 | MP3 192 kbps，本機 LAME WASM |
| M4A | 純音訊，MP4 音訊容器 | AAC 192 kbps |
| FLAC | 純音訊 | 本機 libFLAC WASM |

純音訊不包含圖片或頻譜，解析度與影格率不適用。MP3 多聲道會轉為立體聲；不支援的採樣率會在客戶端轉為 44.1 kHz。FLAC 不會恢復原本有損音訊已失去的細節。輸出格式會一併保留於 localStorage。

MP3／FLAC 已用真實本機 WASM 編碼器產生測試音訊並重新讀取，驗證格式、聲道與時長。M4A／MOV 使用正式容器及原有 AAC／H.264 編碼流程；尚未完成瀏覽器端端到端測試。

額外編碼器取自 `@mediabunny/mp3-encoder@1.55.7` 和 `@mediabunny/flac-encoder@1.55.7`，僅把 bare `mediabunny` import 改為本機相對路徑；WASM 內嵌於模組，不呼叫 CDN。授權、來源及重建說明見 `vendor/*-encoder-README.md`、`vendor/*-encoder-LICENSE`。

## GitHub Pages

`.github/workflows/pages.yml` 在 `main` 更新時執行測試、產生 `dist/`，並使用 GitHub Actions 部署。只發布 `dist/` 的公開檔案，不發布 Git、設定資料或測試原始檔。所有網頁資源使用相對路徑，可支援 `/YuMeewMusic/` 專案網址。

啟用前請在 Repository Settings → Pages 選擇 GitHub Actions。私人倉庫需要支援私人 Pages 的 GitHub 方案；否則需由擁有者決定是否公開倉庫。預定網址為 `https://yueyuhoshizora.github.io/YuMeewMusic/`，實際啟用及部署成功後才可使用。
