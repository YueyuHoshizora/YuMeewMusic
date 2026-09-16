# CLAUDE.md

這份文件是 [AGENTS.md](./AGENTS.md) 的**輔助文件**，專屬給 Claude Code／Claude（Cowork）看。`AGENTS.md` 是本專案 AI 協作的主文件（專案架構、開發指令、Git 工作流程都在那裡），這份文件**不重複**那些內容，只補充一件事：**在這個專案做安全審查（security review）與 Code Review 時，具體要檢查什麼**。

先載入主文件，取得完整專案脈絡（含五個 Worker 子專案各自的 `AGENTS.md`）：

@AGENTS.md

## 什麼時候用這份文件

- 使用者要求「code review」「安全審查」「幫我看看這段程式碼安不安全」之類的任務。
- 自己寫完一段改動後，準備 commit 前的自我審查。
- 審查別人（或另一個代理）寫的 diff、PR。

一般的功能開發、改 bug、寫文件，直接照 `AGENTS.md` 的規則做就好，不需要跑過下面整份 checklist；但**任何碰到 Worker（五個子專案）、金流、使用者輸入處理、`innerHTML`、API KEY 的改動**，做完後都應該對照下面相關的項目自查一次，即使沒人明確要求「做 code review」。

## 安全審查 Checklist

逐項對照，每項都要能明確回答「有」或「不適用」，答不出來就是要修或要問：

### 前端（主站）

1. **新增或修改的 `innerHTML` 賦值**：寫入的字串是使用者可控或從檔案匯入的嗎？如果是，有沒有先經過 `sanitizedImportedHtml()`（或等同強度的清洗）？有沒有為了圖方便另外寫一套清洗邏輯（不該有，應該重用既有的）？
2. **API KEY 相關程式碼**：使用者輸入的 API KEY 有沒有意外被寫進 `console.log`、URL query string、跨來源的 `fetch`、或送到本專案自己的伺服器？「帳戶扣點」與「自帶 API KEY」兩條路徑有沒有混用同一段程式碼或儲存位置？
3. **新的第三方相依套件**：是不是用 CDN 動態載入的？（不應該——應該放進 `vendor/` 並隨站附上授權文件。）
4. **新的「資料離開瀏覽器」路徑**：README.md〈檔案與隱私〉表格、`PRIVACY-POLICY.md` 有沒有同步更新？

### Worker（五個子專案，含 member-api／model-proxy）

5. **新端點或修改既有端點**：`Origin` allowlist 檢查有沒有在最前面？是不是在限流檢查**之前**？
6. **限流**：新端點有沒有掛上限流（Workers Rate Limiting Binding 或 Durable Object 冷卻，視所需週期長短選擇）？限流鍵是不是用 IP＋瀏覽器識別碼組合，而不是單獨信任某個可被使用者任意設定的標頭？`LIMIT.md` 有沒有同步更新？
7. **機密資料**：有沒有任何 API 回應（含錯誤訊息）把 `PLATFORM_API_KEYS`、`MEMBER_SERVICE_SECRET` 等伺服器端密鑰序列化出去？KV key 命名是否延續 `provider:${provider}` 慣例？
8. **服務對服務呼叫**：`model-proxy` ↔ `member-api` 之間新增或修改的內部呼叫，有沒有用 HMAC 簽章＋時間戳？比對簽章是不是用 `constantTimeEqual()`（不是 `===`）？兩邊（簽章產生端與驗證端）改動是否同步——這是分屬不同 repo 最容易漏改一邊的地方。
9. **金流狀態轉換**：任何新增或修改的 `credit_reservations` 狀態轉換，SQL 是不是原子的 `UPDATE ... WHERE status = '<期望狀態>'`？有沒有檢查 `result.meta.changes` 並在 `0` 時重新讀取最新狀態，而不是直接回傳「成功」？有沒有先 `SELECT` 判斷再無條件 `UPDATE` 這種會有競態條件的寫法（這正是本專案 `capture` 曾經出過的真實漏洞）？退款邏輯是否用 `INSERT OR IGNORE ... WHERE refunded_at IS NULL` 這種天生防重複的模式？金額是否全程用整數分（cents），只在組回應時才轉換成一般金額？無條件進位（`roundUpCurrency`）用在該用的地方，沒有誤用四捨五入？
10. **輸入驗證順序**：格式／大小驗證是不是在「佔用限流或冷卻」與「呼叫上游付費模型」之前完成？有沒有讓格式錯誤的請求也消耗到限流額度或觸發不必要的上游呼叫？
11. **新增計費模型或供應商**：是否照抄既有的「reserve → 上游呼叫 → capture／release」骨架？每一個失敗分支是否都有對應的 `release`／`refund`，不會讓使用者的額度卡在 `pending`？

### 對照 SECURITY.md

12. 這個改動或發現，落在 [SECURITY.md 的〈範圍〉章節](./SECURITY.md#範圍) 裡面嗎？先確認是不是真的算漏洞（例如「需要先控制使用者裝置」「介面已說明的資料傳送」這類情況通常不算），再決定要不要當成安全問題處理，避免誤判浪費修正精力，也避免放過真正在範圍內的問題。

## Code Review 慣例

- **這個專案沒有 lint／格式化工具**，review 風格一致性時，標準是「跟同一個檔案鄰近程式碼像不像」，不是套用某種通用風格指南。發現風格不一致，先確認是不是新引入的模式，而不是原本就有的既有寫法。
- **跨 repo 的改動要分開看**：主站與五個 Worker 是各自獨立的 git 歷史，一次改動如果同時碰到多個 repo（例如新增一種計費模型要同時改 `member-api` 和 `model-proxy`），review 時要逐一確認每個 repo 各自的改動是完整且自洽的，不能假設「反正另一個 repo 也會跟著改」。
- **測試通過不代表沒問題**：`member-api`／`model-proxy`／其餘 Worker 的測試多半是檢查原始碼字串樣式，不是真的對 D1／KV 跑整合測試，尤其是併發／競態條件這類問題測試基本抓不到。review 金流相關改動時，要自己推演「兩個並發請求同時打這支端點會怎樣」，不能只看測試是否通過。
- **測試同步**：`js/visualizer.js` 新增 canvas API 呼叫時，`tests/visualizer.test.js` 裡**六份**獨立的 mock 是不是都同步更新了（用 `grep -n "createRadialGradient" tests/visualizer.test.js` 之類的指令先數清楚有幾處）？HTML／JS 結構變動時，有沒有測試還在斷言舊的字串樣式？
- **文件同步**：改動如果牽涉限流數值、端點增減、計費規則、資料外送路徑，對應的 `LIMIT.md`／`SECURITY.md`／`PRIVACY-POLICY.md`／README.md 是否也一併更新，而不是只改程式碼？
