import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";

const $ = id => document.getElementById(id);

// 代理 OpenRouter 的獨立 Worker（見 inspiration-chat/），瀏覽器不會直接拿到
// OpenRouter 的 API Key，也不能覆寫 Worker 端固定的系統提示詞（人設）。
const WORKER_URL = "https://inspiration-chat.yustellar.idv.tw/api/inspiration/chat";

// 跟 Worker 端 COOLDOWN_SECONDS 常數保持一致：送出後先在前端就把送出鍵鎖住這麼多秒，
// 避免使用者手速太快而觸發 Worker 的 429，同時也是聊天節奏上合理的間隔。
const COOLDOWN_SECONDS = 5;
const MAX_MESSAGE_CHARS = 4000;

// 對話累積到一定長度前，主動把較舊的內容濃縮成一段摘要，讓聊天理論上可以無限延續，
// 不會一直撞到 Worker 端 MAX_TOTAL_CHARS／MAX_MESSAGES 的硬上限（那兩個上限還是保留
// 當最後一道防線）。門檻抓在硬上限的六成左右，留出空間給摘要訊息本身與後續幾輪對話。
const COMPRESS_TRIGGER_CHARS = 12000;
const COMPRESS_TRIGGER_MESSAGES = 30;
const COMPRESS_KEEP_RECENT = 6; // 保留最近 3 組使用者／助理往返，逐字保留不濃縮
const COMPRESS_INSTRUCTION =
  "請把以上對話內容濃縮成一段重點摘要，保留討論過的創作方向、已經決定或排除的想法、" +
  "還沒解決的問題，控制在 500 字以內。只回傳摘要本身，不要加「以下是摘要」之類的開場白，" +
  "也不要用條列格式。";

const restored = loadSettings();
applyTheme(restored.mode, restored.theme);

// 對話只存在這個分頁的記憶體裡，重新整理就會清空，不寫入 localStorage 或
// IndexedDB——這是刻意的隱私選擇，聊天內容會送到外部的 OpenRouter，不應該
// 再額外留一份在使用者裝置上。
let conversation = [];
let activeController = null;
let cooldownTimer = null;
let compressing = false;

function status(text, mode = "") {
  $("inspiration-status").textContent = text;
  $("inspiration-status").className = `inspiration-status ${mode}`.trim();
}

function error(text = "") {
  $("inspiration-error").textContent = text;
  $("inspiration-error").hidden = !text;
}

function scrollToBottom() {
  const messages = $("inspiration-messages");
  messages.scrollTop = messages.scrollHeight;
}

function appendMessage(role, initialText = "") {
  $("inspiration-empty")?.remove();
  const bubble = document.createElement("div");
  bubble.className = `inspiration-message ${role}`;
  const content = document.createElement("p");
  content.className = "inspiration-message-content";
  content.textContent = initialText;
  bubble.append(content);
  $("inspiration-messages").append(bubble);
  scrollToBottom();
  return content;
}

function autoResizeInput() {
  const input = $("inspiration-input");
  input.style.height = "auto";
  input.style.height = `${Math.min(160, input.scrollHeight)}px`;
}

function setBusy(busy) {
  $("inspiration-input").disabled = busy;
  $("inspiration-clear").disabled = busy;
  $("inspiration-send").textContent = busy ? "停止" : "送出";
  $("inspiration-send").classList.toggle("stopping", busy);
}

// 壓縮舊對話時沒有串流可以中止，跟「正在回覆」是不同的忙碌狀態，所以送出鍵直接鎖住
// 而不是變成停止鍵。
function setCompressing(active) {
  $("inspiration-input").disabled = active;
  $("inspiration-clear").disabled = active;
  $("inspiration-send").disabled = active;
}

function startCooldown(seconds) {
  clearTimeout(cooldownTimer);
  const button = $("inspiration-send");
  let remaining = seconds;
  const tick = () => {
    if (remaining <= 0 || activeController) {
      button.disabled = Boolean(activeController);
      status(activeController ? "正在回覆…" : "準備好聊聊了");
      return;
    }
    button.disabled = true;
    status(`稍等 ${remaining} 秒再送下一句…`);
    remaining -= 1;
    cooldownTimer = setTimeout(tick, 1000);
  };
  tick();
}

// 逐行解析 OpenRouter 轉發過來的 SSE：Worker 完全不重組內容，直接把上游的位元組
// 原封不動接回來，所以這裡拿到的是標準的 OpenAI 相容格式（"data: {...}" 一行一個
// JSON，結尾是 "data: [DONE]"；中間可能夾雜 ":" 開頭的保活註解行，直接忽略）。
async function streamChat(messages, { onDelta, signal }) {
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!response.ok || !response.body) {
    let message = `發生錯誤（HTTP ${response.status}）`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      // 回應不是 JSON 就用上面預設的訊息
    }
    const failure = new Error(message);
    failure.status = response.status;
    throw failure;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedAny = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }

      const delta = parsed?.choices?.[0]?.delta;
      const chunk = typeof delta?.content === "string" ? delta.content : "";
      if (chunk) {
        receivedAny = true;
        onDelta(chunk);
      }
    }
  }

  return receivedAny;
}

