import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { deleteStoredValue, saveStoredMedia } from "./media-store.js";
import { getApiKey, maskApiKey, saveApiKey } from "./api-keys.js";

const WORKER_URL = "https://flux-klein-worker.yustellar.idv.tw/generate";
const AUTOCOMPLETE_URL = "https://flux-klein-worker.yustellar.idv.tw/autocomplete";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";
const QUOTA_MESSAGE = "今日圖片生成額度已用完，請於早上 8 點（台灣時間）額度重置後再試。";
const $ = id => document.getElementById(id);

async function callFlux2Klein4B({ prompt, enhance }) {
  return fetch(WORKER_URL, {
    method: "POST",
    headers: {
      Accept: "image/jpeg,image/*",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, enhance }),
    cache: "no-store",
  });
}

function base64ImageBlob(encoded, type = "image/jpeg") {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

async function callGptImage25Sunburst({ prompt, apiKey }) {
  const response = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2.5-sunburst",
      prompt,
      size: "1280x720",
      quality: "auto",
      output_format: "jpeg",
    }),
    cache: "no-store",
  });
  if (!response.ok) return response;
  const result = await response.json();
  const image = result?.data?.[0];
  if (image?.b64_json) {
    return new Response(base64ImageBlob(image.b64_json), {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    });
  }
  if (image?.url) return fetch(image.url, { cache: "no-store" });
  throw Error("OpenAI 沒有回傳可用的圖片資料。");
}

const IMAGE_MODELS = Object.freeze({
  "flux-2-klein-4b": Object.freeze({
    label: "Flux.2 Klein 4B",
    provider: "Cloudflare Workers AI",
    apiKey: "Free",
    call: callFlux2Klein4B,
  }),
  "gpt-image-2.5-sunburst": Object.freeze({
    label: "GPT-Image-2.5 Sunburst",
    provider: "OpenAI Image API",
    apiKey: "OpenAI",
    call: callGptImage25Sunburst,
  }),
});

const settings = loadSettings();
applyTheme(settings.mode, settings.theme);

let generatedBlob = null;
let generatedUrl = "";
let busy = false;
let composing = false;
const resultFrame = $("generated-image-frame");

const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;

function syncResultFullscreen() {
  const active = fullscreenElement() === resultFrame || resultFrame.classList.contains("fullscreen-fallback");
  resultFrame.classList.toggle("is-fullscreen", active);
  resultFrame.setAttribute("aria-label", active ? "恢復生成結果原尺寸" : "放大生成結果至全螢幕");
  $("result-fullscreen-hint").textContent = active ? "↙ 點擊恢復" : "⛶ 點擊全螢幕";
}

function closeFullscreenFallback() {
  resultFrame.classList.remove("fullscreen-fallback");
  document.body.classList.remove("result-fullscreen-open");
  syncResultFullscreen();
}

function openFullscreenFallback() {
  resultFrame.classList.add("fullscreen-fallback");
  document.body.classList.add("result-fullscreen-open");
  syncResultFullscreen();
}

async function toggleResultFullscreen() {
  if (resultFrame.classList.contains("fullscreen-fallback")) {
    closeFullscreenFallback();
    return;
  }
  try {
    if (fullscreenElement()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    } else if (resultFrame.requestFullscreen) {
      await resultFrame.requestFullscreen();
    } else if (resultFrame.webkitRequestFullscreen) {
      await resultFrame.webkitRequestFullscreen();
    } else {
      openFullscreenFallback();
    }
  } catch {
    openFullscreenFallback();
  }
}

function status(text, mode = "") {
  $("generation-status").textContent = text;
  $("generation-status").className = `generation-status ${mode}`.trim();
}

function showError(text = "") {
  $("generation-error").textContent = text;
  $("generation-error").hidden = !text;
}

function syncModelDetails() {
  const modelId = $("image-model").value;
  const model = IMAGE_MODELS[modelId];
  const isFree = model?.apiKey === "Free";
  const storedKey = isFree ? null : getApiKey(modelId);
  $("model-provider-note").textContent = model?.provider || "圖片服務";
  $("model-api-key").textContent = isFree ? "Free" : storedKey ? maskApiKey(storedKey.value) : "點擊輸入";
  $("model-api-key").disabled = busy || isFree || !model;
}

