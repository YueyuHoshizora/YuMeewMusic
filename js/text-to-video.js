import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { deleteStoredValue, loadStoredMedia, saveStoredMedia } from "./media-store.js";
import { getApiKey, listApiKeys, saveApiKey } from "./api-keys.js";

const VIDEO_PROXY_URL = "https://minimax-proxy.yustellar.idv.tw/video";
const CREATE_VIDEO_URL = `${VIDEO_PROXY_URL}/generate`;
const QUERY_VIDEO_URL = `${VIDEO_PROXY_URL}/query`;
const DOWNLOAD_VIDEO_URL = `${VIDEO_PROXY_URL}/download`;
const POLL_INTERVAL = 5000;
const POLL_TIMEOUT = 30 * 60 * 1000;
const $ = id => document.getElementById(id);
const VIDEO_MODELS = Object.freeze({
  "MiniMax-H3": Object.freeze({ label: "MiniMax H3", apiKey: "MiniMax", resolutions: ["768P", "2K"], minimumDuration: 4 }),
  "MiniMax-H3-Max": Object.freeze({ label: "MiniMax H3 Max", apiKey: "MiniMax", resolutions: ["480P", "768P"], minimumDuration: 5 }),
});

const settings = loadSettings();
applyTheme(settings.mode, settings.theme);

let busy = false;
let generatedVideoBlob = null;
let generatedVideoUrl = "";
let generatedVideoRemoteUrl = "";
let generationAbort = null;

function setStatus(text, mode = "") {
  $("video-generation-status").textContent = text;
  $("video-generation-status").className = `generation-status ${mode}`.trim();
}

function showError(text = "") {
  $("video-generation-error").textContent = text;
  $("video-generation-error").hidden = !text;
}

function syncGenerateAvailability() {
  const prompt = $("video-prompt").value.trim();
  const hasKey = Boolean(getApiKey($("video-model").value));
  $("generate-video").disabled = busy || !prompt || !hasKey;
}

function syncDraftStatus() {
  if (!busy) setStatus($("video-prompt").value.trim() ? "影片描述已輸入" : "等待輸入影片描述");
  syncGenerateAvailability();
}

function replaceOptions(select, values, selected) {
  select.replaceChildren(...values.map(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === selected;
    return option;
  }));
}

function syncModelDetails() {
  const modelId = $("video-model").value;
  const model = VIDEO_MODELS[modelId];
  const previousResolution = $("video-resolution").value;
  replaceOptions($("video-resolution"), model.resolutions, model.resolutions.includes(previousResolution) ? previousResolution : "768P");
  const previousDuration = Number($("video-duration").value) || 5;
  const durations = Array.from({ length: 16 - model.minimumDuration }, (_, index) => String(model.minimumDuration + index));
  replaceOptions($("video-duration"), durations, String(Math.max(model.minimumDuration, previousDuration)));
  $("video-duration").querySelectorAll("option").forEach(option => { option.textContent = `${option.value} 秒`; });
  $("video-api-key").textContent = getApiKey(modelId) ? "已設定" : "未設定";
  syncResultHeading();
  syncGenerateAvailability();
}

function syncResultHeading() {
  $("result-video-resolution").textContent = $("video-resolution").value;
  $("result-video-ratio").textContent = `${$("video-ratio").value} · MP4`;
}

function syncApiKeySources(modelId) {
  const select = $("video-api-key-source");
  const sources = listApiKeys().filter(key => key.id !== modelId);
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = sources.length ? "選擇已保存的金鑰…" : "目前沒有其他已保存的金鑰";
  select.replaceChildren(placeholder, ...sources.map(source => {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.label;
    return option;
  }));
  select.disabled = !sources.length;
}

function openApiKeyDialog() {
  const modelId = $("video-model").value;
  const model = VIDEO_MODELS[modelId];
  if (!model || busy) return;
  $("video-api-key-dialog-title").textContent = `${model.label} API KEY`;
  $("video-api-key-input").value = "";
  $("video-api-key-input").placeholder = getApiKey(modelId) ? "輸入新金鑰以取代目前金鑰" : "輸入 API KEY";
  $("video-api-key-error").hidden = true;
  syncApiKeySources(modelId);
  $("video-api-key-dialog").showModal();
  $("video-api-key-input").focus();
}

function copyApiKeyFromSource() {
  const source = getApiKey($("video-api-key-source").value);
  if (!source) return;
  $("video-api-key-input").value = source.value;
  $("video-api-key-error").hidden = true;
}

