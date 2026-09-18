import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { SCENES, drawMvScene } from "./mv-scenes.js";
import { exportFilename } from "./formats.js";
import { encodeMedia } from "./export.js";

const $ = (id) => document.getElementById(id);
const MAX_FILE_SIZE = 300 * 1024 * 1024;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const MIN_SEGMENT = 0.5;

const restored = loadSettings();
applyTheme(restored.mode, restored.theme);

let sourceName = "";
let buffer = null;
let audioEl = null;
let audioUrl = "";
let animationFrame = 0;
let controller = null;
let downloadUrl = "";
let cardSeq = 0;
let characterSeq = 0;

const canvas = $("mv-canvas");
const settings = { storyboard: [], strength: 60, darkness: 0 };
// Reference people: named, reusable across storyboard cards. Not persisted (matches the
// "temporary reference resources are not kept" rule used by the video generator's own
// per-scene references), so the list is intentionally in-memory only for this session.
let characters = [];

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

function renderFrame() {
  if (!buffer) return;
  drawMvScene(canvas, audioEl?.currentTime || 0, buffer, null, settings);
}

function tick() {
  if (!audioEl || audioEl.paused) return;
  renderFrame();
  $("mv-seek").value = String(Math.round((audioEl.currentTime / buffer.duration) * 1000) || 0);
  $("mv-time").textContent = formatTime(audioEl.currentTime);
  animationFrame = requestAnimationFrame(tick);
}

function setControlsEnabled(enabled) {
  for (const id of ["mv-add-scene", "mv-add-character", "mv-strength", "mv-darkness", "mv-aspect-ratio", "mv-resolution", "mv-fps", "mv-format", "mv-start"])
    $(id).disabled = !enabled;
  for (const card of $("mv-storyboard").children) {
    for (const control of card.querySelectorAll("select, input, button")) control.disabled = !enabled;
  }
  for (const chip of $("mv-characters").children) {
    for (const control of chip.querySelectorAll("input, button")) control.disabled = !enabled;
  }
  syncStoryboardButtons();
}

// ---- 參考人物（可重複引用於多個分鏡）----
function refreshResolvedImages() {
  for (const card of settings.storyboard)
    card.resolvedImage = card.refImage || characters.find((person) => person.id === card.characterId)?.bitmap || null;
}

function removeCharacter(id) {
  const index = characters.findIndex((person) => person.id === id);
  if (index < 0) return;
  URL.revokeObjectURL(characters[index].thumbUrl);
  characters[index].bitmap.close?.();
  characters.splice(index, 1);
  for (const card of settings.storyboard) if (card.characterId === id) card.characterId = null;
  refreshResolvedImages();
  renderCharacters();
  renderStoryboard();
  renderFrame();
}

function renderCharacters() {
  const container = $("mv-characters");
  container.textContent = "";
  characters.forEach((person) => {
    const chip = document.createElement("div");
    chip.className = "mv-character-chip";
    const thumb = document.createElement("img");
    thumb.className = "mv-character-thumb";
    thumb.src = person.thumbUrl;
    thumb.alt = "";
    const nameInput = document.createElement("input");
    nameInput.className = "mv-character-name";
    nameInput.value = person.name;
    nameInput.setAttribute("aria-label", "人物名稱");
    nameInput.addEventListener("change", () => {
      person.name = nameInput.value.trim() || "人物";
      nameInput.value = person.name;
      renderStoryboard();
    });
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "✕";
    removeButton.setAttribute("aria-label", `刪除人物 ${person.name}`);
    removeButton.addEventListener("click", () => removeCharacter(person.id));
    chip.append(thumb, nameInput, removeButton);
    container.append(chip);
  });
}

$("mv-add-character").addEventListener("click", () => $("mv-character-input").click());
$("mv-character-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    error("請選擇圖片檔案作為人物參考圖。");
    return;
  }
  if (file.size > MAX_IMAGE_SIZE) {
    error("參考圖大小不可超過 20 MB。");
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    characters.push({
      id: characterSeq++,
      name: `人物 ${characters.length + 1}`,
      bitmap,
      thumbUrl: URL.createObjectURL(file),
    });
    error();
    renderCharacters();
    renderStoryboard();
  } catch {
    error("無法讀取這張參考圖，請換一張圖片再試。");
  }
});

// ---- 分鏡（storyboard）----
// 比照影片生成的分鏡卡片：依時間軸依序排列，每張卡片各自選擇動畫場景、顏色，
// 並可引用參考人物或上傳專屬參考圖；匯出時 drawMvScene() 會依當下時間找出對應
// 卡片再繪製，參考圖／人物則疊加成相框樣式的畫面裝飾。
function resetStoryboard(duration) {
  for (const card of settings.storyboard) if (card.refImageThumbUrl) URL.revokeObjectURL(card.refImageThumbUrl);
  cardSeq = 0;
  settings.storyboard = [{
    id: cardSeq++,
    scene: 0,
    color: "#7ee0ff",
    start: 0,
    end: duration,
    characterId: null,
    refImage: null,
    refImageThumbUrl: "",
  }];
  refreshResolvedImages();
  renderStoryboard();
}

