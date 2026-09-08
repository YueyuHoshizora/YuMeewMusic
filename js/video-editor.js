import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { loadStoredMedia, unpackStoredMedia } from "./media-store.js";
import { parseSubtitles } from "./subtitles.js";
import { draw, drawIdentity, drawSubtitles } from "./visualizer.js";
import { audioEncodingOptions, scalePcmSamples } from "./export.js";
import { chooseVideoAcceleration } from "./video-acceleration.js";
import { videoDimensions } from "./dimensions.js";
import { drawLayerWithEffect } from "./video-effects.js";
import { moveTrimRange } from "./trim-range.js";
import { formatTrimTime, parseTrimTime } from "./trim-time.js";
import {
  clampLayerTiming,
  formatEditorTime,
  isLayerActive,
  layerEnd,
  projectDuration,
  projectTrimRange,
  nudgeLayerTime,
} from "./video-editor-core.js";

const $ = id => document.getElementById(id);
const settings = loadSettings();
applyTheme(settings.mode, settings.theme);

const state = {
  layers: [],
  selectedId: null,
  time: 0,
  playing: false,
  clockStart: 0,
  subtitles: null,
  identityImage: null,
  exporting: false,
  exportController: null,
  trimStart: 0,
  trimEnd: null,
  trimInputsReady: false,
  trimInputsFollowDuration: true,
  base: { audioBuffer: null, audioElement: null, audioUrl: "", image: null, imageUrl: "", duration: 0 },
};
let nextId = 1;

function status(text, mode = "") {
  $("editor-status").textContent = text;
  $("editor-status").className = `editor-status ${mode}`.trim();
}

function selectedLayer() {
  return state.layers.find(layer => layer.id === state.selectedId) || null;
}

function setCanvasSize() {
  const portrait = settings.aspectRatio === "9:16";
  const canvas = $("video-preview");
  canvas.width = portrait ? 720 : 1280;
  canvas.height = portrait ? 1280 : 720;
  $("preview-size").textContent = settings.aspectRatio;
}

function drawOverlays(context, time) {
  const overlaySettings = {
    ...settings,
    subtitles: state.subtitles,
    identityImage: state.identityImage,
    originalBuffer: state.base.audioBuffer || { duration: timelineDuration() },
    buffer: state.base.audioBuffer || { duration: timelineDuration() },
  };
  drawSubtitles(context, context.canvas.width, context.canvas.height, overlaySettings, time);
  drawIdentity(context, context.canvas.width, context.canvas.height, overlaySettings);
}

function timelineDuration() {
  return projectDuration(state.layers, state.base.duration);
}

function activeProjectRange() {
  return projectTrimRange(timelineDuration(), state.trimStart, state.trimEnd);
}

function hasProject() {
  return state.layers.length > 0 || Boolean(state.base.audioBuffer);
}

function setTrimInputs(start, end) {
  state.trimInputsReady = true;
  state.trimInputsFollowDuration = false;
  for (const [edge, value] of [["start", start], ["end", end]]) {
    $(`trim-${edge}`).value = formatTrimTime(value);
    $(`trim-${edge}-range`).value = value;
  }
  updateTrimMarkers();
  $("trim-info").textContent = `選取 ${formatTrimTime(end - start)}，放開後自動套用`;
}

function updateTrimMarkers() {
  const duration = timelineDuration();
  const start = parseTrimTime($("trim-start").value);
  const end = parseTrimTime($("trim-end").value);
  const valid = hasProject() && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= duration + .005;
  $("trim-markers").hidden = !valid;
  if (!valid) return;
  $("trim-selection").style.left = `${start / duration * 100}%`;
  $("trim-selection").style.width = `${(Math.min(end, duration) - start) / duration * 100}%`;
  $("trim-selection-duration").textContent = formatTrimTime(Math.min(end, duration) - start);
  $("trim-drag-body").setAttribute("aria-label", `拖曳平移裁剪範圍，長度 ${formatTrimTime(Math.min(end, duration) - start)}`);
  $("trim-start-label").textContent = `開始 ${formatTrimTime(start)}`;
  $("trim-end-label").textContent = `結束 ${formatTrimTime(end)}`;
}