function submitApiKey(event) {
  event.preventDefault();
  const modelId = $("video-model").value;
  const model = VIDEO_MODELS[modelId];
  const value = $("video-api-key-input").value.trim();
  if (!model) return;
  if (!value) {
    $("video-api-key-error").textContent = "請輸入 API KEY。";
    $("video-api-key-error").hidden = false;
    return;
  }
  if (!saveApiKey(modelId, model.label, value)) {
    $("video-api-key-error").textContent = "瀏覽器無法保存 API KEY。";
    $("video-api-key-error").hidden = false;
    return;
  }
  $("video-api-key-dialog").close();
  syncModelDetails();
}

function setBusy(value, showLock = value) {
  busy = value;
  document.body.setAttribute("aria-busy", String(value));
  $("video-generation-lock").hidden = !showLock;
  for (const id of ["video-prompt", "video-model", "video-resolution", "video-duration", "video-ratio", "video-api-key"]) $(id).disabled = value;
  $("download-video").disabled = value || (!generatedVideoBlob && !generatedVideoRemoteUrl);
  $("apply-video-background").disabled = value || !generatedVideoBlob;
  syncGenerateAvailability();
}

function miniMaxError(body, fallback = "") {
  const rawCode = body?.base_resp?.status_code ?? body?.error?.code ?? body?.code;
  const code = Number(rawCode);
  const message = body?.error?.message
    || (typeof body?.error === "string" ? body.error : "")
    || body?.message
    || body?.base_resp?.status_msg
    || "";
  if (code === 1008 || /insufficient balance/i.test(message)) {
    return "目前 MiniMax API KEY 所屬帳戶餘額不足（1008），請充值或更換 API KEY。";
  }
  if (code === 2013 && /TokenPlan|Credit.*MiniMax-H3/i.test(message)) {
    return "目前使用的 MiniMax Token Plan／Credit Key 不支援 H3 系列（2013）。請改用一般 Pay-as-you-go API KEY，並確認帳戶有足夠餘額。";
  }
  if (Number.isFinite(code) && code !== 0) return message ? `${message}（${code}）` : `MiniMax API 錯誤（${code}）`;
  return fallback ? message || fallback : "";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  let body;
  try {
    body = await response.json();
  } catch {
    if (!response.ok) throw Error(`MiniMax API 回傳 ${response.status}`);
    throw Error("MiniMax API 回傳無法解析的資料。");
  }
  const error = miniMaxError(body, response.ok ? "" : `MiniMax API 回傳 ${response.status}`);
  if (error) throw Error(error);
  return body;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function pollVideoTask(taskId, apiKey, signal) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT) {
    const result = await fetchJson(QUERY_VIDEO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, taskId }),
      cache: "no-store",
      signal,
    });
    const task = result?.task;
    if (!task) throw Error("MiniMax 沒有回傳任務資料。");
    const taskState = String(task.status || "").toLowerCase();
    if (taskState === "succeeded") {
      if (!task.content?.url) throw Error("影片任務完成，但沒有回傳影片網址。");
      return task;
    }
    if (["failed", "cancelled"].includes(taskState)) throw Error(task.error?.message || task.message || `影片生成${taskState === "cancelled" ? "已取消" : "失敗"}。`);
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    $("video-generation-lock-title").textContent = taskState === "running" ? "影片生成中" : "影片任務排隊中";
    $("video-generation-lock-detail").textContent = `任務 ${taskId} · 已等待 ${elapsed} 秒`;
    setStatus(`${taskState === "running" ? "影片生成中" : "影片排隊中"} · 已等待 ${elapsed} 秒`);
    await wait(POLL_INTERVAL, signal);
  }
  throw Error("影片生成等待超過 30 分鐘，請稍後查詢 MiniMax 任務狀態。");
}

function releaseVideo() {
  const video = $("generated-video");
  video.pause();
  video.removeAttribute("src");
  video.load();
  if (generatedVideoUrl) URL.revokeObjectURL(generatedVideoUrl);
  generatedVideoBlob = null;
  generatedVideoUrl = "";
  generatedVideoRemoteUrl = "";
}

function presentVideo() {
  const video = $("generated-video");
  video.src = generatedVideoUrl || generatedVideoRemoteUrl;
  video.hidden = false;
  $("empty-video-result").hidden = true;
  video.load();
  $("download-video").disabled = false;
  $("apply-video-background").disabled = !generatedVideoBlob;
}

async function restoreLastGeneratedVideo() {
  try {
    const record = await loadStoredMedia("generated-video");
    if (!record?.blob?.size || !record.blob.type?.startsWith("video/") || busy) return;
    releaseVideo();
    generatedVideoBlob = record.blob;
    generatedVideoUrl = URL.createObjectURL(generatedVideoBlob);
    presentVideo();
    setStatus("已載入上次生成結果", "success");
  } catch {}
}