function clampStoryboardToDuration(duration) {
  for (const card of settings.storyboard) {
    card.start = Math.max(0, Math.min(card.start, duration));
    card.end = Math.max(card.start + MIN_SEGMENT, Math.min(card.end, duration));
  }
  const last = settings.storyboard[settings.storyboard.length - 1];
  if (last) last.end = duration;
}

function syncStoryboardButtons() {
  const cards = [...$("mv-storyboard").children];
  cards.forEach((card, index) => {
    const disabled = !buffer || Boolean(controller);
    card.querySelector(".mv-move-up").disabled = disabled || index === 0;
    card.querySelector(".mv-move-down").disabled = disabled || index === cards.length - 1;
    card.querySelector(".mv-remove").disabled = disabled || cards.length <= 1;
  });
}

function renderStoryboard() {
  const container = $("mv-storyboard");
  container.textContent = "";
  settings.storyboard.forEach((card, index) => {
    const el = document.createElement("div");
    el.className = "mv-scene-card";

    const head = document.createElement("div");
    head.className = "mv-scene-card-head";
    const title = document.createElement("strong");
    title.textContent = `分鏡 ${String(index + 1).padStart(2, "0")}`;
    const actions = document.createElement("div");
    actions.className = "mv-scene-card-actions";
    const upButton = document.createElement("button");
    upButton.type = "button";
    upButton.className = "mv-move-up";
    upButton.textContent = "↑";
    upButton.setAttribute("aria-label", "上移分鏡");
    upButton.addEventListener("click", () => moveCard(card.id, -1));
    const downButton = document.createElement("button");
    downButton.type = "button";
    downButton.className = "mv-move-down";
    downButton.textContent = "↓";
    downButton.setAttribute("aria-label", "下移分鏡");
    downButton.addEventListener("click", () => moveCard(card.id, 1));
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "mv-remove";
    removeButton.textContent = "✕";
    removeButton.setAttribute("aria-label", "刪除分鏡");
    removeButton.addEventListener("click", () => removeCard(card.id));
    actions.append(upButton, downButton, removeButton);
    head.append(title, actions);

    const row = document.createElement("div");
    row.className = "mv-scene-card-row";

    const sceneSelect = document.createElement("select");
    sceneSelect.className = "setting-select";
    sceneSelect.setAttribute("aria-label", "動畫場景");
    SCENES.forEach((label, sceneIndex) => {
      const option = document.createElement("option");
      option.value = String(sceneIndex);
      option.textContent = label;
      if (sceneIndex === card.scene) option.selected = true;
      sceneSelect.append(option);
    });
    sceneSelect.addEventListener("change", () => {
      card.scene = Number(sceneSelect.value);
      renderFrame();
    });

    const colorWrap = document.createElement("div");
    colorWrap.className = "color-picker";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = card.color;
    colorInput.setAttribute("aria-label", "分鏡顏色");
    colorInput.addEventListener("input", () => {
      card.color = colorInput.value;
      renderFrame();
    });
    colorWrap.append(colorInput);

    const startField = document.createElement("div");
    startField.className = "mv-scene-card-time";
    const startLabel = document.createElement("label");
    startLabel.textContent = "開始（秒）";
    const startInput = document.createElement("input");
    startInput.type = "number";
    startInput.min = "0";
    startInput.step = "0.1";
    startInput.value = card.start.toFixed(1);
    startLabel.append(startInput);
    startField.append(startLabel);

    const endField = document.createElement("div");
    endField.className = "mv-scene-card-time";
    const endLabel = document.createElement("label");
    endLabel.textContent = "結束（秒）";
    const endInput = document.createElement("input");
    endInput.type = "number";
    endInput.min = "0";
    endInput.step = "0.1";
    endInput.value = card.end.toFixed(1);
    endLabel.append(endInput);
    endField.append(endLabel);

    const commitTimes = () => {
      const duration = buffer?.duration ?? 0;
      let start = Math.max(0, Math.min(Number(startInput.value) || 0, duration));
      let end = Math.max(0, Math.min(Number(endInput.value) || 0, duration));
      if (end - start < MIN_SEGMENT) end = Math.min(duration, start + MIN_SEGMENT);
      card.start = start;
      card.end = end;
      startInput.value = start.toFixed(1);
      endInput.value = end.toFixed(1);
      renderFrame();
    };
    startInput.addEventListener("change", commitTimes);
    endInput.addEventListener("change", commitTimes);

    row.append(sceneSelect, colorWrap, startField, endField);

    // 參考圖／參考人物：兩者皆可設定，drawMvScene 依 resolvedImage 優先使用分鏡自己
    // 上傳的參考圖，否則退回引用的人物參考圖。
    const refRow = document.createElement("div");
    refRow.className = "mv-scene-card-ref-row";

    const characterSelect = document.createElement("select");
    characterSelect.className = "setting-select";
    characterSelect.setAttribute("aria-label", "引用人物");
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "引用人物：無";
    characterSelect.append(noneOption);
    characters.forEach((person) => {
      const option = document.createElement("option");
      option.value = String(person.id);
      option.textContent = person.name;
      if (person.id === card.characterId) option.selected = true;
      characterSelect.append(option);
    });
    characterSelect.addEventListener("change", () => {
      card.characterId = characterSelect.value === "" ? null : Number(characterSelect.value);
      refreshResolvedImages();
      renderFrame();
    });

    const imageWrap = document.createElement("div");
    imageWrap.className = "mv-scene-card-ref-image";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        error("請選擇圖片檔案作為參考圖。");
        return;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        error("參考圖大小不可超過 20 MB。");
        return;
      }
      try {
        const bitmap = await createImageBitmap(file);
        if (card.refImageThumbUrl) URL.revokeObjectURL(card.refImageThumbUrl);
        card.refImage?.close?.();
        card.refImage = bitmap;
        card.refImageThumbUrl = URL.createObjectURL(file);
        error();
        refreshResolvedImages();
        renderStoryboard();
        renderFrame();
      } catch {
        error("無法讀取這張參考圖，請換一張圖片再試。");
      }
    });
    if (card.refImage) {
      const thumb = document.createElement("img");
      thumb.className = "mv-scene-card-ref-thumb";
      thumb.src = card.refImageThumbUrl;
      thumb.alt = "";
      const clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.textContent = "移除參考圖";
      clearButton.addEventListener("click", () => {
        URL.revokeObjectURL(card.refImageThumbUrl);
        card.refImage.close?.();
        card.refImage = null;
        card.refImageThumbUrl = "";
        refreshResolvedImages();
        renderStoryboard();
        renderFrame();
      });
      imageWrap.append(thumb, clearButton);
    } else {
      const uploadButton = document.createElement("button");
      uploadButton.type = "button";
      uploadButton.textContent = "上傳參考圖";
      uploadButton.addEventListener("click", () => fileInput.click());
      imageWrap.append(uploadButton);
    }
    imageWrap.append(fileInput);

    refRow.append(characterSelect, imageWrap);

    el.append(head, row, refRow);
    el.id = `mv-card-${card.id}`;
    container.append(el);
  });
  syncStoryboardButtons();
}

