import { t } from "./i18n.js";
import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { loadStoredMedia, saveStoredMedia, unpackStoredMedia } from "./media-store.js";
import { encodeStereoWav } from "./vocal-separator-core.js";
import { encodeMedia } from "./export.js";
import {
  MASTER_PRESETS,
  EQ_LEVEL_COUNT,
  EQ_DEFAULT_LEVEL,
  EQ_PRESENCE_FREQUENCY_HZ,
  EQ_PRESENCE_Q,
  EQ_IMPACT_SHELF_FREQUENCY_HZ,
  eqLevelToGainDb,
  measureIntegratedLoudness,
  masterAudioChannels,
  masteredFilename,
} from "./ai-mastering-core.js";
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
  $("mastering-clarity-value").textContent = t(EQ_LEVEL_LABELS[EQ_DEFAULT_LEVEL]);
  $("mastering-impact").value = String(defaultLevel);
  $("mastering-impact-value").textContent = t(EQ_LEVEL_LABELS[EQ_DEFAULT_LEVEL]);
  // 循環播放試聽同樣不寫入任何暫存，每次打開頁面固定預設為開啟。
  $("mastering-loop").checked = true;
  $("mastering-original").loop = true;
}
resetMasteringDefaults();
window.addEventListener("pageshow", event => {
  if (event.persisted) resetMasteringDefaults();
});

let sourceFile = null;
let audioBuffer = null;
let originalUrl = "";
let resultBlob = null;
let resultFlacBlob = null;
let resultLeft = null;
let resultRight = null;
let resultToken = 0;
let resultUrl = "";
let downloadUrl = "";
let processing = false;
let loadToken = 0;

// ---- 原音試聽波形圖 ----
// 為了讓使用者在調整母帶設定時更直觀，原音試聽播放器下方會畫出整段音樂的波形，
// 並在播放時同步畫出播放進度（已播放的部分用主色標示）。波形資料只在選檔時
// 掃過一次整個緩衝區、分成固定段數存起來，畫面重繪（含每個動畫影格）只需要
// 讀取這個已經算好的陣列，不會每一影格都重新掃過整首歌，避免長音樂卡頓。
const WAVEFORM_BUCKETS = 600;
let waveformPeaks = null;
let waveformAnimationFrame = 0;

