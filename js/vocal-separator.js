import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import {
  SEPARATOR_MAX_DURATION,
  SEPARATOR_MODEL_SIZE_MB,
  SEPARATOR_SAMPLE_RATE,
  encodeStereoWav,
  separatorFilename,
} from "./vocal-separator-core.js";

const $ = id => document.getElementById(id);
const MAX_FILE_SIZE = 150 * 1024 * 1024;
const restored = loadSettings();
applyTheme(restored.mode, restored.theme);

let sourceFile = null;
let decodedBuffer = null;
let worker = null;
let working = false;
let originalUrl = "";
let vocalsBlob = null;
let instrumentalBlob = null;
const resultUrls = { vocals: "", instrumental: "" };

function formatBytes(bytes) {
  return bytes < 1024 ** 2 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function showError(text = "") {
  $("separator-error").textContent = text;
  $("separator-error").hidden = !text;
  $("separator-drop").classList.toggle("invalid", Boolean(text));
  $("separator-engine").classList.toggle("error", Boolean(text));
  if (text) {
    $("separator-engine").textContent = "無法處理";
    $("separator-status").textContent = text;
  }
}

function setBusy(value) {
  working = value;
  $("separator-drop").disabled = value;
  $("separator-start").disabled = value || !sourceFile;
  $("separator-cancel").hidden = !value;
}

function clearResults() {
  for (const key of Object.keys(resultUrls)) {
    if (resultUrls[key]) URL.revokeObjectURL(resultUrls[key]);
    resultUrls[key] = "";
  }
  vocalsBlob = instrumentalBlob = null;
  $("separator-vocals").removeAttribute("src");
  $("separator-instrumental").removeAttribute("src");
  $("separator-results").hidden = true;
}

async function decodeFile(file) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw Error("目前瀏覽器不支援音訊解碼。");
  const context = new AudioContextClass({ sampleRate: SEPARATOR_SAMPLE_RATE });
  try {
    return await context.decodeAudioData(await file.arrayBuffer());
  } finally {
    await context.close().catch(() => {});
  }
}

async function loadFile(file) {
  if (!file || working) return;
  sourceFile = null;
  decodedBuffer = null;
  clearResults();
  showError();
  $("separator-file-info").hidden = true;
  $("separator-start").disabled = true;
  if (file.size > MAX_FILE_SIZE) {
    showError("檔案超過 150 MB，請選擇較小的音樂。");
    return;
  }
  $("separator-file-name").textContent = file.name;
  $("separator-file-help").textContent = "正在解碼音樂…";
  $("separator-status").textContent = "正在讀取音樂…";
  $("separator-drop").disabled = true;
  try {
    const buffer = await decodeFile(file);
    if (buffer.duration > SEPARATOR_MAX_DURATION + 0.01)
      throw Error("目前人聲分離單次最多處理 8 分鐘，請先裁剪音樂。");
    sourceFile = file;
    decodedBuffer = buffer;
    $("separator-duration").textContent = formatTime(buffer.duration);
    $("separator-channels").textContent = buffer.numberOfChannels === 1 ? "單聲道（將轉為雙聲道）" : `${buffer.numberOfChannels} 聲道（使用前兩聲道）`;
    $("separator-size").textContent = formatBytes(file.size);
    $("separator-file-info").hidden = false;
    $("separator-file-help").textContent = "點擊可更換音樂";
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalUrl = URL.createObjectURL(file);
    $("separator-original").src = originalUrl;
    $("separator-start").disabled = false;
    $("separator-status").textContent = `準備完成；開始後將下載約 ${SEPARATOR_MODEL_SIZE_MB} MB 的模型。`;
    $("separator-engine").textContent = navigator.gpu ? "WebGPU 可用" : "WASM CPU 模式";
  } catch (error) {
    $("separator-file-help").textContent = "MP3 · WAV · M4A · FLAC · 150 MB 以內";
    showError(error?.message || "無法解碼這個音樂檔案。");
  } finally {
    $("separator-drop").disabled = false;
  }
}