function moveCard(id, direction) {
  const index = settings.storyboard.findIndex((card) => card.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= settings.storyboard.length) return;
  [settings.storyboard[index], settings.storyboard[target]] = [settings.storyboard[target], settings.storyboard[index]];
  renderStoryboard();
  renderFrame();
}

function removeCard(id) {
  if (settings.storyboard.length <= 1) return;
  const removed = settings.storyboard.find((card) => card.id === id);
  if (removed?.refImageThumbUrl) URL.revokeObjectURL(removed.refImageThumbUrl);
  removed?.refImage?.close?.();
  settings.storyboard = settings.storyboard.filter((card) => card.id !== id);
  clampStoryboardToDuration(buffer?.duration ?? 0);
  renderStoryboard();
  renderFrame();
}

$("mv-add-scene").addEventListener("click", () => {
  if (!buffer) return;
  const duration = buffer.duration;
  const last = settings.storyboard[settings.storyboard.length - 1];
  const start = last ? last.end : 0;
  if (duration - start < MIN_SEGMENT) {
    error(`剩餘時間不足 ${MIN_SEGMENT} 秒，無法再新增分鏡。`);
    return;
  }
  error();
  const end = Math.min(duration, start + Math.min(4, duration - start));
  settings.storyboard.push({
    id: cardSeq++,
    scene: settings.storyboard.length % SCENES.length,
    color: "#7ee0ff",
    start,
    end,
    characterId: null,
    refImage: null,
    refImageThumbUrl: "",
  });
  renderStoryboard();
  renderFrame();
});

// ---- 音樂載入與播放預覽 ----
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
    resetStoryboard(decoded.duration);
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
  clampStoryboardToDuration(buffer.duration);
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
      drawFrame: drawMvScene,
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
  for (const card of settings.storyboard) if (card.refImageThumbUrl) URL.revokeObjectURL(card.refImageThumbUrl);
  for (const person of characters) URL.revokeObjectURL(person.thumbUrl);
});

$("mv-strength-output").textContent = String(settings.strength);
$("mv-darkness-output").textContent = String(settings.darkness);