function openApiKeyDialog() {
  const modelId = $("image-model").value;
  const model = IMAGE_MODELS[modelId];
  if (!model || model.apiKey === "Free" || busy) return;
  $("api-key-dialog-title").textContent = `${model.label} API KEY`;
  $("api-key-dialog-description").textContent = "金鑰只會保存在目前瀏覽器的 localStorage，頁面僅顯示遮蔽內容。";
  $("api-key-input").value = "";
  $("api-key-input").placeholder = getApiKey(modelId) ? "輸入新金鑰以取代目前金鑰" : "輸入 API KEY";
  $("api-key-error").hidden = true;
  $("api-key-dialog").showModal();
  $("api-key-input").focus();
}

function submitApiKey(event) {
  event.preventDefault();
  const modelId = $("image-model").value;
  const model = IMAGE_MODELS[modelId];
  const value = $("api-key-input").value.trim();
  if (!model || model.apiKey === "Free") return;
  if (!value) {
    $("api-key-error").textContent = "請輸入 API KEY。";
    $("api-key-error").hidden = false;
    return;
  }
  if (!saveApiKey(modelId, model.label, value)) {
    $("api-key-error").textContent = "瀏覽器無法保存 API KEY。";
    $("api-key-error").hidden = false;
    return;
  }
  $("api-key-dialog").close();
  syncModelDetails();
}

function setBusy(value) {
  busy = value;
  document.body.setAttribute("aria-busy", String(value));
  $("generation-lock").hidden = !value;
  syncModelDetails();
  $("image-model").disabled = value;
  $("image-prompt").disabled = value;
  $("enhance-prompt").disabled = value;
  $("prompt-keywords").disabled = value;
  $("compose-prompt").disabled = value || composing || !$("prompt-keywords").value.trim();
  $("generate-image").disabled = value || composing || !$("image-prompt").value.trim();
  $("download-image").disabled = value || !generatedBlob;
  $("apply-background").disabled = value || !generatedBlob;
}

function setComposing(value) {
  composing = value;
  $("prompt-keywords").disabled = value || busy;
  $("compose-prompt").disabled = value || busy || !$("prompt-keywords").value.trim();
  $("compose-prompt").textContent = value ? "組成中…" : "組成題詞";
  $("generate-image").disabled = value || busy || !$("image-prompt").value.trim();
}

function completedPrompt(value) {
  if (typeof value === "string") return value.trim();
  for (const key of ["completed", "prompt", "result", "text", "completion"]) {
    if (typeof value?.[key] === "string" && value[key].trim()) return value[key].trim();
  }
  return "";
}

