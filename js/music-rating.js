import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { presentRating, ratingVerdict } from "./music-rating-core.js";
import { resolveSunoAudio } from "./suno-source.js";
import { registerAudioPlayer } from "./audio-player.js";
import { t, locale } from "./i18n.js";

const $ = id => document.getElementById(id);
const TARGET_SAMPLE_RATE = 16000;
const WASM_THREAD_FALLBACKS = [16, 8, 4, 1];
applyTheme(loadSettings().mode, loadSettings().theme);
const hardwareThreads = navigator.hardwareConcurrency;
const availableThreads = globalThis.crossOriginIsolated
  ? Math.min(WASM_THREAD_FALLBACKS[0], hardwareThreads || WASM_THREAD_FALLBACKS[0])
  : 1;
$("rating-capacity").textContent = (hardwareThreads
  ? t("瀏覽器回報：{0} 個邏輯核心；預估可用推論執行緒：{1}。", hardwareThreads, availableThreads)
  : t("瀏覽器回報：核心數未提供；預估可用推論執行緒：{0}。", availableThreads))
  + ` ${t(globalThis.crossOriginIsolated ? "直接使用 WASM CPU，啟動失敗依序以 8、4、1 執行緒重試；目前使用數量顯示於上方引擎標籤。" : "未啟用跨來源隔離，使用單執行緒。")}`;

// 單曲評分與雙曲比較各自獨立的播放器，畫面上同時間只會有一個在播放：使用者切到另一個
// 播放器時，原本在播的會自動暫停，不用自己手動協調。
for (const player of [$("rating-player"), $("rating-player-a"), $("rating-player-b")]) registerAudioPlayer(player);

let mode = "single";
let sources = [];
let worker = null;
let busy = false;
let fetching = false;
let pendingReject = null;
let cancelled = false;

function formatBytes(bytes) {
  return bytes < 1024 ** 2 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function setError(message = "") {
  $("rating-error").textContent = t(message);
  $("rating-error").hidden = !message;
  $("rating-engine").classList.toggle("error", Boolean(message));
  if (message) $("rating-engine").textContent = t("操作失敗");
}

function updateControls() {
  const locked = busy || fetching;
  for (const id of ["rating-suno-url", "rating-suno-url-a", "rating-suno-url-b", "rating-fetch", "rating-fetch-compare"])
    $(id).disabled = locked;
  for (const button of document.querySelectorAll("[data-rating-mode]")) button.disabled = locked;
  const ready = mode === "single" ? Boolean(sources[0]) : Boolean(sources[0] && sources[1]);
  $("rating-start").disabled = locked || !ready;
  $("rating-cancel").hidden = !busy;
}

function clearSources() {
  for (const source of sources) {
    source?.player?.pause();
    if (source?.url) URL.revokeObjectURL(source.url);
  }
  sources = [];
  for (const player of [$("rating-player"), $("rating-player-a"), $("rating-player-b")]) {
    player.removeAttribute("src");
    player.load();
  }
  $("rating-file").hidden = true;
  $("rating-compare-files").hidden = true;
  $("rating-results").hidden = true;
  $("rating-comparison").hidden = true;
  updateControls();
}

function selectMode(nextMode) {
  if (busy || fetching || !["single", "compare"].includes(nextMode) || nextMode === mode) return;
  mode = nextMode;
  clearSources();
  setError();
  for (const button of document.querySelectorAll("[data-rating-mode]")) {
    const active = button.dataset.ratingMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  $("rating-source-form").hidden = mode !== "single";
  $("rating-compare-form").hidden = mode !== "compare";
  $("rating-source-title").textContent = t(mode === "single" ? "Suno 分享連結" : "比較兩首歌曲");
  $("rating-start").textContent = t(mode === "single" ? "開始歌曲評分" : "開始比較評分");
  $("rating-status").textContent = t(mode === "single" ? "請先貼上公開的 Suno 分享連結。" : "請貼上歌曲 A 與歌曲 B 的公開分享連結。");
  $("rating-engine").className = "rating-engine";
  $("rating-engine").textContent = t("等待音樂");
}

async function decodeAudio(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw Error(t("此瀏覽器不支援音訊解碼。"));
  const context = new AudioContextClass();
  try { return await context.decodeAudioData(await blob.arrayBuffer()); }
  finally { await context.close(); }
}

async function resampleMono(buffer) {
  const OfflineClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineClass) throw Error(t("此瀏覽器不支援離線音訊分析。"));
  const context = new OfflineClass(1, Math.max(1, Math.ceil(buffer.duration * TARGET_SAMPLE_RATE)), TARGET_SAMPLE_RATE);
  const mono = context.createBuffer(1, buffer.length, buffer.sampleRate);
  const output = mono.getChannelData(0);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const input = buffer.getChannelData(channel);
    for (let index = 0; index < input.length; index++) output[index] += input[index] / buffer.numberOfChannels;
  }
  const source = context.createBufferSource();
  source.buffer = mono;
  source.connect(context.destination);
  source.start();
  return (await context.startRendering()).getChannelData(0).slice();
}

