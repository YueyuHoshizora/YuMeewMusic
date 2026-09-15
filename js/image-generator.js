import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { deleteStoredValue, loadStoredMedia, loadStoredValue, saveStoredMedia, saveStoredValue } from "./media-store.js";
import { getApiKey, saveAccountCredits, saveApiKey, usesAccountCredits } from "./api-keys.js";
import { clientIdentityHeaders } from "./client-identity.js";
import { getCurrentSession, onAuthStateChange } from "./auth.js";
import { calculateImageSize, IMAGE_RATIOS, IMAGE_WIDTHS } from "./image-generation-settings.js";
import { extractImageGenerationIdentifiers, generationIdentifierHeaders, responseGenerationIdentifiers } from "./image-generation-identifiers.js";

const WORKER_URL = "https://flux-klein-worker.yustellar.idv.tw/generate";
const AUTOCOMPLETE_URL = "https://flux-klein-worker.yustellar.idv.tw/autocomplete";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";
const QUOTA_MESSAGE = "今日圖片生成額度已用完，請於早上 8 點（台灣時間）額度重置後再試。";
const IMAGE_HISTORY_LIMIT = 10;
const IMAGE_GENERATION_SETTINGS_KEY = "yumeew-image-generation-settings";
const $ = id => document.getElementById(id);

async function callFlux2Klein4B({ prompt, enhance, width, height }) {
  return fetch(WORKER_URL, {
    method: "POST",
    headers: {
      Accept: "image/jpeg,image/*",
      "Content-Type": "application/json",
      ...clientIdentityHeaders(),
    },
    body: JSON.stringify({ prompt, enhance, width, height }),
    cache: "no-store",
  });
}

function base64ImageBlob(encoded, type = "image/jpeg") {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

async function callOpenAiImage({ model, prompt, apiKey, width, height }) {
  const response = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size: `${width}x${height}`,
      quality: "auto",
      output_format: "jpeg",
    }),
    cache: "no-store",
  });
  if (!response.ok) return response;
  const result = await response.json();
  const identifiers = extractImageGenerationIdentifiers(result, response.headers);
  const identifierHeaders = generationIdentifierHeaders(identifiers);
  const image = result?.data?.[0];
  if (image?.b64_json) {
    return new Response(base64ImageBlob(image.b64_json), {
      status: 200,
      headers: { "Content-Type": "image/jpeg", ...identifierHeaders },
    });
  }
  if (image?.url) {
    const imageResponse = await fetch(image.url, { cache: "no-store" });
    if (!imageResponse.ok) return imageResponse;
    const imageBlob = await imageResponse.blob();
    return new Response(imageBlob, {
      status: 200,
      headers: { "Content-Type": imageBlob.type || "image/jpeg", ...identifierHeaders },
    });
  }
  throw Error("OpenAI 沒有回傳可用的圖片資料。");
}

function callGptImage25Flare({ prompt, apiKey, width, height }) {
  return callOpenAiImage({ model: "gpt-image-2.5-flare", prompt, apiKey, width, height });
}

function callGptImage25Sunburst({ prompt, apiKey, width, height }) {
  return callOpenAiImage({ model: "gpt-image-2.5-sunburst", prompt, apiKey, width, height });
}