function updateTrimControls() {
  const available = hasProject();
  const duration = timelineDuration();
  $("trim-empty").hidden = available;
  for (const edge of ["start", "end"]) {
    $(`trim-${edge}-range`).max = duration;
    for (const suffix of ["", "-range"]) $(`trim-${edge}${suffix}`).disabled = !available || state.exporting;
  }
  $("trim-apply").disabled = !available || state.exporting;
  $("trim-reset").disabled = !available || state.exporting;
  for (const mode of ["start", "body", "end"]) $(`trim-drag-${mode}`).disabled = !available || state.exporting;
  if (available && (!state.trimInputsReady || state.trimInputsFollowDuration)) {
    state.trimInputsReady = true;
    state.trimInputsFollowDuration = true;
    $("trim-start").value = formatTrimTime(0);
    $("trim-start-range").value = 0;
    $("trim-end").value = formatTrimTime(duration);
    $("trim-end-range").value = duration;
    if (!$("trim-info").textContent) $("trim-info").textContent = `完整影片：${formatTrimTime(duration)}`;
  }
  updateTrimMarkers();
}

function applyProjectTrim() {
  if (!hasProject() || state.exporting) return false;
  const duration = timelineDuration();
  const start = parseTrimTime($("trim-start").value);
  let end = parseTrimTime($("trim-end").value);
  if ($("trim-end").value === formatTrimTime(duration)) end = duration;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration + .005) {
    $("trim-info").textContent = "請使用分：秒格式（例如 01:30.00），結束時間須大於開始時間且不可超過影片長度";
    return false;
  }
  pauseProject();
  state.trimStart = start;
  state.trimEnd = start <= .005 && Math.abs(end - duration) <= .005 ? null : end;
  state.time = start;
  $("trim-info").textContent = `已套用：${formatTrimTime(end - start)}`;
  update();
  return true;
}

function drawBase(canvas, time) {
  if (!state.base.audioBuffer) return;
  draw(canvas, time, state.base.audioBuffer, state.base.image, {
    ...settings,
    subtitles: null,
    identityText: "",
    identityImage: null,
    originalBuffer: state.base.audioBuffer,
    buffer: state.base.audioBuffer,
  });
}

function renderPreview() {
  const canvas = $("video-preview");
  const context = canvas.getContext("2d");
  context.fillStyle = "#080a0c";
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawBase(canvas, state.time);
  for (const layer of state.layers) {
    if (!isLayerActive(layer, state.time)) continue;
    if (layer.type === "image") {
      drawLayerWithEffect(context, layer, layer.element, layer.element.naturalWidth, layer.element.naturalHeight, state.time);
    } else {
      const localTime = state.time - layer.start;
      if (localTime >= layer.mediaDuration || layer.element.readyState < 2) continue;
      if (!state.playing && Math.abs(layer.element.currentTime - localTime) > 0.035) layer.element.currentTime = localTime;
      drawLayerWithEffect(context, layer, layer.element, layer.element.videoWidth, layer.element.videoHeight, state.time);
    }
  }
  drawOverlays(context, state.time);
}

function updatePlayer() {
  const duration = timelineDuration();
  const range = activeProjectRange();
  state.time = Math.max(range.start, Math.min(state.time, range.end));
  $("project-seek").min = range.start;
  $("project-seek").max = range.end;
  $("project-seek").value = state.time;
  $("current-time").textContent = formatEditorTime(state.time);
  $("total-time").textContent = formatEditorTime(range.end);
  $("playhead").style.left = `calc(78px + (100% - 84px) * ${state.time / duration})`;
  const usable = (state.layers.length > 0 || state.base.audioBuffer) && !state.exporting;
  $("play-project").disabled = !usable;
  $("project-seek").disabled = !usable;
  $("export-project").disabled = !usable;
  $("play-project").textContent = state.playing ? "❚❚" : "▶";
}

