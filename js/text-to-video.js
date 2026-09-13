import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { deleteStoredValue, loadStoredMedia, saveStoredMedia } from "./media-store.js";
import { getApiKey, listApiKeys, saveApiKey } from "./api-keys.js";

const VIDEO_PROXY_URL = "https://model-proxy.yustellar.idv.tw/minimax/video";
const CREATE_VIDEO_URL = `${VIDEO_PROXY_URL}/generate`;
const QUERY_VIDEO_URL = `${VIDEO_PROXY_URL}/query`;
const DOWNLOAD_VIDEO_URL = `${VIDEO_PROXY_URL}/download`;
const BYTEPLUS_VIDEO_PROXY_URL = "https://model-proxy.yustellar.idv.tw/byteplus/video";
const BYTEPLUS_CREATE_VIDEO_URL = `${BYTEPLUS_VIDEO_PROXY_URL}/generate`;
const BYTEPLUS_QUERY_VIDEO_URL = `${BYTEPLUS_VIDEO_PROXY_URL}/query`;
const BYTEPLUS_DOWNLOAD_VIDEO_URL = `${BYTEPLUS_VIDEO_PROXY_URL}/download`;
const POLL_INTERVAL = 5000;
const POLL_TIMEOUT = 30 * 60 * 1000;
const $ = id => document.getElementById(id);
const VIDEO_MODELS = Object.freeze({
  "MiniMax-H3": Object.freeze({ label: "MiniMax H3", provider: "minimax", apiKey: "MiniMax", resolutions: ["768P", "2K"], defaultResolution: "768P", minimumDuration: 4, maximumDuration: 15 }),
  "MiniMax-H3-Max": Object.freeze({ label: "MiniMax H3 Max", provider: "minimax", apiKey: "MiniMax", resolutions: ["480P", "768P"], defaultResolution: "768P", minimumDuration: 5, maximumDuration: 15 }),
  "dreamina-seedance-2-5-260628": Object.freeze({ label: "Seedance 2.5", provider: "byteplus", apiKey: "BytePlus", resolutions: ["480p", "720p"], defaultResolution: "720p", minimumDuration: 4, maximumDuration: 30 }),
  "dreamina-seedance-2-0-260128": Object.freeze({ label: "Seedance 2.0", provider: "byteplus", apiKey: "BytePlus", resolutions: ["480p", "720p", "1080p", "4k"], defaultResolution: "720p", minimumDuration: 4, maximumDuration: 15 }),
});

const settings = loadSettings();
applyTheme(settings.mode, settings.theme);

let busy = false;
let generatedVideoBlob = null;
let generatedVideoUrl = "";
let generatedVideoRemoteUrl = "";
let generatedVideoProvider = "minimax";
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
  if (!busy) setStatus($("video-prompt").value.trim() ? "影片細節已輸入" : "等待輸入影片細節");
  syncGenerateAvailability();
}

function openVideoPromptBuilder() {
  if (busy) return;
  $("video-prompt-builder-dialog").showModal();
  $("video-prompt-time").focus();
}

function submitVideoPromptBuilder(event) {
  event.preventDefault();
  const fields = [
    ["時間", $("video-prompt-time").value.trim()],
    ["場景", $("video-prompt-scene").value.trim()],
    ["鏡頭", $("video-prompt-camera").value.trim()],
    ["動作", $("video-prompt-action").value.trim()],
    ["對白", $("video-prompt-dialogue").value.trim()],
  ];
  const block = fields.filter(([, value]) => value).map(([label, value]) => `${label}：${value}`).join("\n");
  if (!block) return;
  const prompt = $("video-prompt");
  prompt.value = prompt.value.trim() ? `${prompt.value.trimEnd()}\n\n${block}\n\n` : `${block}\n\n`;
  $("video-prompt-builder-form").reset();
  $("video-prompt-builder-dialog").close();
  syncDraftStatus();
  prompt.focus();
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
  replaceOptions($("video-resolution"), model.resolutions, model.resolutions.includes(previousResolution) ? previousResolution : model.defaultResolution);
  const previousDuration = Number($("video-duration").value) || 5;
  const durations = Array.from({ length: model.maximumDuration - model.minimumDuration + 1 }, (_, index) => String(model.minimumDuration + index));
  replaceOptions($("video-duration"), durations, String(Math.min(model.maximumDuration, Math.max(model.minimumDuration, previousDuration))));
  $("video-duration").querySelectorAll("option").forEach(option => { option.textContent = `${option.value} 秒`; });
  $("video-api-key").textContent = getApiKey(modelId) ? "已設定" : "未設定";
  $("confirm-video-generation-message").textContent = `影片生成會消耗 ${model.apiKey} 帳戶額度，是否確定開始生成？`;
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
  $("video-api-key-help").textContent = model.provider === "minimax"
    ? "MiniMax H3 系列須使用一般 Pay-as-you-go API KEY；Token Plan／Credit Key 不支援。金鑰只會保存在目前瀏覽器。"
    : "請使用 BytePlus ModelArk API KEY。金鑰只會保存在目前瀏覽器，並透過代理服務送至 BytePlus。";
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
  for (const id of ["video-prompt", "open-video-prompt-builder", "video-model", "video-resolution", "video-duration", "video-ratio", "video-api-key"]) $(id).disabled = value;
  $("download-video").disabled = value || (!generatedVideoBlob && !generatedVideoRemoteUrl);
  $("apply-video-background").disabled = value || !generatedVideoBlob;
  syncGenerateAvailability();
}

