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

const restored = loadSettings();
applyTheme(restored.mode, restored.theme);

// 對話只存在這個分頁的記憶體裡，重新整理就會清空，不寫入 localStorage 或
// IndexedDB——這是刻意的隱私選擇，聊天內容會送到外部的 OpenRouter，不應該
// 再額外留一份在使用者裝置上。
let conversation = [];
let activeController = null;
let cooldownTimer = null;

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

$("inspiration-form").addEventListener("submit", event => {
  event.preventDefault();
  if (activeController) {
    activeController.abort();
    return;
  }
  const input = $("inspiration-input");
  if (input.value.length > MAX_MESSAGE_CHARS) {
    error(`單則訊息最多 ${MAX_MESSAGE_CHARS} 字，請縮短內容。`);
    return;
  }
  void sendMessage(input.value);
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
