import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { saveStoredMedia } from "./media-store.js";
import { convertMediaFile } from "./converter-core.js";
import { encodeMedia } from "./export.js";
import { parseSubtitles } from "./subtitles.js";

const $ = id => document.getElementById(id);
const PROXY_URL = "https://model-proxy.yustellar.idv.tw/suno/resolve";
const MAX_AUDIO_BYTES = 300 * 1024 * 1024;

applyTheme(loadSettings().mode, loadSettings().theme);

let audioBlob = null;
let audioUrl = "";
let fileName = "suno-music.wav";
let lyrics = "";
let busy = false;

function safeFileName(title) {
  const base = String(title || "suno-music").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${base || "suno-music"}.wav`;
}

function formatBytes(bytes) {
  return bytes < 1024 ** 2 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

function setError(message = "") {
  $("suno-error").textContent = message;
  $("suno-error").hidden = !message;
  $("suno-status-badge").classList.toggle("error", Boolean(message));
  if (message) $("suno-status-badge").textContent = "無法取得";
}

function setBusy(value) {
  busy = value;
  $("suno-url").disabled = value;
  $("suno-fetch").disabled = value;
  $("suno-download").disabled = value;
  $("suno-srt-download").disabled = value;
  $("suno-srt-language").disabled = value;
  $("suno-apply").disabled = value;
  $("suno-progress").hidden = !value;
}

function clearAudio() {
  $("suno-player").pause();
  $("suno-player").removeAttribute("src");
  $("suno-player").load();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = "";
  audioBlob = null;
  lyrics = "";
  $("suno-result").hidden = true;
  $("suno-cover").removeAttribute("src");
  $("suno-cover").hidden = true;
}

async function readAudioResponse(response) {
  if (!response.ok) throw Error(`音樂下載失敗（${response.status}）`);
  const contentType = response.headers.get("Content-Type") || "";
  if (!/^audio\//i.test(contentType)) throw Error("取得的內容不是可播放的音樂檔案。");
  const contentLength = Number(response.headers.get("Content-Length")) || 0;
  if (contentLength > MAX_AUDIO_BYTES) throw Error("音樂檔案超過 300 MB，無法套用到主畫面。");
  if (!response.body) return response.blob();
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw Error("音樂檔案超過 300 MB，已停止下載。");
    }
    chunks.push(value);
    const progress = contentLength ? Math.round(received / contentLength * 100) : 0;
    $("suno-progress").value = Math.max(10, Math.min(70, 10 + progress * 0.6));
    $("suno-status").textContent = contentLength
      ? `正在下載音樂 ${progress}% · ${formatBytes(received)} / ${formatBytes(contentLength)}`
      : `正在下載音樂 · 已接收 ${formatBytes(received)}`;
  }
  return new Blob(chunks, { type: contentType || "audio/mp4" });
}

async function fetchSuno(event) {
  event.preventDefault();
  if (busy) return;
  const url = $("suno-url").value.trim();
  clearAudio();
  setError();
  setBusy(true);
  $("suno-progress").value = 4;
  $("suno-fetch").textContent = "正在解析…";
  $("suno-status-badge").className = "suno-status-badge";
  $("suno-status-badge").textContent = "解析中";
  $("suno-status").textContent = "正在讀取公開 Suno 分享頁…";
  try {
    const resolveResponse = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const result = await resolveResponse.json().catch(() => ({}));
    if (!resolveResponse.ok) throw Error(result.error || result.message || `分享連結解析失敗（${resolveResponse.status}）`);
    $("suno-progress").value = 10;
    $("suno-fetch").textContent = "正在下載…";
    $("suno-status").textContent = "已找到音樂，正在從 Suno CDN 下載…";
    const m4aBlob = await readAudioResponse(await fetch(result.audioUrl, { cache: "no-store" }));
    $("suno-progress").value = 70;
    const playableBlob = result.encrypted ? await decryptSunoAudio(m4aBlob, result) : m4aBlob;
    $("suno-progress").value = 75;
    $("suno-fetch").textContent = "正在轉換…";
    $("suno-status").textContent = "M4A 已下載，正在瀏覽器中轉換為 16-bit PCM WAV…";
    audioBlob = await convertToWav(playableBlob);
    lyrics = String(result.lyrics || "").trim();
    audioUrl = URL.createObjectURL(audioBlob);
    fileName = safeFileName(result.title);
    $("suno-player").src = audioUrl;
    $("suno-player").load();
    $("suno-title").textContent = result.title || "Suno 音樂";
    $("suno-artist").textContent = result.artist || "";
    $("suno-artist").hidden = !result.artist;
    $("suno-file-info").textContent = `${fileName} · ${formatBytes(audioBlob.size)}`;
    if (result.imageUrl) {
      $("suno-cover").src = result.imageUrl;
      $("suno-cover").hidden = false;
    }
    $("suno-result").hidden = false;
    $("suno-progress").value = 100;
    $("suno-status-badge").className = "suno-status-badge ready";
    $("suno-status-badge").textContent = "準備完成";
    $("suno-status").textContent = "WAV 已準備完成，可播放、下載或套用到主畫面。";
  } catch (error) {
    clearAudio();
    setError(error?.message || "目前無法取得這首 Suno 音樂。");
    $("suno-status").textContent = "請確認連結可公開播放後再試一次。";
  } finally {
    setBusy(false);
    $("suno-fetch").textContent = "取得音樂";
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function convertToWav(blob) {
  const file = new File([blob], "suno-source.m4a", { type: blob.type || "audio/mp4" });
  return convertMediaFile({
    file,
    format: "wav",
    inputKind: "audio",
    hasAudio: true,
    audioChannels: 2,
    onProgress(value) { $("suno-progress").value = 75 + value * 0.24; },
  });
}

function base64Bytes(value) {
  try { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
  catch { throw Error("Suno 播放授權格式不正確。"); }
}

async function decryptSunoAudio(blob, result) {
  const rights = result.playbackRights;
  if (!rights?.key || !rights?.iv || !rights?.glt || !result.songId) throw Error("無法取得這首歌的公開播放授權。");
  const text = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", text.encode(rights.glt));
  const userKey = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
  const unwrap = async value => {
    const wrapped = base64Bytes(value);
    if (wrapped.length <= 12) throw Error("Suno 播放授權內容不完整。");
    return new Uint8Array(await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: wrapped.slice(0, 12),
      additionalData: text.encode(result.songId),
    }, userKey, wrapped.slice(12)));
  };
  const [rawKey, iv] = await Promise.all([unwrap(rights.key), unwrap(rights.iv)]);
  if (iv.length !== 16) throw Error("Suno 音訊初始向量格式不正確。");
  const contentKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-CTR" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-CTR", counter: iv, length: 128 }, contentKey, await blob.arrayBuffer());
  const bytes = new Uint8Array(decrypted);
  if (bytes.length < 12 || String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp") throw Error("Suno 音訊解密後不是可辨識的 M4A。");
  return new Blob([bytes], { type: "audio/mp4" });
}

function downloadAudio() {
  if (!audioBlob || busy) return;
  downloadBlob(audioBlob, fileName);
  $("suno-status-badge").className = "suno-status-badge ready";
  $("suno-status-badge").textContent = "下載完成";
  $("suno-status").textContent = `WAV 已開始下載 · ${formatBytes(audioBlob.size)}`;
}

async function transcriptionWav() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const OfflineContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioContextClass || !OfflineContextClass) throw Error("此瀏覽器無法建立字幕辨識用音訊。");
  const context = new AudioContextClass();
  let decoded;
  try { decoded = await context.decodeAudioData(await audioBlob.arrayBuffer()); }
  finally { await context.close().catch(() => {}); }
  const offline = new OfflineContextClass(1, Math.ceil(decoded.duration * 16000), 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const buffer = await offline.startRendering();
  const wav = await encodeMedia({
    format: "wav",
    buffer,
    settings: { exportVolume: 100, eqBass: 0, eqMid: 0, eqTreble: 0 },
    resolution: "1080",
    fps: "60",
    signal: new AbortController().signal,
    onProgress(value) { $("suno-progress").value = 15 + value * .25; },
  });
  return { wav, duration: buffer.duration };
}

async function downloadSrt() {
  if (!audioBlob || busy) return;
  if (!lyrics) {
    setError("這個 Suno 公開頁面沒有可用的歌詞文字，無法產生 SRT。");
    return;
  }
  setBusy(true);
  setError();
  $("suno-srt-download").textContent = "正在產生…";
  $("suno-progress").value = 10;
  $("suno-status").textContent = "正在建立單聲道、16 kHz、16-bit PCM 辨識音訊…";
  try {
    const { wav, duration } = await transcriptionWav();
    $("suno-progress").value = 45;
    $("suno-status").textContent = "正在依照 Suno 公開歌詞產生字幕時間碼…";
    const form = new FormData();
    form.append("audio", wav, fileName.replace(/\.wav$/i, "-subtitle.wav"));
    form.append("language", $("suno-srt-language").value);
    form.append("lyrics", lyrics);
    form.append("duration", String(duration));
    const response = await fetch("https://lyrics-transcriber.yustellar.idv.tw", { method: "POST", body: form });
    const srt = await response.text();
    if (!response.ok) throw Error(srt.trim().slice(0, 300) || `字幕服務回應錯誤（HTTP ${response.status}）。`);
    if (!parseSubtitles(srt, "srt").cues.length) throw Error("字幕服務沒有回傳有效的 SRT。");
    const srtName = fileName.replace(/\.wav$/i, ".srt");
    downloadBlob(new Blob([srt], { type: "application/x-subrip;charset=utf-8" }), srtName);
    $("suno-progress").value = 100;
    $("suno-status-badge").className = "suno-status-badge ready";
    $("suno-status-badge").textContent = "字幕完成";
    $("suno-status").textContent = `${srtName} 已開始下載。`;
  } catch (error) {
    setError(error?.message || "無法產生 SRT 字幕。");
    $("suno-status").textContent = "音樂仍可播放與下載，請稍後再試字幕功能。";
  } finally {
    setBusy(false);
    $("suno-srt-download").textContent = "產生並下載 SRT";
  }
}

async function applyToMain() {
  if (!audioBlob || busy) return;
  setBusy(true);
  $("suno-apply").textContent = "正在保存…";
  setError();
  try {
    const file = new File([audioBlob], fileName, { type: "audio/wav", lastModified: Date.now() });
    await saveStoredMedia("audio", file);
    void navigator.storage?.persist?.().catch(() => false);
    $("suno-status").textContent = "音樂已保存，正在返回主畫面…";
    location.href = "./index.html";
  } catch (error) {
    setError(error?.message || "無法將音樂保存到主畫面。");
    setBusy(false);
    $("suno-apply").textContent = "套用到主畫面";
  }
}

$("suno-form").addEventListener("submit", fetchSuno);
$("suno-download").addEventListener("click", downloadAudio);
$("suno-srt-download").addEventListener("click", downloadSrt);
$("suno-apply").addEventListener("click", applyToMain);
window.addEventListener("unload", () => { if (audioUrl) URL.revokeObjectURL(audioUrl); });