function apiError(body, fallback = "", provider = "minimax") {
  const rawCode = body?.base_resp?.status_code ?? body?.error?.code ?? body?.code;
  const code = Number(rawCode);
  const message = body?.error?.message
    || body?.message
    || (typeof body?.error === "string" ? body.error : "")
    || body?.base_resp?.status_msg
    || "";
  if (code === 1008 || /insufficient balance/i.test(message)) {
    return "目前 MiniMax API KEY 所屬帳戶餘額不足（1008），請充值或更換 API KEY。";
  }
  if (code === 2013 && /TokenPlan|Credit.*MiniMax-H3/i.test(message)) {
    return "目前使用的 MiniMax Token Plan／Credit Key 不支援 H3 系列（2013）。請改用一般 Pay-as-you-go API KEY，並確認帳戶有足夠餘額。";
  }
  const service = provider === "byteplus" ? "BytePlus" : "MiniMax";
  if (Number.isFinite(code) && code !== 0) return message ? `${message}（${code}）` : `${service} API 錯誤（${code}）`;
  return fallback ? message || fallback : "";
}

async function fetchJson(url, options, provider = "minimax") {
  const response = await fetch(url, options);
  let body;
  try {
    body = await response.json();
  } catch {
    const service = provider === "byteplus" ? "BytePlus" : "MiniMax";
    if (!response.ok) throw Error(`${service} API 回傳 ${response.status}`);
    throw Error(`${service} API 回傳無法解析的資料。`);
  }
  const service = provider === "byteplus" ? "BytePlus" : "MiniMax";
  const error = apiError(body, response.ok ? "" : `${service} API 回傳 ${response.status}`, provider);
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

function providerEndpoints(provider) {
  return provider === "byteplus"
    ? { create: BYTEPLUS_CREATE_VIDEO_URL, query: BYTEPLUS_QUERY_VIDEO_URL, download: BYTEPLUS_DOWNLOAD_VIDEO_URL }
    : { create: CREATE_VIDEO_URL, query: QUERY_VIDEO_URL, download: DOWNLOAD_VIDEO_URL };
}

async function pollVideoTask(taskId, apiKey, model, signal) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT) {
    const result = await fetchJson(providerEndpoints(model.provider).query, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, taskId }),
      cache: "no-store",
      signal,
    }, model.provider);
    const task = model.provider === "byteplus" ? result : result?.task;
    if (!task) throw Error(`${model.apiKey} 沒有回傳任務資料。`);
    const taskState = String(task.status || "").toLowerCase();
    if (taskState === "succeeded") {
      const videoUrl = model.provider === "byteplus" ? task.content?.video_url : task.content?.url;
      if (!videoUrl) throw Error("影片任務完成，但沒有回傳影片網址。");
      task.videoUrl = videoUrl;
      return task;
    }
    if (["failed", "cancelled", "expired"].includes(taskState)) throw Error(task.error?.message || task.message || `影片生成${taskState === "cancelled" ? "已取消" : taskState === "expired" ? "已逾時" : "失敗"}。`);
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    $("video-generation-lock-title").textContent = taskState === "running" ? "影片生成中" : "影片任務排隊中";
    $("video-generation-lock-detail").textContent = `任務 ${taskId} · 已等待 ${elapsed} 秒`;
    setStatus(`${taskState === "running" ? "影片生成中" : "影片排隊中"} · 已等待 ${elapsed} 秒`);
    await wait(POLL_INTERVAL, signal);
  }
  throw Error(`影片生成等待超過 30 分鐘，請稍後至 ${model.apiKey} 查詢任務狀態。`);
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
  $("retry-save-video").hidden = true;
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

