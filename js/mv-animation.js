import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { STYLES } from "./styles.js";
import { draw } from "./visualizer.js";
import { exportFilename } from "./formats.js";
import { encodeMedia } from "./export.js";

const $ = (id) => document.getElementById(id);
const MAX_FILE_SIZE = 300 * 1024 * 1024;

const restored = loadSettings();
applyTheme(restored.mode, restored.theme);

let sourceName = "";
let buffer = null;
let audioEl = null;
let audioUrl = "";
let animationFrame = 0;
let controller = null;
let downloadUrl = "";

const canvas = $("mv-canvas");
const settings = { style: 0, color: "#7ee0ff", strength: 60, darkness: 0, positionX: 0, positionY: 0 };

function status(text, mode = "") {
  const el = $("mv-status");
  el.textContent = text;
  el.className = `mv-status ${mode}`;
}

function error(text = "") {
  const el = $("mv-error");
  el.textContent = text;
  el.hidden = !text;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function populateStyles() {
  const select = $("mv-style");
  select.innerHTML = "";
  STYLES.forEach((label, index) => {
    if (label === "無") return;
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = label;
    select.append(option);
  });
  select.value = String(settings.style);
}

function renderFrame() {
  if (!buffer) return;
  draw(canvas, audioEl?.currentTime || 0, buffer, null, settings);
}

function tick() {
  if (!audioEl || audioEl.paused) return;
  renderFrame();
  $("mv-seek").value = String(Math.round((audioEl.currentTime / buffer.duration) * 1000) || 0);
  $("mv-time").textContent = formatTime(audioEl.currentTime);
  animationFrame = requestAnimationFrame(tick);
}

function setControlsEnabled(enabled) {
  for (const id of ["mv-style", "mv-color", "mv-strength", "mv-darkness", "mv-aspect-ratio", "mv-resolution", "mv-fps", "mv-format", "mv-start"])
    $(id).disabled = !enabled;
}

function resetAudio() {
  cancelAnimationFrame(animationFrame);
  if (audioEl) {
    audioEl.pause();
    audioEl.src = "";
  }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = "";
  audioEl = null;
}

async function loadFile(file) {
  if (!file) return;
  error();
  if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|flac)$/i.test(file.name)) {
    error("請選擇音樂檔案（MP3、WAV、M4A 或 FLAC）。");
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    error("音樂檔案大小不可超過 300 MB。");
    return;
  }
  status("正在解碼音樂…");
  try {
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > 1200) throw Error("請選擇 20 分鐘以內的音樂。");
    if (!decoded.length) throw Error("音樂沒有可播放的內容。");
    resetAudio();
    sourceName = file.name;
    buffer = decoded;
    audioUrl = URL.createObjectURL(file);
    audioEl = new Audio(audioUrl);
    audioEl.addEventListener("ended", () => {
      $("mv-play").textContent = "▶";
      $("mv-play").setAttribute("aria-label", "播放");
    });
    audioEl.addEventListener("loadedmetadata", () => {
      $("mv-time").textContent = formatTime(0);
    });
    $("mv-file-name").textContent = file.name;
    $("mv-preview-block").hidden = false;
    $("mv-play").disabled = false;
    $("mv-seek").disabled = false;
    setControlsEnabled(true);
    renderFrame();
    status(`已載入：${file.name}（${formatTime(decoded.duration)}）`, "success");
  } catch (loadError) {
    buffer = null;
    error(loadError.message || "無法解碼此音樂檔案。");
    status("等待選擇音樂");
  }
}