async function startSeparation() {
  if (!sourceFile || working) return;
  clearResults();
  showError();
  setBusy(true);
  $("separator-progress").hidden = false;
  $("separator-progress").value = 1;
  $("separator-start").textContent = "正在準備…";
  $("separator-status").textContent = `正在準備音訊與約 ${SEPARATOR_MODEL_SIZE_MB} MB 的 AI 模型…`;
  try {
    if (!decodedBuffer) decodedBuffer = await decodeFile(sourceFile);
    const left = Float32Array.from(decodedBuffer.getChannelData(0));
    const right = Float32Array.from(decodedBuffer.numberOfChannels > 1 ? decodedBuffer.getChannelData(1) : decodedBuffer.getChannelData(0));
    decodedBuffer = null;
    worker = new Worker(new URL("./vocal-separator-worker.js", import.meta.url), { type: "module" });
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", event => finishWithError(event.message || "人聲分離處理程序發生錯誤。"));
    worker.postMessage({ type: "separate", left: left.buffer, right: right.buffer }, [left.buffer, right.buffer]);
  } catch (error) {
    finishWithError(error?.message || "無法開始人聲分離。");
  }
}

function handleWorkerMessage(event) {
  const data = event.data || {};
  if (data.provider) $("separator-engine").textContent = data.provider === "webgpu" ? "WebGPU GPU 加速" : "WASM CPU 模式";
  if (data.type === "status") {
    $("separator-status").textContent = data.text;
    return;
  }
  if (data.type === "progress") {
    $("separator-progress").value = data.value;
    $("separator-start").textContent = `正在分離 ${data.value}%`;
    $("separator-status").textContent = data.text;
    return;
  }
  if (data.type === "error") {
    finishWithError(/fetch|network|load/i.test(data.text) ? "無法下載 AI 模型，請檢查網路後再試。" : data.text);
    return;
  }
  if (data.type !== "complete") return;
  $("separator-status").textContent = "分離完成，正在建立 WAV 檔案…";
  $("separator-progress").value = 99;
  setTimeout(() => {
    try {
      vocalsBlob = encodeStereoWav(data.vocalsLeft, data.vocalsRight);
      instrumentalBlob = encodeStereoWav(data.instrumentalLeft, data.instrumentalRight);
      resultUrls.vocals = URL.createObjectURL(vocalsBlob);
      resultUrls.instrumental = URL.createObjectURL(instrumentalBlob);
      $("separator-vocals").src = resultUrls.vocals;
      $("separator-instrumental").src = resultUrls.instrumental;
      $("separator-results").hidden = false;
      $("separator-progress").value = 100;
      $("separator-status").textContent = "人聲與伴奏已完成，可分別試聽或下載。";
      finish();
    } catch (error) {
      finishWithError(error?.message || "建立輸出檔案時記憶體不足。");
    }
  }, 0);
}

function finish() {
  worker?.terminate();
  worker = null;
  setBusy(false);
  $("separator-start").textContent = "重新分離";
}

function finishWithError(text) {
  worker?.terminate();
  worker = null;
  setBusy(false);
  $("separator-progress").hidden = true;
  $("separator-start").textContent = "重新嘗試";
  showError(text);
}

function cancel() {
  if (!working) return;
  worker?.terminate();
  worker = null;
  decodedBuffer = null;
  setBusy(false);
  $("separator-progress").hidden = true;
  $("separator-start").textContent = "重新開始";
  $("separator-status").textContent = "已取消處理。";
}

function download(blob, stem) {
  if (!blob || !sourceFile) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = separatorFilename(sourceFile.name, stem);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

$("separator-drop").addEventListener("click", () => {
  $("separator-input").value = "";
  $("separator-input").click();
});
$("separator-input").addEventListener("change", event => void loadFile(event.target.files?.[0]));
for (const eventName of ["dragenter", "dragover"]) $("separator-drop").addEventListener(eventName, event => {
  event.preventDefault();
  if (!working) $("separator-drop").classList.add("dragging");
});
for (const eventName of ["dragleave", "drop"]) $("separator-drop").addEventListener(eventName, event => {
  event.preventDefault();
  $("separator-drop").classList.remove("dragging");
});
$("separator-drop").addEventListener("drop", event => {
  if (!working) void loadFile(event.dataTransfer.files?.[0]);
});
$("separator-start").addEventListener("click", startSeparation);
$("separator-cancel").addEventListener("click", cancel);
$("download-vocals").addEventListener("click", () => download(vocalsBlob, "vocals"));
$("download-instrumental").addEventListener("click", () => download(instrumentalBlob, "instrumental"));
for (const [active, other] of [["separator-vocals", "separator-instrumental"], ["separator-instrumental", "separator-vocals"]]) {
  $(active).addEventListener("play", () => $(other).pause());
}
window.addEventListener("beforeunload", event => {
  if (!working) return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("unload", () => {
  worker?.terminate();
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  for (const url of Object.values(resultUrls)) if (url) URL.revokeObjectURL(url);
});