function renderTimeline() {
  const duration = timelineDuration();
  const ruler = $("timeline-ruler");
  ruler.replaceChildren();
  const ticks = Math.min(6, Math.max(2, Math.ceil(duration / 5)));
  for (let index = 0; index <= ticks; index++) {
    const tick = document.createElement("span");
    tick.className = "timeline-tick";
    tick.style.left = `${index / ticks * 100}%`;
    tick.textContent = formatEditorTime(duration * index / ticks);
    ruler.append(tick);
  }
  const tracks = $("timeline-tracks");
  tracks.replaceChildren(...[...state.layers].reverse().map(layer => {
    const track = document.createElement("div");
    track.className = "timeline-track";
    track.dataset.label = layer.name;
    const band = document.createElement("button");
    band.type = "button";
    band.className = `timeline-band${layer.id === state.selectedId ? " selected" : ""}`;
    band.style.left = `${layer.start / duration * 100}%`;
    band.style.width = `${Math.max(0.5, (layerEnd(layer) - layer.start) / duration * 100)}%`;
    band.textContent = layer.type === "video" ? `影片${layer.audio ? " ♫" : ""}` : "圖片";
    band.addEventListener("click", () => selectLayer(layer.id));
    track.append(band);
    return track;
  }));
}

function renderLayerList() {
  $("layer-list").replaceChildren(...state.layers.map((layer, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `layer-row${layer.id === state.selectedId ? " selected" : ""}`;
    row.innerHTML = `<span>${layer.type === "video" ? "▶" : "▧"}</span><div><strong></strong><small></small></div><b>${index + 1}</b>`;
    row.querySelector("strong").textContent = layer.name;
    row.querySelector("small").textContent = `${formatEditorTime(layer.start)}–${formatEditorTime(layerEnd(layer))}`;
    row.addEventListener("click", () => selectLayer(layer.id));
    return row;
  }));
  $("subtitle-layer").classList.toggle("inactive", !state.subtitles);
  const hasIdentity = settings.identityType === "image" ? Boolean(state.identityImage) : Boolean(settings.identityText);
  $("identity-layer").classList.toggle("inactive", !hasIdentity);
  $("base-layer").classList.toggle("inactive", !state.base.audioBuffer);
  $("base-layer-detail").textContent = state.base.audioBuffer
    ? `${formatEditorTime(state.base.duration)} · 固定最底層`
    : "回主畫面選擇音樂後自動帶入";
}

function renderInspector() {
  const layer = selectedLayer();
  $("empty-inspector").hidden = Boolean(layer);
  $("layer-controls").hidden = !layer;
  if (!layer) return;
  $("selected-kind").textContent = layer.type === "video" ? "影片圖層" : "圖片圖層";
  $("selected-name").textContent = layer.name;
  $("layer-start").value = layer.start.toFixed(1);
  $("video-time-controls").hidden = layer.type !== "video";
  $("image-time-controls").hidden = layer.type !== "image";
  if (layer.type === "video") {
    $("layer-end").value = layer.end.toFixed(1);
    $("layer-audio").checked = layer.audio;
  } else $("layer-duration").value = layer.duration.toFixed(1);
  for (const phase of ["enter", "exit"]) {
    const effect = layer[`${phase}Effect`] || "none";
    $(`${phase}-effect`).value = effect;
    $(`${phase}-duration`).value = Number(layer[`${phase}Duration`] || 1).toFixed(1);
    $(`${phase}-duration`).disabled = effect === "none";
  }
  const index = state.layers.indexOf(layer);
  $("move-layer-down").disabled = index === 0;
  $("move-layer-up").disabled = index === state.layers.length - 1;
}

function update() {
  renderLayerList();
  renderInspector();
  renderTimeline();
  updateTrimControls();
  updatePlayer();
  renderPreview();
}

function selectLayer(id) {
  state.selectedId = id;
  update();
}

