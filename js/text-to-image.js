import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { deleteStoredValue, saveStoredMedia } from "./media-store.js";

const WORKER_URL = "https://flux-klein-worker.yustellar.idv.tw/generate";
const AUTOCOMPLETE_URL = "https://flux-klein-worker.yustellar.idv.tw/autocomplete";
const QUOTA_MESSAGE = "今日圖片生成額度已用完，請於早上 8 點（台灣時間）額度重置後再試。";
const $ = id => document.getElementById(id);
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

function setBusy(value) {
  busy = value;
  document.body.setAttribute("aria-busy", String(value));
  $("generation-lock").hidden = !value;
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
  if (!prompt || busy || composing) return;
  showError();
  status("圖片生成中…");
  setBusy(true);
  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        Accept: "image/jpeg,image/*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, enhance }),
      cache: "no-store",
    });
    if (!response.ok) {
      let detail = "";
      try {
        const errorBody = await response.json();
        detail = errorBody?.error || errorBody?.message || "";
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
    const corsHint = error instanceof TypeError ? "圖片服務目前不允許 GitHub Pages 跨網域讀取，請在 Worker 回應加入 Access-Control-Allow-Origin。" : "";
    const message = corsHint || error.message || "圖片生成失敗，請稍後再試。";
    showError(message);
    status("圖片生成失敗", "error");
  } finally {
    setBusy(false);
  }
}

$("image-prompt").addEventListener("input", () => {
  const length = $("image-prompt").value.length;
  $("prompt-count").textContent = `${length} / 2048`;
  $("generate-image").disabled = busy || composing || !$("image-prompt").value.trim();
});

$("prompt-keywords").addEventListener("input", () => {
  $("compose-prompt").disabled = busy || composing || !$("prompt-keywords").value.trim();
});

$("compose-prompt").addEventListener("click", () => void composePrompt());

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
