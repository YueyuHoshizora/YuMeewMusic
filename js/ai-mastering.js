import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { loadStoredMedia, saveStoredMedia, unpackStoredMedia } from "./media-store.js";
import { encodeStereoWav } from "./vocal-separator-core.js";
import { MASTER_PRESETS, EQ_LEVEL_COUNT, EQ_DEFAULT_LEVEL, masterAudioChannels, masteredFilename } from "./ai-mastering-core.js";
import { registerAudioPlayer, setupSimplePlayer } from "./audio-player.js";

const $ = id => document.getElementById(id);
const MAX_FILE_SIZE = 100 * 1024 * 1024;
// 5 段 EQ 調整器的文字說明，索引對應 1～5 段（陣列是 0-based，介面顯示的段數是 1-based）。
const EQ_LEVEL_LABELS = ["最低", "偏低", "標準", "偏高", "最高"];

const restored = loadSettings();
applyTheme(restored.mode, restored.theme);

// 母帶設定（目標響度、壓縮強度）不寫入任何暫存（localStorage／sessionStorage 等），
// 每次打開這個頁面一律固定從「串流平台」開始，不會被瀏覽器的表單記憶或上次選擇帶偏；
// pageshow 也一併處理，涵蓋從瀏覽器上一頁／下一頁快取（bfcache）復原回來的情況。
function resetMasteringDefaults() {
  $("mastering-preset").value = "streaming";
  $("mastering-custom-lufs").hidden = true;
  $("mastering-custom-lufs-input").value = "-14";
  $("mastering-intensity").value = "50";
  $("mastering-intensity-value").textContent = "50%";
  const defaultLevel = EQ_DEFAULT_LEVEL + 1; // 介面用 1-based（1～5 段），核心函式用 0-based
  $("mastering-clarity").value = String(defaultLevel);
  $("mastering-clarity-value").textContent = EQ_LEVEL_LABELS[EQ_DEFAULT_LEVEL];
  $("mastering-impact").value = String(defaultLevel);
  $("mastering-impact-value").textContent = EQ_LEVEL_LABELS[EQ_DEFAULT_LEVEL];
}
resetMasteringDefaults();
window.addEventListener("pageshow", event => {
  if (event.persisted) resetMasteringDefaults();
});

let sourceFile = null;
let audioBuffer = null;
let originalUrl = "";
let resultBlob = null;
let resultUrl = "";
let downloadUrl = "";
let processing = false;
let loadToken = 0;