function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    video.muted = true;
    video.src = url;
    video.onseeked = renderPreview;
    video.onloadedmetadata = () => resolve({ url, video });
    video.onerror = () => { URL.revokeObjectURL(url); reject(Error(`${file.name} 無法載入。`)); };
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ url, image });
    image.onerror = () => { URL.revokeObjectURL(url); reject(Error(`${file.name} 無法載入。`)); };
    image.src = url;
  });
}

async function addFiles(files, type) {
  $("file-error").hidden = true;
  for (const file of files) {
    try {
      if (file.size > 1024 ** 3) throw Error(`${file.name} 超過 1 GB。`);
      const start = state.time;
      if (type === "video") {
        const { url, video } = await loadVideo(file);
        const duration = Math.max(0.1, Number.isFinite(video.duration) ? video.duration : 5);
        state.layers.push({ id: nextId++, type, name: file.name, file, url, element: video, start, end: start + duration, mediaDuration: duration, audio: false, enterEffect: "none", exitEffect: "none", enterDuration: 1, exitDuration: 1 });
      } else {
        const { url, image } = await loadImage(file);
        state.layers.push({ id: nextId++, type, name: file.name, file, url, element: image, start, duration: 5, enterEffect: "none", exitEffect: "none", enterDuration: 1, exitDuration: 1 });
      }
      state.selectedId = state.layers.at(-1).id;
      status(`已加入${type === "video" ? "影片" : "圖片"}：${file.name}`, "success");
    } catch (error) {
      $("file-error").textContent = error.message;
      $("file-error").hidden = false;
      status(error.message, "error");
    }
  }
  update();
}

function patchSelected(patch) {
  const index = state.layers.findIndex(layer => layer.id === state.selectedId);
  if (index < 0) return;
  state.layers[index] = clampLayerTiming(state.layers[index], patch);
  update();
}

function nudgeSelectedTime(field, delta) {
  const index = state.layers.findIndex(layer => layer.id === state.selectedId);
  if (index < 0) return;
  state.layers[index] = nudgeLayerTime(state.layers[index], field, delta);
  update();
}

function seekFromTimeline(event) {
  const timeline = $("timeline");
  const rect = timeline.getBoundingClientRect();
  const left = rect.left + 78;
  const width = Math.max(1, rect.width - 84);
  pauseProject();
  setProjectTime((event.clientX - left) / width * timelineDuration());
}

function setProjectTime(time) {
  const range = activeProjectRange();
  state.time = Math.max(range.start, Math.min(range.end, Number(time) || 0));
  if (state.base.audioElement) {
    state.base.audioElement.pause();
    state.base.audioElement.currentTime = Math.min(state.time, state.base.duration);
  }
  for (const layer of state.layers.filter(layer => layer.type === "video")) {
    layer.element.pause();
    const local = state.time - layer.start;
    if (local >= 0 && local < layer.mediaDuration) layer.element.currentTime = local;
  }
  updatePlayer();
  renderPreview();
}

function pauseProject() {
  state.playing = false;
  state.base.audioElement?.pause();
  for (const layer of state.layers.filter(layer => layer.type === "video")) layer.element.pause();
  updatePlayer();
}

function syncPreviewVideos() {
  if (state.base.audioElement) {
    if (state.time < state.base.duration) {
      if (Math.abs(state.base.audioElement.currentTime - state.time) > .2) state.base.audioElement.currentTime = state.time;
      if (state.base.audioElement.paused) void state.base.audioElement.play().catch(() => {});
    } else state.base.audioElement.pause();
  }
  for (const layer of state.layers.filter(layer => layer.type === "video")) {
    const local = state.time - layer.start;
    const active = isLayerActive(layer, state.time) && local < layer.mediaDuration;
    if (!active) { layer.element.pause(); continue; }
    layer.element.muted = !layer.audio;
    if (Math.abs(layer.element.currentTime - local) > .2) layer.element.currentTime = local;
    if (layer.element.paused) void layer.element.play().catch(() => {});
  }
}

