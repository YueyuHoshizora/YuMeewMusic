import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { loadStoredMedia, saveStoredMedia, unpackStoredMedia } from "./media-store.js";
import {
  SEPARATOR_MAX_DURATION,
  SEPARATOR_MODEL_SIZE_MB,
  SEPARATOR_SAMPLE_RATE,
  encodeStereoWav,
  mixSeparatedWav,
  separatorFilename,
} from "./vocal-separator-core.js";

const $ = id => document.getElementById(id);
const MAX_FILE_SIZE = 150 * 1024 * 1024;
const TRACK_SETTINGS_KEY = "yumeew.separator.track-eq.v1";
const TRACK_NAMES = ["vocals", "instrumental"];
const EQ_BANDS = ["bass", "mid", "treble"];
const restored = loadSettings();
applyTheme(restored.mode, restored.theme);

let sourceFile = null;
let decodedBuffer = null;
let worker = null;
let working = false;
let mixing = false;
let modelReady = false;
let originalUrl = "";
let vocalsBlob = null;
let instrumentalBlob = null;
const resultUrls = { vocals: "", instrumental: "" };
let trackAudioContext = null;
const trackAudioNodes = {};
let spectrumFrame = 0;
let separatedDuration = 0;

function loadTrackSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(TRACK_SETTINGS_KEY) || "{}");
  } catch {}
  return Object.fromEntries(TRACK_NAMES.map(track => {
    const volume = Number(saved?.[track]?.volume);
    return [track, {
      muted: false,
      volume: Number.isFinite(volume) ? Math.min(10, Math.max(-10, volume)) : 0,
      ...Object.fromEntries(EQ_BANDS.map(band => {
        const value = Number(saved?.[track]?.[band]);
        return [band, Number.isFinite(value) ? Math.min(10, Math.max(-10, value)) : 0];
      })),
    }];
  }));
}

const trackSettings = loadTrackSettings();

function saveTrackSettings() {
  try {
    localStorage.setItem(TRACK_SETTINGS_KEY, JSON.stringify(Object.fromEntries(TRACK_NAMES.map(track => [
      track,
      { volume: trackSettings[track].volume, ...Object.fromEntries(EQ_BANDS.map(band => [band, trackSettings[track][band]])) },
    ]))));
  } catch {}
}