$("mv-drop").addEventListener("click", () => $("mv-input").click());
$("mv-input").addEventListener("change", (event) => loadFile(event.target.files?.[0]));
for (const eventName of ["dragenter", "dragover"]) {
  $("mv-drop").addEventListener(eventName, (event) => {
    event.preventDefault();
    $("mv-drop").classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  $("mv-drop").addEventListener(eventName, () => $("mv-drop").classList.remove("dragging"));
}
$("mv-drop").addEventListener("drop", (event) => {
  event.preventDefault();
  if (!controller) void loadFile(event.dataTransfer.files?.[0]);
});

$("mv-play").addEventListener("click", () => {
  if (!audioEl) return;
  if (audioEl.paused) {
    void audioEl.play();
    $("mv-play").textContent = "❚❚";
    $("mv-play").setAttribute("aria-label", "暫停");
    animationFrame = requestAnimationFrame(tick);
  } else {
    audioEl.pause();
    $("mv-play").textContent = "▶";
    $("mv-play").setAttribute("aria-label", "播放");
  }
});
$("mv-seek").addEventListener("input", () => {
  if (!audioEl || !buffer) return;
  audioEl.currentTime = (Number($("mv-seek").value) / 1000) * buffer.duration;
  $("mv-time").textContent = formatTime(audioEl.currentTime);
  renderFrame();
});

$("mv-style").addEventListener("change", () => { settings.style = Number($("mv-style").value); renderFrame(); });
$("mv-color").addEventListener("input", () => { settings.color = $("mv-color").value; renderFrame(); });
$("mv-strength").addEventListener("input", () => {
  settings.strength = Number($("mv-strength").value);
  $("mv-strength-output").textContent = String(settings.strength);
  renderFrame();
});
$("mv-darkness").addEventListener("input", () => {
  settings.darkness = Number($("mv-darkness").value);
  $("mv-darkness-output").textContent = String(settings.darkness);
  renderFrame();
});
$("mv-aspect-ratio").addEventListener("change", () => {
  const portrait = $("mv-aspect-ratio").value === "9:16";
  $("mv-canvas-wrap").classList.toggle("portrait", portrait);
  canvas.width = portrait ? 720 : 1280;
  canvas.height = portrait ? 1280 : 720;
  renderFrame();
});

// Fullscreen preview follows the same pattern as the main studio's canvas-wrap.
const previewFrame = $("mv-canvas-wrap");
const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
function syncPreviewFullscreen() {
  const active = fullscreenElement() === previewFrame;
  previewFrame.classList.toggle("is-fullscreen", active);
  previewFrame.setAttribute("aria-label", active ? "恢復即時預覽原尺寸" : "放大即時預覽至全螢幕");
  previewFrame.querySelector(".fullscreen-hint").textContent = active ? "↙ 點擊恢復" : "⛶ 點擊全螢幕";
}
previewFrame.addEventListener("click", async () => {
  try {
    if (fullscreenElement() === previewFrame) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    } else if (previewFrame.requestFullscreen) await previewFrame.requestFullscreen();
    else if (previewFrame.webkitRequestFullscreen) await previewFrame.webkitRequestFullscreen();
  } catch {
    // Fullscreen is a convenience; ignore rejection (e.g. user gesture requirement not met).
  }
});
previewFrame.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    previewFrame.click();
  }
});
document.addEventListener("fullscreenchange", syncPreviewFullscreen);
document.addEventListener("webkitfullscreenchange", syncPreviewFullscreen);

$("mv-start").addEventListener("click", async () => {
  if (!buffer || controller) return;
  audioEl?.pause();
  error();
  controller = new AbortController();
  setControlsEnabled(false);
  $("mv-drop").disabled = true;
  $("mv-cancel").hidden = false;
  $("mv-progress").hidden = false;
  $("mv-progress").value = 0;
  $("mv-progress-text").hidden = false;
  $("mv-progress-text").textContent = "正在準備…";
  $("mv-export-note").textContent = "";
  status("正在生成 MV…");
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const format = $("mv-format").value;
    const resolution = $("mv-resolution").value;
    const fps = $("mv-fps").value;
    const blob = await encodeMedia({
      format,
      buffer,
      image: null,
      backgroundFile: null,
      settings,
      resolution,
      aspectRatio: $("mv-aspect-ratio").value,
      fps,
      signal: controller.signal,
      onEncodingMode: (mode) => {
        $("mv-export-note").textContent =
          mode === "prefer-hardware" ? "硬體編碼優先（由瀏覽器決定實際加速方式）"
          : mode === "prefer-software" ? "使用軟體編碼"
          : "使用瀏覽器自動選擇的編碼方式";
      },
      onProgress: (value) => {
        $("mv-progress").value = value;
        $("mv-progress-text").textContent = `正在生成 ${value}%`;
      },
    });
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = exportFilename(sourceName, format, resolution, fps);
    document.body.append(link);
    link.click();
    link.remove();
    status("MV 已完成，下載已開始。", "success");
  } catch (exportError) {
    status("生成失敗", "error");
    error(exportError.message || "生成失敗，請降低解析度再試。");
  } finally {
    controller = null;
    setControlsEnabled(true);
    $("mv-drop").disabled = false;
    $("mv-cancel").hidden = true;
    $("mv-progress").hidden = true;
    $("mv-progress-text").hidden = true;
  }
});
$("mv-cancel").addEventListener("click", () => controller?.abort());

window.addEventListener("beforeunload", (event) => {
  if (controller) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("unload", () => {
  resetAudio();
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
});

populateStyles();
$("mv-color").value = settings.color;
$("mv-strength").value = String(settings.strength);
$("mv-strength-output").textContent = String(settings.strength);
$("mv-darkness").value = String(settings.darkness);
$("mv-darkness-output").textContent = String(settings.darkness);
renderFrame();