function computeWaveformPeaks(buffer) {
  const length = buffer.length;
  const bucketSize = Math.max(1, Math.floor(length / WAVEFORM_BUCKETS));
  const peaks = new Float32Array(WAVEFORM_BUCKETS);
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  for (let bucket = 0; bucket < WAVEFORM_BUCKETS; bucket++) {
    const start = bucket * bucketSize;
    const end = bucket === WAVEFORM_BUCKETS - 1 ? length : Math.min(start + bucketSize, length);
    let peak = 0;
    for (const data of channels) {
      for (let i = start; i < end; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }
    peaks[bucket] = peak;
  }
  return peaks;
}

function drawWaveform() {
  const canvas = $("mastering-waveform");
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 600;
  const cssHeight = canvas.clientHeight || 64;
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  if (!waveformPeaks) return;
  const rootStyle = getComputedStyle(document.documentElement);
  const waveColor = rootStyle.getPropertyValue("--border").trim() || "#ccc";
  const progressColor = rootStyle.getPropertyValue("--primary").trim() || "#4a90d9";
  const mid = cssHeight / 2;
  const barWidth = cssWidth / WAVEFORM_BUCKETS;
  const duration = audioBuffer?.duration || 0;
  const progress = duration > 0 ? Math.min(1, $("mastering-original").currentTime / duration) : 0;
  const progressBucket = progress * WAVEFORM_BUCKETS;
  for (let bucket = 0; bucket < WAVEFORM_BUCKETS; bucket++) {
    const barHeight = Math.max(1.5, waveformPeaks[bucket] * (cssHeight - 6));
    ctx.fillStyle = bucket <= progressBucket ? progressColor : waveColor;
    ctx.fillRect(bucket * barWidth, mid - barHeight / 2, Math.max(1, barWidth - 0.5), barHeight);
  }
}

function waveformTick() {
  drawWaveform();
  if (!$("mastering-original").paused) waveformAnimationFrame = requestAnimationFrame(waveformTick);
  else waveformAnimationFrame = 0;
}

function startWaveformAnimation() {
  if (waveformAnimationFrame) return;
  waveformAnimationFrame = requestAnimationFrame(waveformTick);
}

function stopWaveformAnimation() {
  if (waveformAnimationFrame) cancelAnimationFrame(waveformAnimationFrame);
  waveformAnimationFrame = 0;
  drawWaveform();
}

$("mastering-original").addEventListener("play", startWaveformAnimation);
$("mastering-original").addEventListener("pause", stopWaveformAnimation);
$("mastering-original").addEventListener("ended", stopWaveformAnimation);
$("mastering-original").addEventListener("seeked", drawWaveform);
window.addEventListener("resize", () => {
  if (waveformPeaks) drawWaveform();
});
$("mastering-loop").addEventListener("change", () => {
  $("mastering-original").loop = $("mastering-loop").checked;
});

// ---- 母帶設定即時預覽（Web Audio）----
// 讓「目標響度／壓縮強度／人聲清晰度／背景音震撼度」這幾個設定在試聽原音時就能
// 立即聽出差異，不用等到按下「開始處理」才知道效果。這裡用瀏覽器原生的 Web Audio
// 節點組出一個近似的即時預覽鏈：EQ 沿用離線演算法一樣的頻率／Q 值常數與
// eqLevelToGainDb 增益換算（人聲清晰度、背景音震撼度），壓縮強度則用單一顆
// DynamicsCompressorNode 做近似（離線輸出仍然是真正的 4 段 Linkwitz-Riley 分頻
// 各自動態壓縮，即時預覽只是給一個聽感方向的參考，正式結果以「開始處理」之後的
// 離線演算法為準，這件事也寫在下面的「處理方式」說明裡）。
let previewContext = null;
let previewClarityFilter = null;
let previewImpactFilter = null;
let previewCompressor = null;
let previewMakeupGain = null;
let previewLoudnessGain = null;
let sourceLufs = NaN;

function ensurePreviewGraph() {
  if (previewContext) return;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  try {
    previewContext = new AudioContextCtor();
    const source = previewContext.createMediaElementSource($("mastering-original"));
    previewClarityFilter = previewContext.createBiquadFilter();
    previewClarityFilter.type = "peaking";
    previewClarityFilter.frequency.value = EQ_PRESENCE_FREQUENCY_HZ;
    previewClarityFilter.Q.value = EQ_PRESENCE_Q;
    previewImpactFilter = previewContext.createBiquadFilter();
    previewImpactFilter.type = "lowshelf";
    previewImpactFilter.frequency.value = EQ_IMPACT_SHELF_FREQUENCY_HZ;
    previewCompressor = previewContext.createDynamicsCompressor();
    previewCompressor.knee.value = 6;
    previewCompressor.attack.value = 0.01;
    previewCompressor.release.value = 0.25;
    previewMakeupGain = previewContext.createGain();
    previewLoudnessGain = previewContext.createGain();
    source.connect(previewClarityFilter);
    previewClarityFilter.connect(previewImpactFilter);
    previewImpactFilter.connect(previewCompressor);
    previewCompressor.connect(previewMakeupGain);
    previewMakeupGain.connect(previewLoudnessGain);
    previewLoudnessGain.connect(previewContext.destination);
    applyPreviewSettings();
  } catch (cause) {
    previewContext = null;
  }
}

function resumePreviewContext() {
  if (previewContext && previewContext.state === "suspended") void previewContext.resume().catch(() => {});
}

function setPreviewParam(param, value) {
  if (!previewContext || !param) return;
  param.setTargetAtTime(value, previewContext.currentTime, 0.02);
}

// 壓縮強度（0～100，介面上的「壓縮強度」）換算成 DynamicsCompressorNode 的
// threshold／ratio，只是近似值，用來讓這個設定在即時預覽時也聽得出差異。
function applyPreviewIntensity(intensity) {
  if (!previewContext) return;
  const clamped = Math.max(0, Math.min(100, intensity));
  const thresholdDb = -6 - clamped * 0.24; // -6 dB（0%）～ -30 dB（100%）
  const ratio = 1.5 + clamped * 0.065; // 1.5:1（0%）～ 8:1（100%）
  const makeupDb = clamped * 0.04; // 0～4 dB 補償，抵銷壓縮造成的音量下降感
  setPreviewParam(previewCompressor.threshold, thresholdDb);
  setPreviewParam(previewCompressor.ratio, ratio);
  setPreviewParam(previewMakeupGain.gain, 10 ** (makeupDb / 20));
}

function applyPreviewEq(clarityLevel, impactLevel) {
  if (!previewContext) return;
  setPreviewParam(previewClarityFilter.gain, eqLevelToGainDb(clarityLevel));
  setPreviewParam(previewImpactFilter.gain, eqLevelToGainDb(impactLevel));
}

function applyPreviewLoudness() {
  if (!previewContext || !Number.isFinite(sourceLufs)) return;
  const targetDb = Math.max(-24, Math.min(24, targetLufs() - sourceLufs));
  setPreviewParam(previewLoudnessGain.gain, 10 ** (targetDb / 20));
}

function applyPreviewSettings() {
  if (!previewContext) return;
  const intensity = Number($("mastering-intensity").value) || 0;
  const clarityLevel = (Number($("mastering-clarity").value) || 1) - 1;
  const impactLevel = (Number($("mastering-impact").value) || 1) - 1;
  applyPreviewIntensity(intensity);
  applyPreviewEq(clarityLevel, impactLevel);
  applyPreviewLoudness();
}

$("mastering-original").addEventListener("play", () => {
  ensurePreviewGraph();
  resumePreviewContext();
});

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
  $("mastering-status").textContent = t(text);
  $("mastering-status").className = `mastering-status ${mode}`.trim();
}
function error(text = "") {
  $("mastering-error").textContent = t(text);
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
  resultFlacBlob = null;
  resultLeft = null;
  resultRight = null;
  resultToken++;
  $("mastering-download-flac").disabled = false;
  $("mastering-download-flac").textContent = "下載母帶 FLAC";
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
  waveformPeaks = null;
  sourceLufs = NaN;
  stopWaveformAnimation();
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
    waveformPeaks = computeWaveformPeaks(audioBuffer);
    const loudnessLeft = audioBuffer.getChannelData(0);
    const loudnessRight = audioBuffer.numberOfChannels >= 2 ? audioBuffer.getChannelData(1) : loudnessLeft;
    sourceLufs = measureIntegratedLoudness([loudnessLeft, loudnessRight], audioBuffer.sampleRate);
    $("mastering-source").textContent = t(source === "main" ? "主畫面音樂" : "本機上傳");
    $("mastering-channels").textContent = t(audioBuffer.numberOfChannels >= 2 ? "立體聲" : "單聲道");
    $("mastering-samplerate").textContent = `${Math.round(audioBuffer.sampleRate / 100) / 10} kHz`;
    $("mastering-size").textContent = formatBytes(file.size);
    $("mastering-file-info").hidden = false;
    $("mastering-original").pause();
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalUrl = URL.createObjectURL(file);
    $("mastering-original").src = originalUrl;
    $("mastering-original").loop = $("mastering-loop").checked;
    $("mastering-file-help").textContent = "點擊可更換音樂";
    $("mastering-preset").disabled = false;
    $("mastering-intensity").disabled = false;
    $("mastering-clarity").disabled = false;
    $("mastering-impact").disabled = false;
    $("mastering-start").disabled = false;
    applyPreviewSettings();
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
    resultLeft = result.left;
    resultRight = result.right;
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

function triggerDownload(blob, filename) {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

function downloadResult() {
  if (!resultBlob) return;
  triggerDownload(resultBlob, masteredFilename(sourceFile?.name, "wav"));
}

async function downloadFlacResult() {
  if (!resultBlob || !resultLeft || !resultRight) return;
  if (resultFlacBlob) {
    triggerDownload(resultFlacBlob, masteredFilename(sourceFile?.name, "flac"));
    return;
  }
  const token = resultToken;
  const button = $("mastering-download-flac");
  button.disabled = true;
  button.textContent = "正在編碼 FLAC…";
  try {
    const flacBuffer = new AudioBuffer({
      length: resultLeft.length,
      numberOfChannels: 2,
      sampleRate: audioBuffer.sampleRate,
    });
    flacBuffer.copyToChannel(resultLeft, 0);
    flacBuffer.copyToChannel(resultRight, 1);
    const blob = await encodeMedia({
      format: "flac",
      buffer: flacBuffer,
      settings: { exportVolume: 100, eqBass: 0, eqMid: 0, eqTreble: 0 },
      resolution: "1080",
      fps: "60",
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    if (token !== resultToken) return;
    resultFlacBlob = blob;
    triggerDownload(resultFlacBlob, masteredFilename(sourceFile?.name, "flac"));
  } catch (cause) {
    if (token !== resultToken) return;
    error(cause?.message || "FLAC 編碼失敗，請改用 WAV 下載。");
  } finally {
    if (token === resultToken) {
      button.disabled = false;
      button.textContent = "下載母帶 FLAC";
    }
  }
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
$("mastering-preset").addEventListener("change", () => {
  updatePresetVisibility();
  applyPreviewLoudness();
});
$("mastering-custom-lufs-input").addEventListener("input", applyPreviewLoudness);
$("mastering-intensity").addEventListener("input", () => {
  $("mastering-intensity-value").textContent = `${$("mastering-intensity").value}%`;
  applyPreviewIntensity(Number($("mastering-intensity").value) || 0);
});
$("mastering-clarity").addEventListener("input", () => {
  $("mastering-clarity-value").textContent = t(EQ_LEVEL_LABELS[Number($("mastering-clarity").value) - 1] || "標準");
  applyPreviewEq((Number($("mastering-clarity").value) || 1) - 1, (Number($("mastering-impact").value) || 1) - 1);
});
$("mastering-impact").addEventListener("input", () => {
  $("mastering-impact-value").textContent = t(EQ_LEVEL_LABELS[Number($("mastering-impact").value) - 1] || "標準");
  applyPreviewEq((Number($("mastering-clarity").value) || 1) - 1, (Number($("mastering-impact").value) || 1) - 1);
});
$("mastering-start").addEventListener("click", startMastering);
$("mastering-download").addEventListener("click", downloadResult);
$("mastering-download-flac").addEventListener("click", () => void downloadFlacResult());
$("mastering-apply-main").addEventListener("click", applyResultToMain);
window.addEventListener("unload", () => {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  if (previewContext) void previewContext.close().catch(() => {});
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
    if (!sourceFile) status(t("無法帶入主畫面音樂：{0}", cause.message), "error");
  }
}

restoreWhenIdle(() => void restoreSharedAudio());
