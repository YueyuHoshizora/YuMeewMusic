import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { deleteStoredValue, saveStoredMedia } from "./media-store.js";

const WORKER_URL = "https://flux-klein-worker.yustellar.idv.tw/";
const QUOTA_MESSAGE = "今日圖片生成額度已用完，請於早上 8 點（台灣時間）額度重置後再試。";
const $ = id => document.getElementById(id);
const settings = loadSettings();
applyTheme(settings.mode, settings.theme);

let generatedBlob = null;
let generatedUrl = "";
let busy = false;

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
  $("generate-image").disabled = value || !$("image-prompt").value.trim();
  $("download-image").disabled = value || !generatedBlob;
  $("apply-background").disabled = value || !generatedBlob;
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
  if (!prompt || busy) return;
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
      body: JSON.stringify({ prompt }),
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
  $("generate-image").disabled = busy || !$("image-prompt").value.trim();
});

$("image-prompt").addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") generateImage();
});

$("generate-image").addEventListener("click", generateImage);

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

window.addEventListener("pagehide", releaseImage);