function formatBytes(bytes) {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function formatLufs(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} LUFS` : "—";
}

function status(text, mode = "") {
  $("mastering-status").textContent = text;
  $("mastering-status").className = `mastering-status ${mode}`.trim();
}

function error(text = "") {
  $("mastering-error").textContent = text;
  $("mastering-error").hidden = !text;
  $("mastering-drop").classList.toggle("invalid", Boolean(text));
  if (text) status(text, "error");
}

// A/B 比較播放器：處理前／處理後共用同一組播放鍵、拖曳軸與時間顯示，
// 切換 A/B 時會同步播放位置，並延續原本播放／暫停的狀態。
function setupComparePlayer(beforeAudio, afterAudio, playButton, seekInput, timeOutput, beforeButton, afterButton) {
  registerAudioPlayer(beforeAudio);
  registerAudioPlayer(afterAudio);
  let active = afterAudio;
  let seeking = false;

  function inactiveOf(audio) {
    return audio === beforeAudio ? afterAudio : beforeAudio;
  }

  function renderTime() {
    const duration = Number.isFinite(active.duration) ? active.duration : 0;
    timeOutput.textContent = `${formatTime(active.currentTime)} / ${formatTime(duration)}`;
  }

  function updatePlayButton() {
    const playing = !active.paused && !active.ended;
    playButton.textContent = playing ? "⏸" : "▶";
    playButton.setAttribute("aria-label", playing ? "暫停" : "播放");
  }

  function switchTo(audio) {
    if (audio === active) return;
    const wasPlaying = !active.paused && !active.ended;
    inactiveOf(audio).pause();
    audio.currentTime = active.currentTime;
    active = audio;
    beforeButton.setAttribute("aria-pressed", String(active === beforeAudio));
    afterButton.setAttribute("aria-pressed", String(active === afterAudio));
    seekInput.max = String(Number.isFinite(active.duration) ? active.duration : 0);
    renderTime();
    updatePlayButton();
    if (wasPlaying) void active.play().catch(() => {});
  }

  playButton.addEventListener("click", () => {
    if (!active.src) return;
    if (active.paused) void active.play().catch(() => {});
    else active.pause();
  });
  beforeButton.addEventListener("click", () => switchTo(beforeAudio));
  afterButton.addEventListener("click", () => switchTo(afterAudio));

  for (const audio of [beforeAudio, afterAudio]) {
    audio.addEventListener("play", () => {
      if (audio === active) updatePlayButton();
    });
    for (const eventName of ["pause", "ended"]) {
      audio.addEventListener(eventName, () => {
        if (audio === active) updatePlayButton();
      });
    }
    audio.addEventListener("loadedmetadata", () => {
      if (audio === active) {
        seekInput.max = String(Number.isFinite(audio.duration) ? audio.duration : 0);
        renderTime();
      }
    });
    audio.addEventListener("timeupdate", () => {
      if (audio !== active) return;
      if (!seeking) seekInput.value = String(audio.currentTime);
      renderTime();
    });
  }

  seekInput.addEventListener("input", () => {
    seeking = true;
    timeOutput.textContent = `${formatTime(Number(seekInput.value))} / ${formatTime(active.duration || 0)}`;
  });
  seekInput.addEventListener("change", () => {
    active.currentTime = Number(seekInput.value);
    seeking = false;
  });

  return {
    // 換了新的來源（重新選檔或重新產出母帶結果）之後呼叫：兩個播放器都暫停、
    // 位置歸零，並固定回到「處理後」作為預設試聽對象。
    reset() {
      beforeAudio.pause();
      afterAudio.pause();
      beforeAudio.currentTime = 0;
      afterAudio.currentTime = 0;
      active = afterAudio;
      beforeButton.setAttribute("aria-pressed", "false");
      afterButton.setAttribute("aria-pressed", "true");
      seekInput.value = "0";
      seekInput.max = "0";
      renderTime();
      updatePlayButton();
    },
  };
}

setupSimplePlayer($("mastering-original"), $("mastering-original-play"), $("mastering-original-seek"), $("mastering-original-time"));
const comparePlayer = setupComparePlayer(
  $("mastering-compare-before"),
  $("mastering-compare-after"),
  $("mastering-compare-play"),
  $("mastering-compare-seek"),
  $("mastering-compare-time"),
  $("mastering-ab-before"),
  $("mastering-ab-after"),
);

function resetResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  resultUrl = "";
  downloadUrl = "";
  resultBlob = null;
  $("mastering-preview").hidden = true;
  $("mastering-actions").hidden = true;
  $("mastering-loudness-compare").hidden = true;
  $("mastering-compare-before").pause();
  $("mastering-compare-after").pause();
  $("mastering-compare-before").removeAttribute("src");
  $("mastering-compare-after").removeAttribute("src");
  comparePlayer.reset();
}

async function loadFile(file, source = "upload") {
  if (!file || processing) return;
  // 每次呼叫都拿一個新的 token；非同步解碼完成時如果 token 已經被更新的呼叫取代，
  // 代表使用者在等待期間又選了別的音樂（或自動帶入與手動選擇剛好同時發生），
  // 這時就捨棄這次結果，永遠以「最後一次」的選擇為準，不會互相覆蓋。
  const token = ++loadToken;
  sourceFile = null;
  audioBuffer = null;
  $("mastering-preset").disabled = true;
  $("mastering-intensity").disabled = true;
  $("mastering-clarity").disabled = true;
  $("mastering-impact").disabled = true;
  $("mastering-start").disabled = true;
  $("mastering-file-info").hidden = true;
  resetResult();
  error();
  if (file.size > MAX_FILE_SIZE) {
    error("檔案超過 100 MB，請選擇較小的音樂檔案。");
    return;
  }
  $("mastering-file-name").textContent = file.name;
  $("mastering-file-help").textContent = "正在解碼音樂…";
  $("mastering-drop").disabled = true;
  status(source === "main" ? "偵測到主畫面音樂，正在帶入…" : "正在讀取音樂…");
  try {
    const arrayBuffer = await file.arrayBuffer();
    const context = new (window.AudioContext || window.webkitAudioContext)();
    let decoded;
    try {
      decoded = await context.decodeAudioData(arrayBuffer);
    } finally {
      void context.close().catch(() => {});
    }
    if (token !== loadToken) return;
    audioBuffer = decoded;
    sourceFile = file;
    $("mastering-source").textContent = source === "main" ? "主畫面音樂" : "本機上傳";
    $("mastering-duration").textContent = formatTime(audioBuffer.duration);
    $("mastering-channels").textContent = audioBuffer.numberOfChannels >= 2 ? "立體聲" : "單聲道";
    $("mastering-samplerate").textContent = `${Math.round(audioBuffer.sampleRate / 100) / 10} kHz`;
    $("mastering-size").textContent = formatBytes(file.size);
    $("mastering-file-info").hidden = false;
    $("mastering-original").pause();
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalUrl = URL.createObjectURL(file);
    $("mastering-original").src = originalUrl;
    $("mastering-file-help").textContent = "點擊可更換音樂";
    $("mastering-preset").disabled = false;
    $("mastering-intensity").disabled = false;
    $("mastering-clarity").disabled = false;
    $("mastering-impact").disabled = false;
    $("mastering-start").disabled = false;
    status(
      source === "main" ? "已自動帶入主畫面音樂，可點擊上方更換。想母帶其他音樂就直接點擊選擇本機音樂。" : "已辨識音樂，選擇母帶設定後即可開始處理。",
      "success",
    );
  } catch (cause) {
    if (token !== loadToken) return;
    $("mastering-file-help").textContent = "MP3 · WAV · M4A · FLAC · 100 MB 以內";
    error(cause?.message || "無法解碼這個音樂檔案，請確認格式是否受瀏覽器支援。");
  } finally {
    if (token === loadToken) $("mastering-drop").disabled = false;
  }
}

function updatePresetVisibility() {
  $("mastering-custom-lufs").hidden = $("mastering-preset").value !== "custom";
}

function targetLufs() {
  const preset = $("mastering-preset").value;
  if (preset === "custom") {
    const value = Number($("mastering-custom-lufs-input").value);
    return Number.isFinite(value) ? Math.max(-30, Math.min(-6, value)) : -14;
  }
  return MASTER_PRESETS[preset]?.targetLufs ?? -14;
}

async function startMastering() {
  if (!sourceFile || !audioBuffer || processing) return;
  processing = true;
  resetResult();
  error();
  $("mastering-drop").disabled = true;
  $("mastering-preset").disabled = true;
  $("mastering-intensity").disabled = true;
  $("mastering-clarity").disabled = true;
  $("mastering-impact").disabled = true;
  $("mastering-start").disabled = true;
  $("mastering-progress").hidden = false;
  $("mastering-progress-text").hidden = false;
  status("正在處理，請保持此頁面開啟。");
  // 讓「正在處理」的畫面先畫出來，再進行會讓主執行緒忙碌幾秒的同步 DSP 運算。
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  try {
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels >= 2 ? audioBuffer.getChannelData(1) : left;
    const intensity = Number($("mastering-intensity").value) || 0;
    // 介面上的 1～5 段是 1-based，核心函式的 clarityLevel／impactLevel 是 0-based。
    const clarityLevel = (Number($("mastering-clarity").value) || 1) - 1;
    const impactLevel = (Number($("mastering-impact").value) || 1) - 1;
    const result = masterAudioChannels(left, right, audioBuffer.sampleRate, {
      intensity,
      targetLufs: targetLufs(),
      ceilingDb: -1,
      clarityLevel,
      impactLevel,
    });
    resultBlob = encodeStereoWav(result.left, result.right, audioBuffer.sampleRate);
    resultUrl = URL.createObjectURL(resultBlob);
    $("mastering-compare-before").src = originalUrl;
    $("mastering-compare-after").src = resultUrl;
    comparePlayer.reset();
    $("mastering-before-lufs").textContent = formatLufs(result.beforeLufs);
    $("mastering-after-lufs").textContent = formatLufs(result.afterLufs);
    $("mastering-loudness-compare").hidden = false;
    $("mastering-preview").hidden = false;
    $("mastering-actions").hidden = false;
    status("母帶處理完成。", "success");
  } catch (cause) {
    error(cause?.message || "母帶處理失敗，請重新嘗試。");
  } finally {
    processing = false;
    $("mastering-drop").disabled = false;
    $("mastering-preset").disabled = false;
    $("mastering-intensity").disabled = false;
    $("mastering-clarity").disabled = false;
    $("mastering-impact").disabled = false;
    $("mastering-start").disabled = false;
    $("mastering-progress").hidden = true;
    $("mastering-progress-text").hidden = true;
  }
}

function downloadResult() {
  if (!resultBlob) return;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(resultBlob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = masteredFilename(sourceFile?.name);
  document.body.append(link);
  link.click();
  link.remove();
}

async function applyResultToMain() {
  if (!resultBlob || processing) return;
  processing = true;
  const button = $("mastering-apply-main");
  const originalLabel = button.textContent;
  button.textContent = "正在保存…";
  try {
    const file = new File([resultBlob], masteredFilename(sourceFile?.name), { type: "audio/wav", lastModified: Date.now() });
    await saveStoredMedia("audio", file);
    void navigator.storage?.persist?.().catch(() => false);
    status("母帶音樂已保存，正在返回主畫面…");
    location.href = "./index.html";
  } catch (cause) {
    error(cause?.message || "無法將母帶音樂保存到主畫面。");
    processing = false;
    button.textContent = originalLabel;
  }
}

$("mastering-drop").addEventListener("click", () => {
  $("mastering-input").value = "";
  $("mastering-input").click();
});
$("mastering-input").addEventListener("change", event => loadFile(event.target.files?.[0], "upload"));
for (const eventName of ["dragenter", "dragover"]) {
  $("mastering-drop").addEventListener(eventName, event => {
    event.preventDefault();
    if (!processing) $("mastering-drop").classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  $("mastering-drop").addEventListener(eventName, event => {
    event.preventDefault();
    $("mastering-drop").classList.remove("dragging");
  });
}
$("mastering-drop").addEventListener("drop", event => {
  if (!processing) void loadFile(event.dataTransfer.files?.[0], "upload");
});
$("mastering-preset").addEventListener("change", updatePresetVisibility);
$("mastering-intensity").addEventListener("input", () => {
  $("mastering-intensity-value").textContent = `${$("mastering-intensity").value}%`;
});
$("mastering-clarity").addEventListener("input", () => {
  $("mastering-clarity-value").textContent = EQ_LEVEL_LABELS[Number($("mastering-clarity").value) - 1] || "標準";
});
$("mastering-impact").addEventListener("input", () => {
  $("mastering-impact-value").textContent = EQ_LEVEL_LABELS[Number($("mastering-impact").value) - 1] || "標準";
});
$("mastering-start").addEventListener("click", startMastering);
$("mastering-download").addEventListener("click", downloadResult);
$("mastering-apply-main").addEventListener("click", applyResultToMain);
window.addEventListener("unload", () => {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
});

function restoreWhenIdle(task) {
  const run = () => void task();
  if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(run, { timeout: 1200 });
  else setTimeout(run, 0);
}

async function restoreSharedAudio() {
  // 這是 requestIdleCallback 延後執行的自動帶入；如果使用者在它排到之前就已經手動選好
  // 音樂了（sourceFile 已經有值），就不要用主畫面的音樂蓋掉使用者剛剛的選擇。
  if (sourceFile) return;
  try {
    const record = await loadStoredMedia("audio");
    if (record && !sourceFile) await loadFile(unpackStoredMedia(record), "main");
  } catch (cause) {
    if (!sourceFile) status(`無法帶入主畫面音樂：${cause.message}`, "error");
  }
}

restoreWhenIdle(() => void restoreSharedAudio());