const IMAGE_MODELS = Object.freeze({
  "flux-2-klein-4b": Object.freeze({
    label: "Flux.2 Klein 4B",
    apiKey: "Free",
    publicResource: true,
    call: callFlux2Klein4B,
  }),
  "gpt-image-2.5-flare": Object.freeze({
    label: "GPT-Image-2.5 Flare",
    provider: "openai",
    apiKey: "OpenAI",
    call: callGptImage25Flare,
  }),
  "gpt-image-2.5-sunburst": Object.freeze({
    label: "GPT-Image-2.5 Sunburst",
    provider: "openai",
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
let memberSignedIn = false;
let generationHistory = [];
let generationProgress = null;
const historyPreviewUrls = new Set();
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

function localImageTaskId() {
  const value = crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `IMG-${value}`;
}

function renderGenerationProgress() {
  if (!generationProgress) return;
  const elapsed = Math.floor((Date.now() - generationProgress.startedAt) / 1000);
  $("image-generation-lock-title").textContent = "圖片生成中";
  $("image-generation-lock-detail").textContent = `${generationProgress.label}：${generationProgress.identifier} · 已執行 ${elapsed} 秒`;
  status(`圖片生成中 · 已執行 ${elapsed} 秒`);
}

function startGenerationProgress() {
  stopGenerationProgress();
  generationProgress = {
    localTaskId: localImageTaskId(),
    identifier: "",
    label: "任務 ID",
    startedAt: Date.now(),
    timer: 0,
  };
  generationProgress.identifier = generationProgress.localTaskId;
  renderGenerationProgress();
  generationProgress.timer = window.setInterval(renderGenerationProgress, 1000);
  return generationProgress;
}

function updateGenerationProgress(identifiers) {
  if (!generationProgress) return;
  if (identifiers.taskId) [generationProgress.label, generationProgress.identifier] = ["任務 ID", identifiers.taskId];
  else if (identifiers.generationId) [generationProgress.label, generationProgress.identifier] = ["生成 ID", identifiers.generationId];
  else if (identifiers.requestId) [generationProgress.label, generationProgress.identifier] = ["請求 ID", identifiers.requestId];
  renderGenerationProgress();
}

function stopGenerationProgress() {
  if (!generationProgress) return;
  window.clearInterval(generationProgress.timer);
  generationProgress = null;
}

function generationSize() {
  return calculateImageSize($("image-aspect-ratio").value, $("image-width").value);
}

function sizeSupportedBySelectedModel({ width, height }) {
  const model = IMAGE_MODELS[$("image-model").value];
  return !model?.publicResource || (width >= 256 && width <= 1920 && height >= 256 && height <= 1920);
}

function saveGenerationSettings(size) {
  try {
    localStorage.setItem(IMAGE_GENERATION_SETTINGS_KEY, JSON.stringify({ ratio: size.ratio, width: size.width }));
  } catch {}
}

function restoreGenerationSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(IMAGE_GENERATION_SETTINGS_KEY) || "null");
    if (IMAGE_RATIOS[saved?.ratio]) $("image-aspect-ratio").value = saved.ratio;
    if (IMAGE_WIDTHS.includes(Number(saved?.width))) $("image-width").value = String(saved.width);
  } catch {}
}

function syncGenerationSettings({ save = true } = {}) {
  const size = generationSize();
  $("image-height").textContent = `${size.height}px`;
  $("generation-size-summary").textContent = `${size.width} × ${size.height}`;
  $("result-resolution").textContent = `${size.width} × ${size.height}`;
  $("result-format").textContent = `${size.ratio} · JPEG`;
  const supported = sizeSupportedBySelectedModel(size);
  $("generation-size-note").textContent = supported
    ? "輸出尺寸會依生成比例自動計算。"
    : "Flux.2 Klein 4B 的寬高皆不可超過 1920px，請降低水平像素或調整比例。";
  $("generation-size-note").classList.toggle("error", !supported);
  if (save) saveGenerationSettings(size);
  syncGenerateAvailability();
}

function canUseSelectedImageModel() {
  const modelId = $("image-model").value;
  const model = IMAGE_MODELS[modelId];
  if (!model) return false;
  if (model.publicResource) return true;
  if (usesAccountCredits(modelId)) return memberSignedIn;
  return Boolean(getApiKey(model.provider));
}

function syncGenerateAvailability() {
  $("generate-image").disabled = busy || composing || !$("image-prompt").value.trim() || !canUseSelectedImageModel() || !sizeSupportedBySelectedModel(generationSize());
}

function syncModelDetails() {
  const modelId = $("image-model").value;
  const model = IMAGE_MODELS[modelId];
  const isFree = model?.apiKey === "Free";
  const storedKey = isFree ? null : getApiKey(model?.provider);
  $("model-api-key").textContent = isFree ? "Free" : usesAccountCredits(modelId) ? (memberSignedIn ? "帳戶扣點" : "需登入") : storedKey ? "已設定" : "未設定";
  $("model-api-key").disabled = busy || isFree || !model;
  syncGenerationSettings({ save: false });
  syncGenerateAvailability();
}

function openApiKeyDialog() {
  const modelId = $("image-model").value;
  const model = IMAGE_MODELS[modelId];
  if (!model || model.apiKey === "Free" || busy) return;
  const storedKey = getApiKey(model.provider);
  $("api-key-dialog-title").textContent = `${model.apiKey} API KEY`;
  $("api-key-dialog-description").textContent = `同一服務供應商的模型會共用這把金鑰。金鑰只會保存在目前瀏覽器。`;
  $("api-key-input").value = storedKey?.value || "";
  $("api-key-account-credits").checked = memberSignedIn && usesAccountCredits(modelId);
  syncApiKeyCreditControls();
  $("api-key-input").placeholder = storedKey ? "已載入保存的 API KEY" : "輸入 API KEY";
  $("api-key-error").hidden = true;
  $("api-key-dialog").showModal();
  ($("api-key-input").disabled ? $("api-key-account-credits") : $("api-key-input")).focus();
}

function syncApiKeyCreditControls() {
  const accountOption = $("api-key-account-credits");
  accountOption.disabled = !memberSignedIn;
  if (!memberSignedIn) accountOption.checked = false;
  $("api-key-input").disabled = accountOption.checked;
}

function submitApiKey(event) {
  event.preventDefault();
  const modelId = $("image-model").value;
  const model = IMAGE_MODELS[modelId];
  const value = $("api-key-input").value.trim();
  const accountCredits = $("api-key-account-credits").checked;
  if (!model || model.apiKey === "Free") return;
  if (accountCredits && !memberSignedIn) {
    $("api-key-error").textContent = "請先登入會員帳號。";
    $("api-key-error").hidden = false;
    return;
  }
  if (!accountCredits && !value) {
    $("api-key-error").textContent = "請輸入 API KEY。";
    $("api-key-error").hidden = false;
    return;
  }
  if (!saveAccountCredits(modelId, accountCredits) || (!accountCredits && !saveApiKey(model.provider, model.apiKey, value))) {
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
  $("image-aspect-ratio").disabled = value;
  $("image-width").disabled = value;
  $("image-prompt").disabled = value;
  $("enhance-prompt").disabled = value;
  $("prompt-keywords").disabled = value;
  $("compose-prompt").disabled = value || composing || !$("prompt-keywords").value.trim();
  syncGenerateAvailability();
  $("download-image").disabled = value || !generatedBlob;
  $("apply-background").disabled = value || !generatedBlob;
  syncHistoryButton();
}

function setComposing(value) {
  composing = value;
  $("prompt-keywords").disabled = value || busy;
  $("compose-prompt").disabled = value || busy || !$("prompt-keywords").value.trim();
  $("compose-prompt").textContent = value ? "組成中…" : "組成題詞";
  syncGenerateAvailability();
}

function completedPrompt(value) {
  if (typeof value === "string") return value.trim();
  for (const key of ["completed", "prompt", "result", "text", "completion"]) {
    if (typeof value?.[key] === "string" && value[key].trim()) return value[key].trim();
  }
  return "";
}

function rateLimitMessage(body) {
  if (!body || typeof body !== "object" || body.code !== "rate_limit_exceeded") return "";
  const retryAfter = Math.max(1, Math.ceil(Number(body.retryAfter) || 60));
  return typeof body.error === "string" && body.error.trim()
    ? body.error.trim()
    : `操作過於頻繁，請在 ${retryAfter} 秒後再試。`;
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
      headers: { Accept: "application/json,text/plain", "Content-Type": "application/json", ...clientIdentityHeaders() },
      body: JSON.stringify({ prompt }),
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const detail = body?.message || body?.error || completedPrompt(body) || "";
      const limitedMessage = rateLimitMessage(body);
      if (limitedMessage) throw Error(limitedMessage);
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

async function displayGeneratedImage(blob, restored = false) {
  releaseImage();
  generatedBlob = blob;
  generatedUrl = URL.createObjectURL(generatedBlob);
  const image = $("generated-image");
  image.src = generatedUrl;
  await image.decode();
  image.hidden = false;
  $("empty-result").hidden = true;
  status(`${restored ? "已載入上次生成結果" : "生成完成"} · ${image.naturalWidth} × ${image.naturalHeight}`, "success");
}

async function restoreLastGeneratedImage() {
  try {
    const record = await loadStoredMedia("generated-image");
    if (!record?.blob?.type?.startsWith("image/") || !record.blob.size) return;
    if (busy) return;
    await displayGeneratedImage(record.blob, true);
    setBusy(false);
  } catch {}
}

function historyTime(value) {
  return new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function syncHistoryButton() {
  $("open-image-history").textContent = generationHistory.length ? `生成歷史（${generationHistory.length}）` : "生成歷史";
  $("open-image-history").disabled = busy || !generationHistory.length;
}

async function loadGenerationHistory() {
  const saved = await loadStoredValue("image-generation-history").catch(() => null);
  generationHistory = Array.isArray(saved?.items) ? saved.items.filter(item => item?.blob?.size).slice(0, IMAGE_HISTORY_LIMIT) : [];
  syncHistoryButton();
}

async function saveGenerationHistory(blob, prompt, modelId, identifiers = {}) {
  await loadGenerationHistory();
  generationHistory.unshift({
    id: crypto.randomUUID?.() || `image-${Date.now()}`,
    blob,
    prompt,
    modelId,
    modelLabel: IMAGE_MODELS[modelId]?.label || modelId,
    taskId: identifiers.taskId || "",
    generationId: identifiers.generationId || "",
    requestId: identifiers.requestId || "",
    localTaskId: identifiers.localTaskId || "",
    createdAt: Date.now(),
  });
  generationHistory = generationHistory.slice(0, IMAGE_HISTORY_LIMIT);
  await saveStoredValue("image-generation-history", { items: generationHistory, updatedAt: Date.now() });
  syncHistoryButton();
}

function releaseHistoryUrls() {
  historyPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  historyPreviewUrls.clear();
}

async function deleteHistoryImage(id) {
  const record = generationHistory.find(item => item.id === id);
  if (!record || !confirm(`確定刪除 ${historyTime(record.createdAt)} 的生成圖片？`)) return;
  generationHistory = generationHistory.filter(item => item.id !== id);
  if (generationHistory.length) await saveStoredValue("image-generation-history", { items: generationHistory, updatedAt: Date.now() });
  else await deleteStoredValue("image-generation-history");
  renderImageHistory();
  syncHistoryButton();
}

function renderImageHistory() {
  releaseHistoryUrls();
  $("image-history-list").replaceChildren(...generationHistory.map(record => {
    const card = document.createElement("article"); card.className = "image-history-card";
    const image = document.createElement("img"); const url = URL.createObjectURL(record.blob); historyPreviewUrls.add(url); image.src = url; image.alt = record.prompt || "生成圖片";
    const info = document.createElement("div"); info.className = "image-history-card-info";
    const title = document.createElement("strong"); title.textContent = record.modelLabel || "生成圖片";
    const meta = document.createElement("small"); meta.textContent = historyTime(record.createdAt);
    const identifierMeta = document.createElement("small");
    identifierMeta.textContent = record.taskId
      ? `任務 ID：${record.taskId}`
      : record.generationId
        ? `生成 ID：${record.generationId}`
        : record.requestId
          ? `請求 ID：${record.requestId}`
          : record.localTaskId
            ? `任務 ID：${record.localTaskId}`
            : "";
    identifierMeta.hidden = !identifierMeta.textContent;
    const prompt = document.createElement("p"); prompt.textContent = record.prompt || "";
    const actions = document.createElement("div"); actions.className = "image-history-card-actions";
    const load = document.createElement("button"); load.type = "button"; load.textContent = "載入"; load.addEventListener("click", async () => { await displayGeneratedImage(record.blob, true); $("image-history-dialog").close(); });
    const download = document.createElement("button"); download.type = "button"; download.textContent = "下載"; download.addEventListener("click", () => { const link = document.createElement("a"); link.href = url; link.download = imageFilename(); link.click(); });
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "刪除"; remove.addEventListener("click", () => void deleteHistoryImage(record.id));
    actions.append(load, download, remove); info.append(title, meta, identifierMeta, prompt, actions); card.append(image, info); return card;
  }));
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
  setBusy(true);
  const progress = startGenerationProgress();
  try {
    if (!model) throw Error("找不到所選圖片模型的呼叫方式。");
    const accountCredits = usesAccountCredits(modelId);
    if (accountCredits && !memberSignedIn) throw Error("請先登入會員帳號，再使用帳戶扣點。");
    const apiKey = model.apiKey === "Free" || accountCredits ? "" : getApiKey(model.provider)?.value || "";
    if (model.apiKey !== "Free" && !accountCredits && !apiKey) throw Error("請先點擊 API KEY 並輸入金鑰。");
    const { width, height } = generationSize();
    const response = await model.call({ prompt, enhance, apiKey, width, height });
    if (!response.ok) {
      let detail = "";
      let errorBody = null;
      try {
        errorBody = await response.json();
        detail = errorBody?.error?.message || (typeof errorBody?.error === "string" ? errorBody.error : "") || errorBody?.message || "";
      } catch {}
      const limitedMessage = rateLimitMessage(errorBody);
      if (limitedMessage) throw Error(limitedMessage);
      if (model.publicResource && isQuotaError(response.status, detail)) throw Error(QUOTA_MESSAGE);
      throw Error(detail || `圖片服務回傳 ${response.status}`);
    }
    const identifiers = responseGenerationIdentifiers(response.headers);
    identifiers.localTaskId = progress.localTaskId;
    updateGenerationProgress(identifiers);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || !blob.size) throw Error("圖片服務沒有回傳可用的圖片。");
    const result = blob.type === "image/jpeg" ? blob : new Blob([blob], { type: blob.type });
    stopGenerationProgress();
    await displayGeneratedImage(result);
    const cachedFile = new File([result], imageFilename(), { type: result.type || "image/jpeg", lastModified: Date.now() });
    await saveGenerationHistory(result, prompt, modelId, identifiers).catch(() => showError("圖片已生成，但無法保存生成歷史。"));
    await saveStoredMedia("generated-image", cachedFile).catch(() => {
      showError("圖片已生成，但瀏覽器無法保存最後一次生成結果。");
    });
  } catch (error) {
    const corsHint = error instanceof TypeError
      ? model?.apiKey === "OpenAI"
        ? "目前無法從瀏覽器連線至 OpenAI Image API，請檢查網路或 API 服務狀態。"
        : "圖片服務目前不允許 GitHub Pages 跨網域讀取，請在 Worker 回應加入 Access-Control-Allow-Origin。"
      : "";
    const message = corsHint || error.message || "圖片生成失敗，請稍後再試。";
    showError(message);
    status("圖片生成失敗", "error");
  } finally {
    stopGenerationProgress();
    setBusy(false);
  }
}

function requestImageGeneration() {
  if (busy || composing || $("generate-image").disabled) return;
  const modelId = $("image-model").value;
  const model = IMAGE_MODELS[modelId];
  if (!model) return;
  const size = generationSize();
  const accountCredits = usesAccountCredits(modelId);
  $("confirm-image-generation-message").textContent = model.publicResource
    ? "此為公共資源，請勿濫用。是否確定開始生成？"
    : accountCredits
      ? "圖片生成費用將會從帳戶額度扣除，是否確定開始生成？"
      : `圖片生成會消耗 ${model.apiKey} 帳戶額度，是否確定開始生成？`;
  const estimatedFee = model.publicResource ? "Free" : accountCredits ? "帳戶扣點" : `依 ${model.apiKey} 計費`;
  const values = [
    ["生成模型", model.label],
    ["生成比例", size.ratio],
    ["輸出尺寸", `${size.width} × ${size.height}`],
    ["生成數量", "1 張"],
    ["題詞轉譯", $("enhance-prompt").checked ? "啟用" : "停用"],
    ["預估費用", estimatedFee],
  ];
  $("image-generation-summary").replaceChildren(...values.map(([label, value]) => {
    const item = document.createElement("span");
    if (label === "預估費用") {
      const fee = document.createElement("span");
      fee.className = "image-generation-estimated-fee";
      const amount = document.createElement("strong");
      amount.textContent = value;
      fee.append(amount);
      item.append(document.createTextNode(label), fee);
      return item;
    }
    const strong = document.createElement("strong");
    strong.textContent = value;
    item.append(document.createTextNode(label), strong);
    return item;
  }));
  $("confirm-image-generation-dialog").showModal();
}

function confirmImageGeneration(event) {
  event.preventDefault();
  $("confirm-image-generation-dialog").close();
  void generateImage();
}

$("image-prompt").addEventListener("input", () => {
  syncGenerateAvailability();
});

$("prompt-keywords").addEventListener("input", () => {
  $("compose-prompt").disabled = busy || composing || !$("prompt-keywords").value.trim();
});

$("compose-prompt").addEventListener("click", () => void composePrompt());

$("image-model").addEventListener("change", syncModelDetails);
$("image-aspect-ratio").addEventListener("change", syncGenerationSettings);
$("image-width").addEventListener("change", syncGenerationSettings);
$("model-api-key").addEventListener("click", openApiKeyDialog);
$("api-key-account-credits").addEventListener("change", syncApiKeyCreditControls);
$("api-key-form").addEventListener("submit", submitApiKey);
$("cancel-api-key").addEventListener("click", () => $("api-key-dialog").close());

onAuthStateChange(session => {
  memberSignedIn = Boolean(session?.user);
  syncModelDetails();
  syncApiKeyCreditControls();
});
void getCurrentSession().then(({ session }) => {
  memberSignedIn = Boolean(session?.user);
  syncModelDetails();
  syncApiKeyCreditControls();
}).catch(() => {});

$("generate-image").addEventListener("click", requestImageGeneration);
$("confirm-image-generation-form").addEventListener("submit", confirmImageGeneration);
$("cancel-image-generation").addEventListener("click", () => $("confirm-image-generation-dialog").close());
$("open-image-history").addEventListener("click", () => { renderImageHistory(); $("image-history-dialog").showModal(); });
$("close-image-history").addEventListener("click", () => $("image-history-dialog").close());
$("image-history-dialog").addEventListener("close", releaseHistoryUrls);

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
  releaseHistoryUrls();
});

function restoreWhenIdle(task) {
  const run = () => void task();
  if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(run, { timeout: 1200 });
  else setTimeout(run, 0);
}
restoreGenerationSettings();
syncGenerationSettings({ save: false });
restoreWhenIdle(() => {
  void restoreLastGeneratedImage();
  void loadGenerationHistory();
});