async function showVideoResult(remoteUrl) {
  releaseVideo();
  generatedVideoRemoteUrl = remoteUrl;
  try {
    const response = await fetch(DOWNLOAD_VIDEO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: remoteUrl }),
      cache: "no-store",
    });
    if (!response.ok) throw Error(`影片下載回傳 ${response.status}`);
    const blob = await response.blob();
    if (!blob.size) throw Error("影片檔案內容為空。");
    generatedVideoBlob = new Blob([blob], { type: blob.type || "video/mp4" });
    generatedVideoUrl = URL.createObjectURL(generatedVideoBlob);
    const cachedFile = new File([generatedVideoBlob], videoFilename(), { type: generatedVideoBlob.type || "video/mp4", lastModified: Date.now() });
    await saveStoredMedia("generated-video", cachedFile).catch(() => {
      showError("影片已生成，但瀏覽器無法保存最後一次生成結果。");
    });
  } catch {
    showError("影片已生成，但下載代理無法讀取影片檔案；仍可播放或開啟下載網址。保存與套用背景功能暫時無法使用。");
  }
  presentVideo();
}

function videoFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `yumeew-ai-video-${stamp}.mp4`;
}

async function generateVideo() {
  const prompt = $("video-prompt").value.trim();
  const modelId = $("video-model").value;
  const apiKey = getApiKey(modelId)?.value || "";
  if (!prompt || !apiKey || busy) return;
  showError();
  setBusy(true);
  generationAbort = new AbortController();
  $("video-generation-lock-title").textContent = "正在建立影片生成任務";
  $("video-generation-lock-detail").textContent = "請保持此頁面開啟，完成時間依服務狀態而定。";
  try {
    setStatus("正在建立 MiniMax 影片任務…");
    const created = await fetchJson(CREATE_VIDEO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        payload: {
          model: modelId,
          content: [{ type: "text", text: prompt }],
          resolution: $("video-resolution").value,
          duration: Number($("video-duration").value),
          ratio: $("video-ratio").value,
        },
      }),
      cache: "no-store",
      signal: generationAbort.signal,
    });
    if (!created?.task_id) throw Error("MiniMax 沒有回傳影片任務 ID。");
    const task = await pollVideoTask(created.task_id, apiKey, generationAbort.signal);
    $("video-generation-lock-title").textContent = "影片已完成，正在載入結果";
    $("video-generation-lock-detail").textContent = "正在準備預覽與下載檔案…";
    await showVideoResult(task.content.url);
    setStatus(`生成完成 · ${task.resolution || $("video-resolution").value} · ${task.duration || $("video-duration").value} 秒`, "success");
  } catch (error) {
    if (error?.name !== "AbortError") {
      const message = error instanceof TypeError
        ? "瀏覽器無法連線至影片生成服務，請稍後再試。"
        : error.message || "影片生成失敗。";
      showError(message);
      setStatus("影片生成失敗", "error");
    }
  } finally {
    generationAbort = null;
    setBusy(false);
  }
}

$("video-prompt").addEventListener("input", syncDraftStatus);
$("video-model").addEventListener("change", syncModelDetails);
$("video-resolution").addEventListener("change", syncResultHeading);
$("video-ratio").addEventListener("change", syncResultHeading);
$("video-api-key").addEventListener("click", openApiKeyDialog);
$("video-api-key-source").addEventListener("change", copyApiKeyFromSource);
$("video-api-key-form").addEventListener("submit", submitApiKey);
$("cancel-video-api-key").addEventListener("click", () => $("video-api-key-dialog").close());
$("generate-video").addEventListener("click", () => void generateVideo());

$("download-video").addEventListener("click", () => {
  if (busy || (!generatedVideoBlob && !generatedVideoRemoteUrl)) return;
  const link = document.createElement("a");
  link.href = generatedVideoUrl || generatedVideoRemoteUrl;
  link.download = generatedVideoBlob ? videoFilename() : "";
  if (!generatedVideoBlob) link.target = "_blank";
  link.rel = "noopener";
  link.click();
});

$("apply-video-background").addEventListener("click", async () => {
  if (!generatedVideoBlob || busy) return;
  setBusy(true);
  setStatus("正在保存為主畫面背景…");
  try {
    const file = new File([generatedVideoBlob], videoFilename(), { type: generatedVideoBlob.type || "video/mp4", lastModified: Date.now() });
    await saveStoredMedia("image", file);
    await deleteStoredValue("image-video-project").catch(() => {});
    window.location.href = "./";
  } catch (error) {
    showError(error.message || "無法保存影片到瀏覽器。");
    setStatus("背景套用失敗", "error");
    setBusy(false);
  }
});

window.addEventListener("pagehide", () => {
  generationAbort?.abort();
  releaseVideo();
});

syncModelDetails();
syncDraftStatus();
void restoreLastGeneratedVideo();