function animationFrame(now) {
  if (state.playing) {
    const range = activeProjectRange();
    state.time = range.start + (now - state.clockStart) / 1000;
    if (state.time >= range.end) {
      state.time = range.end;
      pauseProject();
    } else syncPreviewVideos();
    updatePlayer();
    renderPreview();
  }
  requestAnimationFrame(animationFrame);
}

async function restoreFixedLayers() {
  try {
    const stored = await loadStoredMedia("subtitle");
    if (stored) {
      const file = unpackStoredMedia(stored);
      const extension = file.name.split(".").pop()?.toLowerCase() || "srt";
      state.subtitles = parseSubtitles(await file.text(), extension);
    }
  } catch (error) { status(`字幕無法帶入：${error.message}`, "error"); }
  if (settings.identityType === "image" && settings.identityData) {
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = settings.identityData; });
      state.identityImage = image;
    } catch { status("個人識別圖片無法帶入。", "error"); }
  }
  try {
    const [storedAudio, storedImage] = await Promise.all([loadStoredMedia("audio"), loadStoredMedia("image")]);
    if (storedAudio) {
      const file = unpackStoredMedia(storedAudio);
      const decoder = new AudioContext();
      try { state.base.audioBuffer = await decoder.decodeAudioData(await file.arrayBuffer()); }
      finally { await decoder.close(); }
      state.base.duration = state.base.audioBuffer.duration;
      state.base.audioUrl = URL.createObjectURL(file);
      state.base.audioElement = new Audio(state.base.audioUrl);
      state.base.audioElement.preload = "auto";
    }
    if (storedImage) {
      const file = unpackStoredMedia(storedImage);
      const loaded = await loadImage(file);
      state.base.image = loaded.image;
      state.base.imageUrl = loaded.url;
    }
  } catch (error) { status(`主畫面影片本體無法帶入：${error.message}`, "error"); }
  update();
}