async function fetchSource(link, label, progressOffset = 0, progressScale = 1) {
  $("rating-status").textContent = t("正在解析{0}的公開 Suno 分享頁…", t(label));
  const { blob, metadata } = await resolveSunoAudio(link, {
    onProgress({ received, total, percent }) {
      if (percent != null) $("rating-progress").value = progressOffset + percent * progressScale;
      $("rating-status").textContent = total
        ? t("正在下載{0} {1}% · {2} / {3}", t(label), percent, formatBytes(received), formatBytes(total))
        : t("正在下載{0} · 已接收 {1}", t(label), formatBytes(received));
    },
  });
  $("rating-status").textContent = t("正在解碼{0}…", t(label));
  const buffer = await decodeAudio(blob);
  return { blob, metadata, buffer, url: URL.createObjectURL(blob) };
}

function showSingleSource(source) {
  source.player = $("rating-player");
  source.player.src = source.url;
  $("rating-file-name").textContent = source.metadata.title || t("Suno 音樂");
  $("rating-artist").textContent = source.metadata.artist || "";
  $("rating-artist").hidden = !source.metadata.artist;
  $("rating-file-info").textContent = `${formatTime(source.buffer.duration)} · ${source.buffer.sampleRate.toLocaleString(locale)} Hz · ${formatBytes(source.blob.size)}`;
  $("rating-file").hidden = false;
}

function showCompareSource(source, index) {
  const suffix = index === 0 ? "a" : "b";
  source.player = $(`rating-player-${suffix}`);
  source.player.src = source.url;
  $(`rating-file-name-${suffix}`).textContent = source.metadata.title || t(`歌曲 ${suffix.toUpperCase()}`);
  $(`rating-artist-${suffix}`).textContent = source.metadata.artist || "";
  $(`rating-artist-${suffix}`).hidden = !source.metadata.artist;
  $(`rating-file-info-${suffix}`).textContent = `${formatTime(source.buffer.duration)} · ${formatBytes(source.blob.size)}`;
}

async function fetchSingle(event) {
  event.preventDefault();
  if (busy || fetching) return;
  clearSources();
  setError();
  fetching = true;
  updateControls();
  $("rating-fetch").textContent = t("正在取得…");
  $("rating-progress").hidden = false;
  $("rating-progress").value = 0;
  $("rating-engine").className = "rating-engine";
  $("rating-engine").textContent = t("下載中");
  try {
    sources = [await fetchSource($("rating-suno-url").value.trim(), "音樂")];
    showSingleSource(sources[0]);
    $("rating-status").textContent = t("歌曲已準備完成，可以開始評分。");
    $("rating-engine").className = "rating-engine ready";
    $("rating-engine").textContent = t("準備完成");
  } catch (error) {
    clearSources();
    setError(error?.message || t("目前無法取得這首 Suno 音樂。"));
    $("rating-status").textContent = t("請確認分享連結可公開播放後再試一次。");
  } finally {
    fetching = false;
    $("rating-fetch").textContent = t("取得音樂");
    $("rating-progress").hidden = true;
    updateControls();
  }
}