async function composePrompt() {
  const prompt = $("prompt-keywords").value.trim();
  if (!prompt || busy || composing) return;
  showError();
  status("正在組成題詞…");
  setComposing(true);
  try {
    const response = await fetch(AUTOCOMPLETE_URL, {
      method: "POST",
      headers: { Accept: "application/json,text/plain", "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const detail = body?.message || body?.error || completedPrompt(body) || "";
      if (isQuotaError(response.status, detail)) throw Error(QUOTA_MESSAGE);
      throw Error(detail || `文字補全服務回傳 ${response.status}`);
    }
    const result = completedPrompt(body);
    if (!result) throw Error("文字補全服務沒有回傳可用的題詞。");
    $("image-prompt").value = result.slice(0, 2048);
    $("image-prompt").dispatchEvent(new Event("input"));
    status("題詞已組成，可繼續修改或直接生成圖片。", "success");
  } catch (error) {
    const message = error instanceof TypeError ? "文字補全服務目前無法連線，請稍後再試。" : error.message || "題詞組成失敗。";
    showError(message);
    status("題詞組成失敗", "error");
  } finally {
    setComposing(false);
  }
}

function imageFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `yumeew-ai-${stamp}.jpg`;
}

function releaseImage() {
  if (generatedUrl) URL.revokeObjectURL(generatedUrl);
  generatedUrl = "";
  generatedBlob = null;
}

function isQuotaError(statusCode, detail) {
  return statusCode === 429 || /(?:quota|neuron|daily limit|rate limit|too many requests|limit exceeded|額度|用量上限)/i.test(detail);
}

async function generateImage() {
  const prompt = $("image-prompt").value.trim();
  const enhance = Boolean($("enhance-prompt").checked);
  const modelId = $("image-model").value;
  const model = IMAGE_MODELS[modelId];
  if (!prompt || busy || composing) return;
  showError();
  status("圖片生成中…");
  setBusy(true);
  try {
    if (!model) throw Error("找不到所選圖片模型的呼叫方式。");
    const apiKey = model.apiKey === "Free" ? "" : getApiKey(modelId)?.value || "";
    if (model.apiKey !== "Free" && !apiKey) throw Error("請先點擊 API KEY 並輸入金鑰。");
    const response = await model.call({ prompt, enhance, apiKey });
    if (!response.ok) {
      let detail = "";
      try {
        const errorBody = await response.json();
        detail = errorBody?.error?.message || (typeof errorBody?.error === "string" ? errorBody.error : "") || errorBody?.message || "";
      } catch {}
      if (isQuotaError(response.status, detail)) throw Error(QUOTA_MESSAGE);
      throw Error(detail || `圖片服務回傳 ${response.status}`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || !blob.size) throw Error("圖片服務沒有回傳可用的圖片。");
    releaseImage();
    generatedBlob = blob.type === "image/jpeg" ? blob : new Blob([blob], { type: blob.type });
    generatedUrl = URL.createObjectURL(generatedBlob);
    const image = $("generated-image");
    image.src = generatedUrl;
    await image.decode();
    image.hidden = false;
    $("empty-result").hidden = true;
    status(`生成完成 · ${image.naturalWidth} × ${image.naturalHeight}`, "success");
  } catch (error) {
    const corsHint = error instanceof TypeError
      ? modelId === "gpt-image-2.5-sunburst"
        ? "目前無法從瀏覽器連線至 OpenAI Image API，請檢查網路或 API 服務狀態。"
        : "圖片服務目前不允許 GitHub Pages 跨網域讀取，請在 Worker 回應加入 Access-Control-Allow-Origin。"
      : "";
    const message = corsHint || error.message || "圖片生成失敗，請稍後再試。";
    showError(message);
    status("圖片生成失敗", "error");
  } finally {
    setBusy(false);
  }
}

$("image-prompt").addEventListener("input", () => {
  $("generate-image").disabled = busy || composing || !$("image-prompt").value.trim();
});

$("prompt-keywords").addEventListener("input", () => {
  $("compose-prompt").disabled = busy || composing || !$("prompt-keywords").value.trim();
});

$("compose-prompt").addEventListener("click", () => void composePrompt());

$("image-model").addEventListener("change", syncModelDetails);
$("model-api-key").addEventListener("click", openApiKeyDialog);
$("api-key-form").addEventListener("submit", submitApiKey);
$("cancel-api-key").addEventListener("click", () => $("api-key-dialog").close());

$("generate-image").addEventListener("click", generateImage);

resultFrame.addEventListener("click", () => void toggleResultFullscreen());
resultFrame.addEventListener("keydown", event => {
  if (!["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  void toggleResultFullscreen();
});
document.addEventListener("fullscreenchange", syncResultFullscreen);
document.addEventListener("webkitfullscreenchange", syncResultFullscreen);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && resultFrame.classList.contains("fullscreen-fallback")) closeFullscreenFallback();
});

$("download-image").addEventListener("click", () => {
  if (!generatedBlob || busy) return;
  const link = document.createElement("a");
  link.href = generatedUrl;
  link.download = imageFilename();
  link.click();
  status("圖片下載已開始。", "success");
});

$("apply-background").addEventListener("click", async () => {
  if (!generatedBlob || busy) return;
  setBusy(true);
  status("正在保存為主畫面背景…");
  showError();
  try {
    const file = new File([generatedBlob], imageFilename(), { type: generatedBlob.type || "image/jpeg", lastModified: Date.now() });
    await saveStoredMedia("image", file);
    await deleteStoredValue("image-video-project").catch(() => {});
    window.location.href = "./";
  } catch (error) {
    showError(error.message || "無法保存圖片到瀏覽器。");
    status("背景套用失敗", "error");
    setBusy(false);
  }
});

window.addEventListener("pagehide", () => {
  closeFullscreenFallback();
  releaseImage();
});
