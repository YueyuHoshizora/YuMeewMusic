# YuMeew Music Studio

純 HTML、CSS、原生 JavaScript 音樂頻譜工作室。無 React、JSX、TypeScript、Tailwind、Vinext 或伺服器端應用程式。

## 結構

- `index.html`：頁面與原生表單控制項
- `css/style.css`：響應式樣式
- `js/app.js`：本機檔案讀取、播放、介面事件與狀態
- `js/visualizer.js`：FFT 音訊分析與六種 Canvas 頻譜
- `js/export.js`：客戶端 H.264／AAC MP4 編碼
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
- 原始檔案、解碼資料、圖片與 MP4 全程留在客戶端；沒有上傳 API、雲端轉碼、遠端媒體儲存或 CDN 相依
- 不支援瀏覽器編碼時顯示錯誤，不會上傳檔案作為替代方式

需要支援 WebCodecs H.264／AAC 編碼的瀏覽器。音樂限制 150 MB／20 分鐘，圖片限制 30 MB。MP4 在記憶體中產生，長影片需要較多記憶體；匯出時保持頁面開啟。

## 驗證範圍

測試 FFT 靜音／正弦訊號、六種繪圖模式與兩種解析度、影格時間、HTML／JS 元素對應。完整瀏覽器互動及實際 MP4 輸出仍需端到端驗證。選用 WebMCP API 以功能偵測註冊，目前未有可用的驗證環境。

## 第三方授權

`vendor/mediabunny.min.mjs` 原封不動取自 npm `mediabunny@1.55.7`。原始碼：https://github.com/Vanilagy/mediabunny/tree/v1.55.7 。授權全文見 `vendor/LICENSE.mediabunny`。

## 自動保留設定

頻譜樣式、色彩、動態強度、背景暗度、解析度與影格率會即時儲存到 `localStorage`（`yumeew.settings.v1`），下次開啟同一網站時自動還原。只儲存這六個設定，不包含音樂、圖片、影片、檔名或播放進度。不同網址／瀏覽器不共用設定。瀏覽器若封鎖儲存或資料損毀，網站仍可操作，必要時使用預設值。