function formatDb(value) {
  const numeric = Number(value) || 0;
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(1)} dB`;
}

function applyTrackSettings(track) {
  const settings = trackSettings[track];
  const nodes = trackAudioNodes[track];
  const audio = $(`separator-${track}`);
  if (nodes) {
    for (const band of EQ_BANDS) nodes[band].gain.value = settings[band];
    nodes.output.gain.value = settings.muted ? 0 : 10 ** (settings.volume / 20);
    audio.muted = false;
  } else {
    audio.muted = settings.muted;
  }
  const mute = $(`mute-${track}`);
  mute.classList.toggle("active", settings.muted);
  mute.setAttribute("aria-pressed", String(settings.muted));
  mute.textContent = settings.muted ? "取消 MUTE" : "MUTE";
  $(`${track}-volume`).value = String(settings.volume);
  $(`${track}-volume-value`).textContent = formatDb(settings.volume);
  for (const band of EQ_BANDS) {
    $(`${track}-${band}`).value = String(settings[band]);
    $(`${track}-${band}-value`).textContent = formatDb(settings[band]);
  }
}

function hasTrackProcessing(track) {
  return Math.abs(trackSettings[track].volume) > 0.001 || EQ_BANDS.some(band => Math.abs(trackSettings[track][band]) > 0.001);
}

async function ensureTrackAudio(track) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  trackAudioContext ||= new AudioContextClass();
  if (trackAudioContext.state === "suspended") await trackAudioContext.resume();
  if (!trackAudioNodes[track]) {
    const source = trackAudioContext.createMediaElementSource($(`separator-${track}`));
    const bass = trackAudioContext.createBiquadFilter();
    const mid = trackAudioContext.createBiquadFilter();
    const treble = trackAudioContext.createBiquadFilter();
    const output = trackAudioContext.createGain();
    const analyser = trackAudioContext.createAnalyser();
    bass.type = "lowshelf";
    bass.frequency.value = 200;
    mid.type = "peaking";
    mid.frequency.value = 1000;
    mid.Q.value = 1;
    treble.type = "highshelf";
    treble.frequency.value = 4000;
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    source.connect(bass).connect(mid).connect(treble).connect(output).connect(analyser).connect(trackAudioContext.destination);
    trackAudioNodes[track] = { source, bass, mid, treble, output, analyser };
    applyTrackSettings(track);
  }
}

function activateTrackAudio(track) {
  void ensureTrackAudio(track).catch(() => {
    $("separator-status").textContent = "目前瀏覽器無法啟用音量與 EQ 處理，音軌將使用原始聲音播放。";
  });
}

function formatBytes(bytes) {
  return bytes < 1024 ** 2 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function updateSeparatedTime(time = 0) {
  $("separated-time").textContent = `${formatTime(time)} / ${formatTime(separatedDuration)}`;
}

function drawTrackSpectrum(track) {
  const canvas = $(`${track}-spectrum`), context = canvas.getContext("2d");
  const analyser = trackAudioNodes[track]?.analyser;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#c5fa75";
  if (!analyser) {
    context.fillStyle = accent;
    context.globalAlpha = 0.35;
    context.fillRect(0, canvas.height / 2, canvas.width, 1);
    context.globalAlpha = 1;
    return;
  }
  const frequencies = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(frequencies);
  const bars = 64, gap = 2, width = (canvas.width - gap * (bars - 1)) / bars;
  context.fillStyle = accent;
  for (let index = 0; index < bars; index++) {
    const start = Math.floor(index * frequencies.length / bars);
    const end = Math.max(start + 1, Math.floor((index + 1) * frequencies.length / bars));
    let level = 0;
    for (let i = start; i < end; i++) level = Math.max(level, frequencies[i]);
    const height = Math.max(2, level / 255 * (canvas.height - 12));
    context.fillRect(index * (width + gap), (canvas.height - height) / 2, width, height);
  }
}

function pauseSeparatedPlayback() {
  for (const track of TRACK_NAMES) $(`separator-${track}`).pause();
  $("separated-play").textContent = "▶ 同步播放";
}

function renderSeparatedPlayback() {
  const master = $("separator-vocals"), companion = $("separator-instrumental");
  if (!master.paused) {
    if (Math.abs(companion.currentTime - master.currentTime) > 0.08) companion.currentTime = master.currentTime;
    $("separated-position").value = String(master.currentTime);
    updateSeparatedTime(master.currentTime);
  }
  for (const track of TRACK_NAMES) drawTrackSpectrum(track);
  if (!master.paused || !companion.paused) spectrumFrame = requestAnimationFrame(renderSeparatedPlayback);
  else spectrumFrame = 0;
}

async function toggleSeparatedPlayback() {
  const audios = TRACK_NAMES.map(track => $(`separator-${track}`));
  if (audios.some(audio => !audio.paused)) {
    pauseSeparatedPlayback();
    return;
  }
  const button = $("separated-play");
  button.disabled = true;
  try {
    await Promise.all(TRACK_NAMES.map(ensureTrackAudio));
    let time = Number($("separated-position").value) || 0;
    if (time >= separatedDuration - 0.02) time = 0;
    for (const audio of audios) audio.currentTime = time;
    await Promise.all(audios.map(audio => audio.play()));
    button.textContent = "Ⅱ 同步暫停";
    if (!spectrumFrame) spectrumFrame = requestAnimationFrame(renderSeparatedPlayback);
  } catch (error) {
    pauseSeparatedPlayback();
    $("separator-status").textContent = error?.message || "目前瀏覽器無法同步播放兩條音軌。";
  } finally {
    button.disabled = false;
  }
}

function setupSeparatedPlayback(duration) {
  separatedDuration = Math.max(0, duration);
  const position = $("separated-position");
  position.max = String(separatedDuration);
  position.value = "0";
  updateSeparatedTime();
  pauseSeparatedPlayback();
  for (const track of TRACK_NAMES) drawTrackSpectrum(track);
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
  if (spectrumFrame) cancelAnimationFrame(spectrumFrame);
  spectrumFrame = 0;
  separatedDuration = 0;
  for (const key of Object.keys(resultUrls)) {
    if (resultUrls[key]) URL.revokeObjectURL(resultUrls[key]);
    resultUrls[key] = "";
  }
  vocalsBlob = instrumentalBlob = null;
  for (const track of TRACK_NAMES) {
    const audio = $(`separator-${track}`);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
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
    $("separator-status").textContent = modelReady
      ? "準備完成；AI 模型仍在記憶體中，可直接開始分離。"
      : `準備完成；開始後將下載約 ${SEPARATOR_MODEL_SIZE_MB} MB 的模型。`;
    $("separator-engine").textContent = navigator.gpu ? "WebGPU 可用" : "WASM CPU 模式";
  } catch (error) {
    $("separator-file-help").textContent = "MP3 · WAV · M4A · FLAC · 150 MB 以內";
    showError(error?.message || "無法解碼這個音樂檔案。");
  } finally {
    $("separator-drop").disabled = false;
  }
}

async function restoreMainAudio() {
  try {
    const record = await loadStoredMedia("audio");
    if (record) await loadFile(unpackStoredMedia(record));
  } catch (error) {
    $("separator-status").textContent = `無法帶入主畫面音樂：${error.message}`;
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
  $("separator-status").textContent = modelReady
    ? "正在準備音訊並沿用已載入的 AI 模型…"
    : `正在準備音訊與約 ${SEPARATOR_MODEL_SIZE_MB} MB 的 AI 模型…`;
  try {
    if (!decodedBuffer) decodedBuffer = await decodeFile(sourceFile);
    const left = Float32Array.from(decodedBuffer.getChannelData(0));
    const right = Float32Array.from(decodedBuffer.numberOfChannels > 1 ? decodedBuffer.getChannelData(1) : decodedBuffer.getChannelData(0));
    decodedBuffer = null;
    if (!worker) {
      worker = new Worker(new URL("./vocal-separator-worker.js", import.meta.url), { type: "module" });
      worker.addEventListener("message", handleWorkerMessage);
      worker.addEventListener("error", event => finishWithError(event.message || "人聲分離處理程序發生錯誤。"));
    }
    worker.postMessage({ type: "separate", left: left.buffer, right: right.buffer }, [left.buffer, right.buffer]);
  } catch (error) {
    finishWithError(error?.message || "無法開始人聲分離。");
  }
}

function handleWorkerMessage(event) {
  const data = event.data || {};
  if (data.type === "gpu-fallback") {
    $("separator-gpu-diagnostic").textContent = `改用 CPU 的原因：${data.text}`;
    $("separator-gpu-diagnostic").hidden = false;
    return;
  }
  if (data.provider) $("separator-engine").textContent = data.provider === "webgpu" ? "WebGPU GPU 加速（FP32）" : "WASM CPU 模式";
  if (data.type === "status") {
    $("separator-status").textContent = data.text;
    return;
  }
  if (data.type === "progress") {
    modelReady = true;
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
  modelReady = true;
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
      setupSeparatedPlayback(data.vocalsLeft.length / SEPARATOR_SAMPLE_RATE);
      $("separator-results").hidden = false;
      $("separator-progress").value = 100;
      $("separator-status").textContent = "人聲與伴奏已完成，可同步播放頻譜或分別下載。";
      finish();
    } catch (error) {
      finishWithError(error?.message || "建立輸出檔案時記憶體不足。");
    }
  }, 0);
}

function finish() {
  setBusy(false);
  $("separator-start").textContent = "重新分離";
}

function finishWithError(text) {
  worker?.terminate();
  worker = null;
  modelReady = false;
  setBusy(false);
  $("separator-progress").hidden = true;
  $("separator-start").textContent = "重新嘗試";
  showError(text);
}

function cancel() {
  if (!working) return;
  worker?.terminate();
  worker = null;
  modelReady = false;
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

async function downloadMix() {
  if (!vocalsBlob || !instrumentalBlob || !sourceFile || mixing) return;
  setMixBusy(true);
  try {
    const blob = await createAdjustedMix();
    download(blob, "mixed");
    $("separator-status").textContent = "已套用 MUTE、音量與 EQ，並完成混合 WAV。";
  } catch (error) {
    showError(error?.message || "無法建立混合 WAV。");
  } finally {
    setMixBusy(false);
  }
}

function setMixBusy(value) {
  mixing = value;
  $("download-mix").disabled = value;
  $("apply-mix-main").disabled = value;
  if (!value) {
    $("download-mix").textContent = "下載混合後 WAV";
    $("apply-mix-main").textContent = "套用到主畫面";
  }
}

function createAdjustedMix() {
  return mixSeparatedWav(vocalsBlob, instrumentalBlob, trackSettings, (fraction, pass) => {
    const progress = Math.round((pass * 0.5 + fraction * 0.5) * 100);
    $("download-mix").textContent = `正在混合 ${progress}%`;
    $("apply-mix-main").textContent = `正在混合 ${progress}%`;
  });
}

async function applyMixToMain() {
  if (!vocalsBlob || !instrumentalBlob || !sourceFile || mixing) return;
  setMixBusy(true);
  try {
    const blob = await createAdjustedMix();
    $("apply-mix-main").textContent = "正在保存…";
    const file = new File([blob], separatorFilename(sourceFile.name, "mixed"), {
      type: "audio/wav",
      lastModified: Date.now(),
    });
    await saveStoredMedia("audio", file);
    void navigator.storage?.persist?.().catch(() => false);
    $("separator-status").textContent = "混合音軌已保存，正在返回主畫面…";
    mixing = false;
    location.href = "./index.html";
  } catch (error) {
    showError(error?.message || "無法將混合音軌保存到主畫面。");
    setMixBusy(false);
  }
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
$("download-mix").addEventListener("click", downloadMix);
$("apply-mix-main").addEventListener("click", applyMixToMain);
$("separated-play").addEventListener("click", toggleSeparatedPlayback);
$("separated-position").addEventListener("input", event => {
  const time = Number(event.target.value) || 0;
  for (const track of TRACK_NAMES) $(`separator-${track}`).currentTime = time;
  updateSeparatedTime(time);
});
for (const track of TRACK_NAMES) {
  applyTrackSettings(track);
  const audio = $(`separator-${track}`);
  audio.addEventListener("ended", pauseSeparatedPlayback);
  audio.addEventListener("pointerdown", () => {
    if (hasTrackProcessing(track)) activateTrackAudio(track);
  });
  audio.addEventListener("keydown", () => {
    if (hasTrackProcessing(track)) activateTrackAudio(track);
  });
  $(`mute-${track}`).addEventListener("click", () => {
    trackSettings[track].muted = !trackSettings[track].muted;
    applyTrackSettings(track);
  });
  $(`${track}-volume`).addEventListener("input", event => {
    const raw = Number(event.target.value);
    trackSettings[track].volume = raw <= -9.95 ? -10 : raw >= 9.95 ? 10 : Math.round(raw / 0.3) * 0.3;
    applyTrackSettings(track);
    saveTrackSettings();
    activateTrackAudio(track);
  });
  for (const band of EQ_BANDS) $(`${track}-${band}`).addEventListener("input", event => {
    trackSettings[track][band] = Number(event.target.value);
    applyTrackSettings(track);
    saveTrackSettings();
    activateTrackAudio(track);
  });
}
window.addEventListener("beforeunload", event => {
  if (!working && !mixing) return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("unload", () => {
  worker?.terminate();
  trackAudioContext?.close().catch(() => {});
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  for (const url of Object.values(resultUrls)) if (url) URL.revokeObjectURL(url);
});
void restoreMainAudio();