function conversationChars(list = conversation) {
  return list.reduce((sum, message) => sum + message.content.length, 0);
}

// 檢查是否需要把較舊的對話濃縮成摘要；只在對話「已經結束一輪」（最後一則是助理回覆，
// 或對話是空的）時呼叫，避免壓縮到還沒送出回覆的半截對話。壓縮本身也是一次打向
// Worker 的請求，會吃掉一次 5 秒冷卻，所以完成後會照樣跑一次冷卻倒數，確保接在後面
// 真正要送的訊息不會被 Worker 用 429 擋下來。壓縮失敗（網路問題、剛好卡冷卻等）就
// 直接放棄，讓原本要送的訊息照舊送出，最壞情況只是繼續讓 Worker 的長度上限去擋。
async function compressConversation() {
  if (conversation.length <= COMPRESS_KEEP_RECENT) return;
  if (conversationChars() < COMPRESS_TRIGGER_CHARS && conversation.length < COMPRESS_TRIGGER_MESSAGES) return;

  const older = conversation.slice(0, conversation.length - COMPRESS_KEEP_RECENT);
  const recent = conversation.slice(conversation.length - COMPRESS_KEEP_RECENT);

  status("對話有點長了，先幫你整理一下重點…");
  let summary = "";
  try {
    const receivedAny = await streamChat(
      [...older, { role: "user", content: COMPRESS_INSTRUCTION }],
      { onDelta: chunk => { summary += chunk; } },
    );
    if (!receivedAny || !summary.trim()) return;
  } catch {
    return;
  }

  conversation = [
    { role: "user", content: `（先前對話摘要，作為背景參考，不需要特別回應）\n${summary.trim()}` },
    { role: "assistant", content: "好，我記得目前討論的方向了，我們繼續。" },
    ...recent,
  ];

  await new Promise(resolve => {
    startCooldown(COOLDOWN_SECONDS);
    setTimeout(resolve, COOLDOWN_SECONDS * 1000 + 300);
  });
}

async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed || activeController) return;

  error();
  conversation.push({ role: "user", content: trimmed });
  appendMessage("user", trimmed);

  $("inspiration-input").value = "";
  autoResizeInput();

  const assistantBubble = appendMessage("assistant", "");
  assistantBubble.closest(".inspiration-message").classList.add("pending");

  activeController = new AbortController();
  setBusy(true);
  status("正在回覆…");

  let assistantText = "";
  let receivedAny = false;

  try {
    receivedAny = await streamChat(conversation, {
      signal: activeController.signal,
      onDelta: chunk => {
        assistantText += chunk;
        assistantBubble.textContent = assistantText;
        assistantBubble.closest(".inspiration-message").classList.remove("pending");
        scrollToBottom();
      },
    });

    if (receivedAny) {
      conversation.push({ role: "assistant", content: assistantText });
    } else {
      assistantBubble.closest(".inspiration-message").remove();
      conversation.pop();
      error("沒有收到任何回覆內容，請再試一次。");
    }
  } catch (cause) {
    if (cause?.name === "AbortError") {
      if (assistantText) {
        conversation.push({ role: "assistant", content: assistantText });
        assistantBubble.textContent = `${assistantText}（已中止）`;
      } else {
        assistantBubble.closest(".inspiration-message").remove();
        conversation.pop();
      }
    } else {
      assistantBubble.closest(".inspiration-message").remove();
      conversation.pop();
      if (cause?.status === 429) {
        error(cause.message);
      } else {
        error(cause?.message || "連線發生問題，請稍後再試。");
      }
    }
  } finally {
    activeController = null;
    setBusy(false);
    startCooldown(COOLDOWN_SECONDS);
  }
}

function clearConversation() {
  if (activeController) activeController.abort();
  conversation = [];
  $("inspiration-messages").innerHTML = "";
  const empty = document.createElement("p");
  empty.className = "inspiration-empty";
  empty.id = "inspiration-empty";
  empty.textContent = "丟一句「最近想寫一首關於＿＿的歌」或「幫我的 MV 想幾個開場畫面」試試看，也可以單純聊聊卡關的地方。";
  $("inspiration-messages").append(empty);
  error();
  status("準備好聊聊了");
}

async function handleSubmit(text) {
  if (activeController || compressing) return;
  compressing = true;
  setCompressing(true);
  try {
    await compressConversation();
  } finally {
    compressing = false;
    setCompressing(false);
  }
  await sendMessage(text);
}

$("inspiration-form").addEventListener("submit", event => {
  event.preventDefault();
  if (activeController) {
    activeController.abort();
    return;
  }
  if (compressing) return;
  const input = $("inspiration-input");
  if (!input.value.trim()) return;
  if (input.value.length > MAX_MESSAGE_CHARS) {
    error(`單則訊息最多 ${MAX_MESSAGE_CHARS} 字，請縮短內容。`);
    return;
  }
  const text = input.value;
  input.value = "";
  autoResizeInput();
  void handleSubmit(text);
});

$("inspiration-input").addEventListener("input", autoResizeInput);
$("inspiration-input").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("inspiration-form").requestSubmit();
  }
});

$("inspiration-clear").addEventListener("click", clearConversation);

window.addEventListener("beforeunload", () => {
  if (activeController) activeController.abort();
});