async function fetchComparison(event) {
  event.preventDefault();
  if (busy || fetching) return;
  clearSources();
  setError();
  fetching = true;
  updateControls();
  $("rating-fetch-compare").textContent = t("正在取得…");
  $("rating-progress").hidden = false;
  $("rating-progress").value = 0;
  $("rating-engine").className = "rating-engine";
  $("rating-engine").textContent = t("下載中");
  try {
    const first = await fetchSource($("rating-suno-url-a").value.trim(), "歌曲 A", 0, 0.5);
    sources.push(first);
    showCompareSource(first, 0);
    const second = await fetchSource($("rating-suno-url-b").value.trim(), "歌曲 B", 50, 0.5);
    sources.push(second);
    showCompareSource(second, 1);
    $("rating-compare-files").hidden = false;
    $("rating-status").textContent = t("兩首音樂已準備完成，可以開始比較。");
    $("rating-engine").className = "rating-engine ready";
    $("rating-engine").textContent = t("準備完成");
  } catch (error) {
    clearSources();
    setError(error?.message || t("目前無法取得其中一首 Suno 音樂。"));
    $("rating-status").textContent = t("請確認兩個分享連結都可公開播放。");
  } finally {
    fetching = false;
    $("rating-fetch-compare").textContent = t("取得兩首音樂");
    $("rating-progress").hidden = true;
    updateControls();
  }
}

function metricCard(metric) {
  const article = document.createElement("article");
  article.className = "rating-metric";
  const heading = document.createElement("div");
  heading.className = "rating-metric-heading";
  const label = document.createElement("span");
  label.textContent = t(metric.label);
  const score = document.createElement("strong");
  score.textContent = metric.score.toFixed(0);
  heading.append(label, score);
  const meter = document.createElement("div");
  meter.className = "rating-meter";
  const fill = document.createElement("i");
  fill.style.width = `${metric.score}%`;
  meter.append(fill);
  const description = document.createElement("small");
  description.textContent = t(metric.description);
  article.append(heading, meter, description);
  return article;
}