async function showVideoResult(remoteUrl, provider = generatedVideoProvider, expandResult = false) {
  releaseVideo();
  generatedVideoRemoteUrl = remoteUrl;
  generatedVideoProvider = provider;
  try {
    const response = await fetch(providerEndpoints(provider).download, {
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
    $("retry-save-video").hidden = true;
  } catch {
    showError("影片已生成，但下載代理無法讀取影片檔案；仍可播放或開啟下載網址。保存與套用背景功能暫時無法使用。");
    $("retry-save-video").hidden = false;
  }
  presentVideo();
  if (expandResult) $("video-result-panel").open = true;
}

function videoFilename(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `video_${day}_${time}.mp4`;
}

async function generateVideo() {
  const prompt = $("video-prompt").value.trim();
  const modelId = $("video-model").value;
  const model = VIDEO_MODELS[modelId];
  const apiKey = getApiKey(modelId)?.value || "";
  if (!prompt || !apiKey || busy) return;
  showError();
  setBusy(true);
  generationAbort = new AbortController();
  $("video-generation-lock-title").textContent = "正在建立影片生成任務";
  $("video-generation-lock-detail").textContent = "請保持此頁面開啟，完成時間依服務狀態而定。";
  try {
    setStatus(`正在建立 ${model.apiKey} 影片任務…`);
    const payload = {
      model: modelId,
      content: [{ type: "text", text: prompt }],
      resolution: $("video-resolution").value,
      duration: Number($("video-duration").value),
      ratio: $("video-ratio").value,
    };
    if (model.provider === "byteplus") {
      payload.generate_audio = true;
      payload.watermark = false;
    }
    const created = await fetchJson(providerEndpoints(model.provider).create, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        payload,
      }),
      cache: "no-store",
      signal: generationAbort.signal,
    }, model.provider);
    const taskId = model.provider === "byteplus" ? created?.id : created?.task_id;
    if (!taskId) throw Error(`${model.apiKey} 沒有回傳影片任務 ID。`);
    const task = await pollVideoTask(taskId, apiKey, model, generationAbort.signal);
    $("video-generation-lock-title").textContent = "影片已完成，正在載入結果";
    $("video-generation-lock-detail").textContent = "正在準備預覽與下載檔案…";
    await showVideoResult(task.videoUrl, model.provider, true);
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

function openGenerateConfirmation() {
  if ($("generate-video").disabled || busy) return;
  $("confirm-video-generation-dialog").showModal();
}

function confirmVideoGeneration(event) {
  event.preventDefault();
  $("confirm-video-generation-dialog").close();
  void generateVideo();
}

$("video-prompt").addEventListener("input", syncDraftStatus);
$("open-video-prompt-builder").addEventListener("click", openVideoPromptBuilder);
$("video-prompt-builder-form").addEventListener("submit", submitVideoPromptBuilder);
$("cancel-video-prompt-builder").addEventListener("click", () => $("video-prompt-builder-dialog").close());
$("video-model").addEventListener("change", syncModelDetails);
$("video-resolution").addEventListener("change", syncResultHeading);
$("video-ratio").addEventListener("change", syncResultHeading);
$("video-api-key").addEventListener("click", openApiKeyDialog);
$("video-api-key-source").addEventListener("change", copyApiKeyFromSource);
$("video-api-key-form").addEventListener("submit", submitApiKey);
$("cancel-video-api-key").addEventListener("click", () => $("video-api-key-dialog").close());
$("generate-video").addEventListener("click", openGenerateConfirmation);
$("confirm-video-generation-form").addEventListener("submit", confirmVideoGeneration);
$("cancel-video-generation").addEventListener("click", () => $("confirm-video-generation-dialog").close());
$("video-settings-panel").addEventListener("toggle", () => {
  if ($("video-settings-panel").open) $("video-description-panel").open = false;
});

$("download-video").addEventListener("click", () => {
  if (busy || (!generatedVideoBlob && !generatedVideoRemoteUrl)) return;
  const link = document.createElement("a");
  link.href = generatedVideoUrl || generatedVideoRemoteUrl;
  link.download = generatedVideoBlob ? videoFilename() : "";
  if (!generatedVideoBlob) link.target = "_blank";
  link.rel = "noopener";
  link.click();
});

$("retry-save-video").addEventListener("click", async () => {
  if (!generatedVideoRemoteUrl || busy) return;
  setBusy(true, false);
  showError();
  setStatus("正在重新下載並保存影片…");
  await showVideoResult(generatedVideoRemoteUrl, generatedVideoProvider);
  setStatus(generatedVideoBlob ? "影片已保存到瀏覽器" : "影片保存失敗", generatedVideoBlob ? "success" : "error");
  setBusy(false);
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