async function createVideoDecoders(m, layers) {
  const decoders = new Map();
  for (const layer of layers.filter(layer => layer.type === "video")) {
    const input = new m.Input({ source: new m.BlobSource(layer.file), formats: m.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) { input.dispose(); throw Error(`${layer.name} 的影片編碼無法解碼。`); }
    decoders.set(layer.id, { input, sink: new m.VideoSampleSink(track, { hardwareAcceleration: "no-preference" }) });
  }
  return decoders;
}

async function mixProjectAudio(layers, range, signal) {
  const duration = range.duration;
  const audible = layers.filter(layer => layer.type === "video" && layer.audio);
  if (!audible.length && !state.base.audioBuffer) return null;
  const sampleRate = 48000;
  const context = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const decoder = new AudioContext();
  try {
    if (state.base.audioBuffer) {
      const baseSource = context.createBufferSource();
      baseSource.buffer = state.base.audioBuffer;
      baseSource.connect(context.destination);
      const available = Math.max(0, Math.min(state.base.duration, range.end) - range.start);
      if (available > 0) baseSource.start(0, range.start, available);
    }
    for (const layer of audible) {
      if (signal.aborted) throw Error("已取消匯出。");
      let decoded;
      try { decoded = await decoder.decodeAudioData(await layer.file.arrayBuffer()); }
      catch { throw Error(`${layer.name} 的音訊無法解碼，請關閉這個圖層的音訊後再試。`); }
      const source = context.createBufferSource();
      source.buffer = decoded;
      source.connect(context.destination);
      const overlapStart = Math.max(range.start, layer.start);
      const overlapEnd = Math.min(range.end, layerEnd(layer), layer.start + decoded.duration);
      if (overlapEnd > overlapStart) source.start(overlapStart - range.start, overlapStart - layer.start, overlapEnd - overlapStart);
    }
  } finally {
    await decoder.close();
  }
  return context.startRendering();
}

async function exportProject() {
  if ((!state.layers.length && !state.base.audioBuffer) || state.exporting) return;
  pauseProject();
  state.exporting = true;
  state.exportController = new AbortController();
  const signal = state.exportController.signal;
  $("editor-progress").hidden = false;
  $("cancel-export").hidden = false;
  $("editor-progress").value = 0;
  updatePlayer();
  const decoders = new Map();
  let output;
  try {
    const m = await import("../vendor/mediabunny.min.mjs");
    const format = $("editor-format").value;
    const fps = Number($("editor-fps").value);
    const dimensions = videoDimensions($("editor-resolution").value, settings.aspectRatio);
    const range = activeProjectRange();
    const duration = range.duration;
    const count = Math.ceil(duration * fps);
    const bitrate = dimensions.height >= 1080 || dimensions.width >= 1080 ? 8_000_000 : dimensions.height >= 720 || dimensions.width >= 720 ? 4_000_000 : 2_000_000;
    const codec = format === "webm" ? "vp9" : "avc";
    const audioCodec = format === "webm" ? "opus" : "aac";
    const hardwareAcceleration = await chooseVideoAcceleration(m.canEncodeVideo, { ...dimensions, bitrate, framerate: fps }, signal, codec);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    const target = new m.BufferTarget();
    output = new m.Output({ format: format === "webm" ? new m.WebMOutputFormat() : new m.Mp4OutputFormat(), target });
    const videoSource = new m.CanvasSource(canvas, { codec, bitrate, hardwareAcceleration });
    output.addVideoTrack(videoSource, { frameRate: fps });
    const mixedAudio = await mixProjectAudio(state.layers, range, signal);
    const audioSource = mixedAudio ? new m.AudioBufferSource({ codec: audioCodec, ...audioEncodingOptions(audioCodec, m.Quality) }) : null;
    if (audioSource) output.addAudioTrack(audioSource);
    const created = await createVideoDecoders(m, state.layers);
    for (const [id, value] of created) decoders.set(id, value);
    const iterators = new Map();
    for (const layer of state.layers.filter(layer => layer.type === "video")) {
      const timestamps = [];
      for (let index = 0; index < count; index++) {
        const sourceTime = range.start + index / fps;
        const local = sourceTime - layer.start;
        if (local >= 0 && sourceTime < layerEnd(layer) && local < layer.mediaDuration) timestamps.push(local);
      }
      iterators.set(layer.id, decoders.get(layer.id).sink.samplesAtTimestamps(timestamps)[Symbol.asyncIterator]());
    }
    await output.start();
    let audioOffset = 0;
    for (let index = 0; index < count; index++) {
      if (signal.aborted) throw Error("已取消匯出。");
      const time = index / fps;
      const sourceTime = range.start + time;
      context.fillStyle = "#080a0c";
      context.fillRect(0, 0, canvas.width, canvas.height);
      drawBase(canvas, sourceTime);
      for (const layer of state.layers) {
        if (!isLayerActive(layer, sourceTime)) continue;
        if (layer.type === "image") drawLayerWithEffect(context, layer, layer.element, layer.element.naturalWidth, layer.element.naturalHeight, sourceTime);
        else if (sourceTime - layer.start < layer.mediaDuration) {
          const { value: sample } = await iterators.get(layer.id).next();
          if (sample) {
            drawLayerWithEffect(context, layer, sample, sample.displayWidth, sample.displayHeight, sourceTime);
            sample.close();
          }
        }
      }
      drawOverlays(context, sourceTime);
      await videoSource.add(time, Math.min(1 / fps, duration - time));
      if (audioSource && (index % fps === 0 || index === count - 1)) {
        const length = Math.min(mixedAudio.sampleRate, mixedAudio.length - audioOffset);
        if (length > 0) {
          const part = new AudioBuffer({ length, numberOfChannels: mixedAudio.numberOfChannels, sampleRate: mixedAudio.sampleRate });
          for (let channel = 0; channel < mixedAudio.numberOfChannels; channel++) part.copyToChannel(scalePcmSamples(mixedAudio.getChannelData(channel).subarray(audioOffset, audioOffset + length), 100), channel);
          await audioSource.add(part);
          audioOffset += length;
        }
      }
      if (index % 5 === 0) {
        const progress = Math.round(index / count * 98);
        $("editor-progress").value = progress;
        status(`正在匯出 ${progress}% · ${hardwareAcceleration === "prefer-hardware" ? "硬體編碼優先" : "瀏覽器編碼"}`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    videoSource.close();
    audioSource?.close();
    await output.finalize();
    const blob = new Blob([target.buffer], { type: format === "webm" ? "video/webm" : "video/mp4" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `yumeow-video-${$("editor-resolution").value}p-${$("editor-fps").value}fps.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    $("editor-progress").value = 100;
    status("語喵影片匯出完成，下載已開始。", "success");
  } catch (error) {
    if (output && !["finalized", "canceled"].includes(output.state)) await output.cancel().catch(() => {});
    status(error.message || "影片匯出失敗。", "error");
  } finally {
    for (const { input } of decoders.values()) input.dispose();
    state.exporting = false;
    state.exportController = null;
    $("cancel-export").hidden = true;
    updatePlayer();
  }
}

$("add-video").addEventListener("click", () => { $("video-input").value = ""; $("video-input").click(); });
$("add-image").addEventListener("click", () => { $("image-input").value = ""; $("image-input").click(); });
$("video-input").addEventListener("change", event => void addFiles(event.target.files || [], "video"));
$("image-input").addEventListener("change", event => void addFiles(event.target.files || [], "image"));
$("layer-start").addEventListener("input", event => patchSelected({ start: event.target.value }));
$("layer-end").addEventListener("input", event => patchSelected({ end: event.target.value }));
$("layer-duration").addEventListener("input", event => patchSelected({ duration: event.target.value }));
$("layer-audio").addEventListener("change", event => patchSelected({ audio: event.target.checked }));
for (const phase of ["enter", "exit"]) {
  $(`${phase}-effect`).addEventListener("change", event => patchSelected({ [`${phase}Effect`]: event.target.value }));
  $(`${phase}-duration`).addEventListener("input", event => patchSelected({ [`${phase}Duration`]: event.target.value }));
}
for (const button of document.querySelectorAll("[data-time-field][data-delta]")) {
  button.addEventListener("click", () => nudgeSelectedTime(button.dataset.timeField, button.dataset.delta));
}
$("remove-layer").addEventListener("click", () => {
  const index = state.layers.findIndex(layer => layer.id === state.selectedId);
  if (index < 0) return;
  const [removed] = state.layers.splice(index, 1);
  removed.element.pause?.();
  URL.revokeObjectURL(removed.url);
  state.selectedId = state.layers[Math.min(index, state.layers.length - 1)]?.id || null;
  update();
});
for (const [id, direction] of [["move-layer-up", 1], ["move-layer-down", -1]]) $(id).addEventListener("click", () => {
  const index = state.layers.findIndex(layer => layer.id === state.selectedId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.layers.length) return;
  [state.layers[index], state.layers[target]] = [state.layers[target], state.layers[index]];
  update();
});
for (const edge of ["start", "end"]) for (const suffix of ["", "-range"]) {
  $(`trim-${edge}${suffix}`).addEventListener("input", () => {
    state.trimInputsReady = true;
    state.trimInputsFollowDuration = false;
    const value = $(`trim-${edge}${suffix}`).value;
    if (suffix) $(`trim-${edge}`).value = formatTrimTime(Number(value));
    else if (Number.isFinite(parseTrimTime(value))) $(`trim-${edge}-range`).value = parseTrimTime(value);
    updateTrimMarkers();
    const length = parseTrimTime($("trim-end").value) - parseTrimTime($("trim-start").value);
    $("trim-info").textContent = length > 0
      ? `選取 ${formatTrimTime(length)}，按「套用裁剪」生效`
      : "請使用分：秒格式（例如 01:30.00），結束時間須大於開始時間";
  });
  $(`trim-${edge}${suffix}`).addEventListener("change", applyProjectTrim);
}
$("trim-apply").addEventListener("click", applyProjectTrim);
$("trim-reset").addEventListener("click", () => {
  if (!hasProject() || state.exporting) return;
  pauseProject();
  state.trimStart = 0;
  state.trimEnd = null;
  state.time = 0;
  state.trimInputsFollowDuration = false;
  $("trim-info").textContent = `已恢復完整影片：${formatTrimTime(timelineDuration())}，裁剪時間已保留`;
  update();
});
for (const mode of ["start", "body", "end"]) {
  const handle = $(`trim-drag-${mode}`);
  let drag = null;
  const locked = () => !hasProject() || state.exporting;
  handle.addEventListener("pointerdown", event => {
    if (locked() || event.button !== 0) return;
    const start = parseTrimTime($("trim-start").value);
    const end = Math.min(timelineDuration(), parseTrimTime($("trim-end").value));
    const width = $("trim-track").getBoundingClientRect().width;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || width <= 0) return;
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, start, end, width, duration: timelineDuration() };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId || locked()) return;
    const delta = (event.clientX - drag.x) / drag.width * drag.duration;
    setTrimInputs(...moveTrimRange(drag.start, drag.end, delta, drag.duration, mode));
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(type, event => {
    if (!drag || drag.id !== event.pointerId) return;
    const completed = type === "pointerup";
    drag = null;
    if (completed && !locked()) applyProjectTrim();
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  });
  let keyboardChanged = false;
  handle.addEventListener("keyup", event => {
    if (keyboardChanged && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      keyboardChanged = false;
      applyProjectTrim();
    }
  });
  handle.addEventListener("keydown", event => {
    if (locked() || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const start = parseTrimTime($("trim-start").value);
    const end = Math.min(timelineDuration(), parseTrimTime($("trim-end").value));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    keyboardChanged = true;
    const delta = (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 1 : .1);
    setTrimInputs(...moveTrimRange(start, end, delta, timelineDuration(), mode));
  });
}
$("project-seek").addEventListener("input", event => { pauseProject(); setProjectTime(event.target.value); });
$("timeline").addEventListener("pointerdown", event => {
  if (event.button !== 0 || event.target.closest(".timeline-band")) return;
  $("timeline").setPointerCapture(event.pointerId);
  $("timeline").classList.add("dragging");
  seekFromTimeline(event);
});
$("timeline").addEventListener("pointermove", event => {
  if ($("timeline").hasPointerCapture(event.pointerId)) seekFromTimeline(event);
});
for (const type of ["pointerup", "pointercancel"]) $("timeline").addEventListener(type, event => {
  if ($("timeline").hasPointerCapture(event.pointerId)) $("timeline").releasePointerCapture(event.pointerId);
  $("timeline").classList.remove("dragging");
});
$("restart-project").addEventListener("click", () => { pauseProject(); setProjectTime(activeProjectRange().start); });
$("play-project").addEventListener("click", () => {
  if (state.playing) { pauseProject(); return; }
  const range = activeProjectRange();
  if (state.time >= range.end) state.time = range.start;
  state.playing = true;
  state.clockStart = performance.now() - (state.time - range.start) * 1000;
  syncPreviewVideos();
  updatePlayer();
});
$("fullscreen-preview").addEventListener("click", () => document.fullscreenElement ? document.exitFullscreen() : $("canvas-frame").requestFullscreen());
$("export-project").addEventListener("click", () => void exportProject());
$("cancel-export").addEventListener("click", () => state.exportController?.abort());
for (const link of document.querySelectorAll("[data-confirm-return]")) {
  link.addEventListener("click", event => {
    if (!window.confirm("返回主畫面則不會保留所有修改結果，是否確定？")) event.preventDefault();
  });
}
window.addEventListener("beforeunload", () => {
  for (const layer of state.layers) URL.revokeObjectURL(layer.url);
  if (state.base.audioUrl) URL.revokeObjectURL(state.base.audioUrl);
  if (state.base.imageUrl) URL.revokeObjectURL(state.base.imageUrl);
  state.exportController?.abort();
});

setCanvasSize();
void restoreFixedLayers();
requestAnimationFrame(animationFrame);