function renderSingle(raw) {
  const result = presentRating(raw);
  $("rating-total").textContent = String(Math.round(result.overall));
  $("rating-verdict").textContent = t(ratingVerdict(result.overall));
  $("rating-streams").textContent = result.streams.toFixed(1);
  $("rating-likes").textContent = result.likes.toFixed(1);
  $("rating-metrics").replaceChildren(...result.metrics.map(metricCard));
  $("rating-results").hidden = false;
  $("rating-results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function comparisonSong(result, source, index, winner) {
  const article = document.createElement("article");
  article.className = `comparison-song${winner === index ? " winner" : ""}`;
  const heading = document.createElement("div");
  heading.className = "comparison-song-heading";
  const title = document.createElement("div");
  const marker = document.createElement("span");
  marker.textContent = t(`歌曲 ${index === 0 ? "A" : "B"}`);
  const name = document.createElement("h3");
  name.setAttribute("data-i18n-ignore", "");
  name.textContent = source.metadata.title || marker.textContent;
  title.append(marker, name);
  const total = document.createElement("strong");
  total.textContent = Math.round(result.overall);
  heading.append(title, total);
  const sorted = [...result.metrics].sort((a, b) => b.score - a.score);
  const notes = document.createElement("div");
  notes.className = "comparison-strengths";
  for (const [label, metrics] of [["優勢", sorted.slice(0, 2)], ["可改善", sorted.slice(-2).reverse()]]) {
    const block = document.createElement("div");
    const strong = document.createElement("b");
    strong.textContent = t(label);
    const text = document.createElement("p");
    text.textContent = metrics.map(metric => `${t(metric.label)} ${Math.round(metric.score)}`).join(" · ");
    block.append(strong, text);
    notes.append(block);
  }
  const popularity = document.createElement("p");
  popularity.className = "comparison-popularity";
  popularity.textContent = t("串流吸引力 {0} · 按讚傾向 {1}", result.streams.toFixed(1), result.likes.toFixed(1));
  article.append(heading, notes, popularity);
  return article;
}

function renderComparison(rawResults) {
  const results = rawResults.map(presentRating);
  const difference = results[0].overall - results[1].overall;
  const winner = Math.abs(difference) < 0.5 ? -1 : difference > 0 ? 0 : 1;
  $("comparison-winner-mark").textContent = winner < 0 ? "＝" : winner === 0 ? "A" : "B";
  $("comparison-winner").textContent = winner < 0 ? t("兩首歌的綜合表現相近") : t("歌曲 {0} 綜合表現較突出", winner === 0 ? "A" : "B");
  $("comparison-summary-text").textContent = winner < 0
    ? t("兩首歌曲的綜合美學分數差距不到 0.5 分，請參考各項指標判斷風格取向。")
    : t("綜合美學分數相差 {0} 分；下方列出每個面向的相對表現。", Math.abs(difference).toFixed(1));
  $("comparison-songs").replaceChildren(...results.map((result, index) => comparisonSong(result, sources[index], index, winner)));
  $("comparison-breakdown").replaceChildren(...results[0].metrics.map((metric, index) => {
    const other = results[1].metrics[index];
    const row = document.createElement("div");
    row.className = "comparison-row";
    const a = document.createElement("strong");
    a.textContent = metric.score.toFixed(0);
    const barA = document.createElement("div");
    barA.className = "comparison-bar bar-a";
    const fillA = document.createElement("i");
    fillA.style.width = `${metric.score}%`;
    barA.append(fillA);
    const label = document.createElement("span");
    const delta = metric.score - other.score;
    label.textContent = `${t(metric.label)}${Math.abs(delta) >= 0.5 ? ` · ${delta > 0 ? "A" : "B"} +${Math.abs(delta).toFixed(0)}` : ` · ${t("相近")}`}`;
    const barB = document.createElement("div");
    barB.className = "comparison-bar";
    const fillB = document.createElement("i");
    fillB.style.width = `${other.score}%`;
    barB.append(fillB);
    const b = document.createElement("strong");
    b.textContent = other.score.toFixed(0);
    row.append(a, barA, label, barB, b);
    return row;
  }));
  $("rating-comparison").hidden = false;
  $("rating-comparison").scrollIntoView({ behavior: "smooth", block: "start" });
}

function analyzeAudio(audio, index, total) {
  return new Promise((resolve, reject) => {
    pendingReject = reject;
    worker.onmessage = event => {
      const data = event.data || {};
      const label = total > 1 ? `${t(`歌曲 ${index === 0 ? "A" : "B"}`)}： ` : "";
      if (data.type === "status") {
        $("rating-status").textContent = `${label}${t(data.text)}`;
        if (data.provider) $("rating-engine").textContent = t("WASM CPU · {0} 執行緒", data.threads);
      } else if (data.type === "progress") {
        $("rating-progress").value = (index + data.value / 100) / total * 100;
        $("rating-status").textContent = `${label}${t("正在分析 {0}／{1} 個音樂片段…", data.current, data.total)}`;
      } else if (data.type === "result") {
        pendingReject = null;
        resolve(data);
      } else if (data.type === "cancelled") {
        pendingReject = null;
        reject(Object.assign(Error(t("歌曲評分已取消。")), { code: "CANCELLED" }));
      } else if (data.type === "error") {
        pendingReject = null;
        reject(Error(t(data.message || "歌曲評分失敗。")));
      }
    };
    worker.onerror = event => {
      pendingReject = null;
      reject(Object.assign(Error(t(event.message || "歌曲評分工作程序發生錯誤。")), { code: "WORKER_CRASH" }));
    };
    const transferableAudio = audio.slice();
    worker.postMessage({ type: "analyze", audio: transferableAudio }, [transferableAudio.buffer]);
  });
}

function createRatingWorker(threadLimit) {
  const workerUrl = new URL("./music-rating-worker.js", import.meta.url);
  workerUrl.searchParams.set("threads", String(threadLimit));
  return new Worker(workerUrl, { type: "module" });
}

async function startRating() {
  const targets = mode === "single" ? sources.slice(0, 1) : sources.slice(0, 2);
  if (busy || targets.some(source => !source)) return;
  setError();
  busy = true;
  cancelled = false;
  updateControls();
  $("rating-results").hidden = true;
  $("rating-comparison").hidden = true;
  $("rating-progress").hidden = false;
  $("rating-progress").value = 0;
  $("rating-engine").className = "rating-engine";
  $("rating-engine").textContent = t("分析中");
  const threadFallbacks = globalThis.crossOriginIsolated ? WASM_THREAD_FALLBACKS : [1];
  let threadFallbackIndex = 0;
  worker = createRatingWorker(threadFallbacks[threadFallbackIndex]);
  try {
    const rawResults = [];
    for (let index = 0; index < targets.length; index++) {
      $("rating-status").textContent = targets.length > 1
        ? t("正在準備歌曲 {0}的 16 kHz 單聲道音訊…", index === 0 ? "A" : "B")
        : t("正在準備音樂的 16 kHz 單聲道音訊…");
      const audio = await resampleMono(targets[index].buffer);
      if (cancelled) throw Object.assign(Error("歌曲評分已取消。"), { code: "CANCELLED" });
      let response;
      while (!response) {
        try {
          response = await analyzeAudio(audio, index, targets.length);
        } catch (error) {
          if (error?.code !== "WORKER_CRASH" || threadFallbackIndex >= threadFallbacks.length - 1) throw error;
          const failedThreads = threadFallbacks[threadFallbackIndex];
          threadFallbackIndex += 1;
          const nextThreads = threadFallbacks[threadFallbackIndex];
          worker?.terminate();
          worker = createRatingWorker(nextThreads);
          $("rating-engine").textContent = t("WASM CPU · 重新啟動中");
          $("rating-status").textContent = t("{0} 執行緒無法啟動，正在改用 {1} 執行緒重試…", failedThreads, nextThreads);
        }
      }
      rawResults.push(response.result);
      $("rating-engine").textContent = t("WASM CPU · {0} 執行緒", response.threads);
    }
    if (mode === "single") renderSingle(rawResults[0]);
    else renderComparison(rawResults);
    $("rating-progress").value = 100;
    $("rating-status").textContent = mode === "single" ? t("歌曲評分完成。") : t("兩首歌曲比較完成。");
    $("rating-engine").className = "rating-engine ready";
    $("rating-engine").textContent += ` ${t("評分完成")}`;
  } catch (error) {
    if (error?.code === "CANCELLED") {
      $("rating-status").textContent = t("歌曲評分已取消。");
      $("rating-engine").textContent = t("已取消");
    } else {
      setError(error?.message || t("歌曲評分失敗。"));
      $("rating-status").textContent = t("模型未能完成分析。");
    }
  } finally {
    worker?.terminate();
    worker = null;
    pendingReject = null;
    busy = false;
    $("rating-progress").hidden = true;
    updateControls();
  }
}

function cancelRating() {
  if (!busy) return;
  cancelled = true;
  worker?.postMessage({ type: "cancel" });
  worker?.terminate();
  worker = null;
  pendingReject?.(Object.assign(Error(t("歌曲評分已取消。")), { code: "CANCELLED" }));
  pendingReject = null;
}

for (const button of document.querySelectorAll("[data-rating-mode]")) button.addEventListener("click", () => selectMode(button.dataset.ratingMode));
$("rating-source-form").addEventListener("submit", fetchSingle);
$("rating-compare-form").addEventListener("submit", fetchComparison);
$("rating-start").addEventListener("click", startRating);
$("rating-cancel").addEventListener("click", cancelRating);
window.addEventListener("unload", () => {
  worker?.terminate();
  for (const source of sources) if (source?.url) URL.revokeObjectURL(source.url);
});
updateControls();
