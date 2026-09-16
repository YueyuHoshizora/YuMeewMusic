import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { saveStoredMedia } from "./media-store.js";
import { convertMediaFile } from "./converter-core.js";
import { resolveSunoAudio } from "./suno-source.js";

const $ = id => document.getElementById(id);

applyTheme(loadSettings().mode, loadSettings().theme);

function prefillSharedUrlFromQueryString() {
  const shared = new URLSearchParams(location.search).get("q");
  if (shared) $("suno-url").value = shared;
}

prefillSharedUrlFromQueryString();

let audioBlob = null;
let audioUrl = "";
let fileName = "suno-music.wav";
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
  $("suno-result").hidden = true;
  $("suno-cover").removeAttribute("src");
  $("suno-cover").hidden = true;
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
    const { blob: playableBlob, metadata: result } = await resolveSunoAudio(url, {
      onProgress({ received, total, percent }) {
        $("suno-progress").value = Math.max(10, Math.min(70, 10 + (percent || 0) * 0.6));
        $("suno-status").textContent = total
          ? `正在下載音樂 ${percent}% · ${formatBytes(received)} / ${formatBytes(total)}`
          : `正在下載音樂 · 已接收 ${formatBytes(received)}`;
      },
    });
    $("suno-progress").value = 75;
    $("suno-fetch").textContent = "正在轉換…";
    $("suno-status").textContent = "M4A 已下載，正在瀏覽器中轉換為 16-bit PCM WAV…";
    audioBlob = await convertToWav(playableBlob);
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

function downloadAudio() {
  if (!audioBlob || busy) return;
  downloadBlob(audioBlob, fileName);
  $("suno-status-badge").className = "suno-status-badge ready";
  $("suno-status-badge").textContent = "下載完成";
  $("suno-status").textContent = `WAV 已開始下載 · ${formatBytes(audioBlob.size)}`;
}

async function applyToMain(destination = "./index.html", triggerButton = $("suno-apply")) {
  if (!audioBlob || busy) return;
  setBusy(true);
  const originalLabel = triggerButton.textContent;
  triggerButton.textContent = "正在保存…";
  setError();
  try {
    const file = new File([audioBlob], fileName, { type: "audio/wav", lastModified: Date.now() });
    await saveStoredMedia("audio", file);
    void navigator.storage?.persist?.().catch(() => false);
    $("suno-status").textContent = "音樂已保存，正在前往下一步…";
    location.href = destination;
  } catch (error) {
    setError(error?.message || "無法將音樂保存到主畫面。");
    setBusy(false);
    triggerButton.textContent = originalLabel;
  }
}

$("suno-form").addEventListener("submit", fetchSuno);
$("suno-download").addEventListener("click", downloadAudio);
$("suno-apply").addEventListener("click", () => applyToMain("./index.html", $("suno-apply")));
$("suno-apply-recognize").addEventListener("click", () => applyToMain("./subtitle-editor.html?recognize=1", $("suno-apply-recognize")));
window.addEventListener("unload", () => { if (audioUrl) URL.revokeObjectURL(audioUrl); });
