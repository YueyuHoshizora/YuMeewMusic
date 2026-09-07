import { moveTrimRange } from "./trim-range.js";
import { formatTrimTime, parseTrimTime } from "./trim-time.js";
import { videoDimensions } from "./dimensions.js";
import { STYLES } from "./styles.js";
import { applyTheme } from "./themes.js";
import { getFormat, exportFilename } from "./formats.js";
import { draw } from "./visualizer.js";
import { encodeMedia } from "./export.js";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, clearSettings } from "./settings.js";

const $ = (id) => document.getElementById(id);
const audio = $("audio");
const restored = loadSettings();
const state = {
  ...restored,
  buffer: null,
  originalBuffer: null,
  trimStart: 0,
  image: null,
  sleeve: null,
  record: null,
  sleeveName: "",
  recordName: "",
  name: "",
  imageName: "",
  url: "",
  busy: false,
  loading: false,
  imageLoading: false,
};
function syncSongDetails() {
  for (const id of ["songTitle", "lyricist", "composer"]) {
    state[id] = $(id).value.slice(0, 120);
  }
}
for (const id of ["songTitle", "lyricist", "composer"]) {
  $(id).value = state[id];
  const sync = () => { syncSongDetails(); persistSettings(); };
  $(id).addEventListener("input", sync);
  $(id).addEventListener("change", sync);
}
$("spectrum-color").value = state.color;
$("strength").value = state.strength;
$("darkness").value = state.darkness;
$("positionX").value = state.positionX;
$("positionY").value = state.positionY;
for (const id of ["textX", "textY", "textSize", "textFadeAfter", "textColor"]) $(id).value = state[id];
$("textColor").addEventListener("input", () => {
  state.textColor = $("textColor").value;
  $("text-color-value").textContent = state.textColor.toUpperCase();
  persistSettings();
});
$("resolution").value = restored.resolution;
$("aspect-ratio").value = restored.aspectRatio;
$("fps").value = restored.fps;
$("format").value = restored.format;
$("appearance-mode").value = restored.mode;
$("appearance-theme").value = restored.theme;
applyTheme(restored.mode, restored.theme);
for (const id of ["appearance-mode", "appearance-theme"]) {
  $(id).addEventListener("change", () => {
    state.mode = $("appearance-mode").value;
    state.theme = $("appearance-theme").value;
    applyTheme(state.mode, state.theme);
    persistSettings();
  });
}

function persistSettings() {
  saveSettings({
    songTitle: state.songTitle,
    lyricist: state.lyricist,
    composer: state.composer,
    textX: state.textX,
    textY: state.textY,
    textSize: state.textSize,
    textFadeAfter: state.textFadeAfter,
    textColor: state.textColor,
    style: state.style,
    color: state.color,
    strength: state.strength,
    darkness: state.darkness,
    positionX: state.positionX,
    positionY: state.positionY,
    resolution: $("resolution").value,
    aspectRatio: $("aspect-ratio").value,
    fps: $("fps").value,
    format: $("format").value,
    mode: state.mode,
    theme: state.theme,
  });
}

let exportController;
const styles = STYLES;
const formatTime = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function message(text = "") {
  $("message-text").textContent = text;
  $("message").hidden = !text;
}
function fileError(kind, text = "") {
  const area = $(`${kind}-drop`);
  const hint = $(`${kind}-error`);
  area.classList.toggle("load-error", Boolean(text));
  area.setAttribute("aria-invalid", String(Boolean(text)));
  hint.textContent = text ? `載入失敗：${text}` : "";
  hint.hidden = !text;
}

function update() {
  $("vinyl-assets").hidden = state.style !== 18;
  for (const [key, label] of [["sleeve", "黑膠封套"], ["record", "唱片封面"]]) {
    $(`${key}-name`).textContent = state[`${key}Name`] || `加入${label}圖片`;
    $(`remove-${key}`).hidden = !state[key];
  }
  $("textFadeAfter-value").textContent = `${state.textFadeAfter} 秒`;
  $("trim-empty").hidden = Boolean(state.originalBuffer);
  const locked = state.busy || state.loading || state.imageLoading;
  for (const mode of ["start", "body", "end"]) $(`trim-drag-${mode}`).disabled = locked || !state.originalBuffer;
  document
    .querySelectorAll(
      "#trim-start, #trim-end, #trim-start-range, #trim-end-range, #trim-apply, #trim-reset, .style-card, #songTitle, #lyricist, #composer, #textX, #textY, #textSize, #textFadeAfter, #textColor, #spectrum-color, #strength, #darkness, #positionX, #positionY, #reset-position, #reset-settings, #aspect-ratio, #resolution, #fps, #format, #restart, #remove-image, #audio-drop, #image-drop, #sleeve-drop, #record-drop, #remove-sleeve, #remove-record",
    )
    .forEach((el) => (el.disabled = locked));
  for (const id of ["trim-start", "trim-end", "trim-start-range", "trim-end-range", "trim-apply", "trim-reset"]) $(id).disabled = locked || !state.originalBuffer;
  const format = $("format").value;
  const type = getFormat(format);
  $("resolution").disabled = $("fps").disabled = locked || !type.video;
  $("format-description").textContent = type.description + (type.video ? "" : " · 不包含頻譜畫面");
  $("play").disabled = $("seek").disabled = $("export").disabled = !state.buffer || locked;
  $("audio-name").textContent = state.loading ? "正在讀取音樂…" : state.name || "選擇本機音樂";
  $("audio-info").textContent = state.buffer
    ? `${formatTime(state.buffer.duration)} · 點擊更換`
    : "拖放檔案或點擊選擇";
  $("image-name").textContent = state.imageLoading
    ? "正在讀取圖片…"
    : state.imageName || "加入背景圖片";
  $("remove-image").hidden = !state.image;
  $("duration").textContent = formatTime(state.originalBuffer?.duration || 0);
  $("seek").max = state.originalBuffer?.duration || 1;
  updateTrimMarkers();
  const aspectRatio = $("aspect-ratio").value;
  const size = videoDimensions(720, aspectRatio);
  const preview = $("preview");
  if (preview.width !== size.width || preview.height !== size.height) {
    preview.width = size.width;
    preview.height = size.height;
  }
  document.querySelector(".canvas-wrap").classList.toggle("portrait", aspectRatio === "9:16");
  $("preview-aspect").textContent = aspectRatio;
  $("preview-resolution").textContent = `${$("resolution").value}p`;
  for (const id of ["textX", "textY", "textSize"]) $(`${id}-value`).textContent = `${state[id]}%`;
  $("strength-value").textContent = `${state.strength}%`;
  $("darkness-value").textContent = `${state.darkness}%`;
  for (const key of ["positionX", "positionY"]) {
    $(`${key}-value`).textContent = `${state[key] > 0 ? "+" : ""}${state[key]}%`;
  }
  $("export-note").textContent = state.buffer
    ? "匯出期間請保持此頁面開啟。"
    : "先選擇音樂，就能匯出。";
  $("progress").hidden = $("cancel").hidden = !state.busy;
  if (!state.busy) $("export").textContent = `↓ 匯出 ${format.toUpperCase()} ↗`;
  document.querySelectorAll(".style-card").forEach((el) => {
    const i = Number(el.dataset.style);
    el.classList.toggle("selected", state.style === i);
    el.setAttribute("aria-pressed", String(state.style === i));
    el.querySelector(".check").hidden = state.style !== i;
  });
  $("color-value").textContent = state.color.toUpperCase();
  $("text-color-value").textContent = state.textColor.toUpperCase();
  persistSettings();
}

function mini(index) {
  const ns = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 150 65");
  svg.setAttribute("aria-hidden", "true");
  if (index === 19) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M52 32a23 23 0 1 0 46 0a23 23 0 1 0 -46 0 M59 16L91 48");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    svg.append(path);
    return svg;
  }
  if (index === 18) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M18 8H70V57H18Z M75 9A24 24 0 1 1 75 56 M82 18A16 16 0 1 1 82 47 M92 28A5 5 0 1 1 92 38A5 5 0 1 1 92 28");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    svg.append(path);
    return svg;
  }
  if (index >= 12) {
    const paths = [
      "M10 48 L28 30 L40 40 L60 12 L78 35 L96 20 L115 40 L140 25",
      "M75 8 Q110 0 94 25 Q140 35 94 42 Q100 65 75 48 Q45 65 55 42 Q10 35 55 25 Q40 0 75 8Z",
      "M25 8V30 M45 20V55 M65 5V40 M85 25V60 M105 10V40 M125 18V48",
      "M75 5L125 32L75 60L25 32Z M75 15L105 32L75 50L45 32Z",
      "M20 32 A55 18 0 1 0 130 32 A55 18 0 1 0 20 32 M50 8 Q110 10 100 55 Q40 55 50 8",
      "M8 32L28 32L38 22L48 45L60 8L72 56L85 20L98 38L112 28L125 32H142",
    ];
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", paths[index - 12]);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("fill", "none");
    svg.append(path);
    return svg;
  }
  if (index >= 6) {
    const count = index === 9 ? 30 : index === 10 ? 2 : index === 7 ? 3 : 5;
    for (let layer = 0; layer < count; layer++) {
      const shape = document.createElementNS(ns, index === 9 ? "circle" : "path");
      if (index === 9) {
        shape.setAttribute("cx", String(15 + ((layer * 43) % 120)));
        shape.setAttribute("cy", String(10 + ((layer * 17) % 43)));
        shape.setAttribute("r", String(1 + (layer % 3) * 0.6));
        shape.setAttribute("fill", "currentColor");
      } else {
        const points = [];
        const steps = index === 11 ? 6 : 80;
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          let x, y;
          if (index === 8 || index === 10) {
            x = 12 + u * 126;
            y =
              32 +
              (index === 8 ? (layer - 2) * 6 : 0) +
              Math.sin(u * Math.PI * 5 + layer * (index === 10 ? Math.PI : 0.5)) *
                (index === 10 ? 17 : 7);
          } else {
            const a =
              u * Math.PI * (index === 7 ? 5 : 2) +
              (index === 7 ? (layer * Math.PI * 2) / 3 : layer * 0.06);
            const r = index === 7 ? 3 + u * 24 : 6 + layer * 5;
            x = 75 + Math.cos(a) * r * (index === 11 ? 1.4 : 1);
            y = 32 + Math.sin(a) * r;
          }
          points.push(`${i ? "L" : "M"}${x},${y}`);
        }
        shape.setAttribute("d", points.join(" "));
        shape.setAttribute("stroke", "currentColor");
        shape.setAttribute("stroke-width", "1.4");
        shape.setAttribute("fill", "none");
      }
      svg.append(shape);
    }
    return svg;
  }
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2,
      h = 4 + Math.abs(Math.sin(i * 1.8)) * 18;
    const shape = document.createElementNS(ns, index === 5 ? "circle" : "line");
    const attrs =
      index === 5
        ? {
            cx: 17 + (i % 16) * 7.5,
            cy: 23 + Math.floor(i / 16) * 18,
            r: 1 + h / 10,
            fill: "currentColor",
          }
        : index === 0 || index === 4
          ? {
              x1: 75 + Math.cos(a) * 17,
              y1: 32 + Math.sin(a) * 17,
              x2: 75 + Math.cos(a) * (index === 0 ? 20 + h * 0.25 : 19 + h * 0.6),
              y2: 32 + Math.sin(a) * (index === 0 ? 20 + h * 0.25 : 19 + h * 0.6),
              stroke: "currentColor",
              "stroke-width": 1.8,
            }
          : {
              x1: 14 + i * 4,
              y1: index === 2 ? 32 - h / 2 : 48 - h,
              x2: 14 + i * 4,
              y2: index === 2 ? 32 + h / 2 : index === 3 ? 48 - h + 3 : 48,
              stroke: "currentColor",
              "stroke-width": 2,
            };
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, String(value));
    svg.append(shape);
  }
  return svg;
}
styles.map((name, index) => ({ name, index }))
  .sort((a, b) => Number(b.name === "無") - Number(a.name === "無"))
  .forEach(({ name, index }) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "style-card";
  button.dataset.style = String(index);
  const label = document.createElement("span");
  label.textContent = name;
  const check = document.createElement("span");
  check.className = "check";
  check.textContent = "✓";
  check.setAttribute("aria-hidden", "true");
  button.append(mini(index), label, check);
  button.addEventListener("click", () => {
    state.style = index;
    update();
  });
  $("styles").append(button);
});
$("spectrum-color").addEventListener("input", () => {
  if (state.busy || state.loading || state.imageLoading) return;
  state.color = $("spectrum-color").value;
  $("color-value").textContent = state.color.toUpperCase();
  $("text-color-value").textContent = state.textColor.toUpperCase();
  persistSettings();
});

async function loadAudio(file) {
  if (!file || state.busy || state.loading || state.imageLoading) return;
  state.loading = true;
  fileError("audio");
  message();
  update();
  let context;
  try {
    if (file.size > 300 * 1024 * 1024) throw Error("音樂檔案大小不可超過 300 MB。");
    context = new AudioContext();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration > 1200) throw Error("請選擇 20 分鐘以內的音樂。");
    if (!buffer.length) throw Error("音樂沒有可播放的內容。");
    audio.pause();
    URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(file);
    audio.src = state.url;
    state.buffer = buffer;
    state.originalBuffer = buffer;
    state.trimStart = 0;
    resetTrimInputs();
    state.name = file.name;
  } catch (error) {
    fileError("audio", error.message || "請選擇可讀取的音樂檔案。");
    message(`無法讀取音樂：${error.message}`);
  } finally {
    if (context) await context.close().catch(() => {});
    state.loading = false;
    update();
  }
}
async function loadImage(file, kind = "image") {
  if (!file || state.busy || state.loading || state.imageLoading) return;
  state.imageLoading = true;
  fileError(kind);
  update();
  message();
  let url;
  try {
    if (file.size > 30 * 1024 * 1024) throw Error("圖片請小於 30 MB。");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw Error("請選擇 JPG、PNG 或 WebP。");
    url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    await image.decode();
    state[kind] = image;
    state[`${kind}Name`] = file.name;
  } catch (error) {
    fileError(kind, error.message || "請選擇可讀取的圖片檔案。");
    message(`無法讀取圖片：${error.message}`);
  } finally {
    if (url) URL.revokeObjectURL(url);
    state.imageLoading = false;
    update();
  }
}
function bindFile(kind, load) {
  const input = $(`${kind}-input`),
    drop = $(`${kind}-drop`);
  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    void load(input.files[0]);
    input.value = "";
  });
  drop.addEventListener("dragover", (event) => event.preventDefault());
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    void load(event.dataTransfer.files[0]);
  });
}
bindFile("audio", loadAudio);
bindFile("image", loadImage);
for (const kind of ["sleeve", "record"]) {
  bindFile(kind, file => loadImage(file, kind));
  $(`remove-${kind}`).addEventListener("click", () => {
    if (state.busy || state.loading || state.imageLoading) return;
    state[kind] = null;
    state[`${kind}Name`] = "";
    fileError(kind);
    update();
  });
}
$("remove-image").addEventListener("click", () => {
  state.image = null;
  state.imageName = "";
  fileError("image");
  update();
});
$("dismiss-message").addEventListener("click", () => message());
$("play").addEventListener("click", async () => {
  try {
    if (audio.paused) {
      if (audio.currentTime < state.trimStart || audio.currentTime >= state.trimStart + state.buffer.duration) audio.currentTime = state.trimStart;
      await audio.play();
    }
    else audio.pause();
  } catch {
    message("播放失敗，請重新載入音樂。");
  }
});
for (const event of ["play", "pause", "ended"])
  audio.addEventListener(event, () => {
    $("play").textContent = audio.paused ? "▶" : "Ⅱ";
    $("play").setAttribute("aria-label", audio.paused ? "播放" : "暫停");
  });
$("seek").addEventListener("input", () => {
  audio.currentTime = Math.max(state.trimStart, Math.min(state.trimStart + state.buffer.duration, Number($("seek").value)));
});
$("restart").addEventListener("click", () => {
  audio.currentTime = state.trimStart;
});
for (const id of ["strength", "darkness", "positionX", "positionY", "textX", "textY", "textSize", "textFadeAfter"])
  $(id).addEventListener("input", () => {
    state[id] = Number($(id).value);
    update();
  });
$("reset-settings").addEventListener("click", () => {
  if (state.busy || state.loading || state.imageLoading) return;
  if (!$("reset-dialog").open) $("reset-dialog").showModal();
});
$("reset-dialog-cancel").addEventListener("click", () => $("reset-dialog").close());
$("reset-dialog").addEventListener("close", () => $("reset-settings").focus());
$("reset-dialog-confirm").addEventListener("click", () => {
  if (!$("reset-dialog").open || state.busy || state.loading || state.imageLoading) return;
  $("reset-dialog").close();
  Object.assign(state, DEFAULT_SETTINGS);
  for (const id of ["songTitle", "lyricist", "composer", "textX", "textY", "textSize", "textFadeAfter", "textColor", "strength", "darkness", "positionX", "positionY", "resolution", "fps", "format"]) {
    $(id).value = state[id];
  }
  $("spectrum-color").value = state.color;
  $("aspect-ratio").value = state.aspectRatio;
  $("appearance-mode").value = state.mode;
  $("appearance-theme").value = state.theme;
  applyTheme(state.mode, state.theme);
  update();
  const cleared = clearSettings();
  message(cleared ? "所有設定已恢復預設值。" : "本次設定已重置，但瀏覽器無法清除儲存的設定。");
});
$("reset-position").addEventListener("click", () => {
  state.positionX = state.positionY = 0;
  $("positionX").value = $("positionY").value = 0;
  update();
});
$("resolution").addEventListener("change", update);
$("aspect-ratio").addEventListener("change", update);
$("fps").addEventListener("change", persistSettings);
$("format").addEventListener("change", update);
$("cancel").addEventListener("click", () => exportController?.abort());
$("export").addEventListener("click", async () => {
  if (!state.buffer || state.busy || state.loading || state.imageLoading) return;
  syncSongDetails();
  persistSettings();
  state.busy = true;
  exportController = new AbortController();
  audio.pause();
  message();
  update();
  $("progress").value = 0;
  $("export").textContent = "正在匯出 0%";
  try {
    const resolution = $("resolution").value,
      fps = $("fps").value;
    const format = $("format").value;
    if (document.fonts?.ready) await document.fonts.ready;
    const blob = await encodeMedia({
      format,
      buffer: state.buffer,
      image: state.image,
      settings: { ...state },
      resolution,
      aspectRatio: $("aspect-ratio").value,
      fps,
      signal: exportController.signal,
      onProgress: (value) => {
        $("progress").value = value;
        $("export").textContent = `正在匯出 ${value}%`;
      },
    });
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = exportFilename(state.name, format, resolution, fps);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    message(`${format.toUpperCase()} 已完成，下載已開始。`);
  } catch (error) {
    message(error.message || "匯出失敗，請降低解析度再試。");
  } finally {
    state.busy = false;
    exportController = null;
    update();
  }
});

function animate() {
  enforceTrimEnd();
  const time = Math.max(0, (audio.currentTime || 0) - state.trimStart);
  if (!state.busy) draw($("preview"), time, state.buffer, state.image, state);
  $("time").textContent = formatTime(audio.currentTime || 0);
  $("seek").value = audio.currentTime || 0;
  requestAnimationFrame(animate);
}
window.addEventListener("beforeunload", (event) => {
  if (state.busy) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("pagehide", () => {
  exportController?.abort();
});

// Optional browser-agent interface uses the same state and native controls.
const lifecycle = new AbortController();
if (document.modelContext?.registerTool) {
  try {
    Promise.resolve(
      document.modelContext.registerTool(
        {
          name: "configure_visualizer",
          description: "Configure spectrum style, resolution and frame rate.",
          inputSchema: {
            type: "object",
            properties: {
              style: { type: "integer", minimum: 0, maximum: STYLES.length - 1 },
              resolution: { type: "string", enum: ["720", "1080"] },
              fps: { type: "string", enum: ["30", "60"] },
            },
            required: ["style", "resolution", "fps"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false },
          execute(input) {
            if (state.busy || state.loading || state.imageLoading)
              throw Error("Operation in progress");
            if (
              !input ||
              !Number.isInteger(input.style) ||
              input.style < 0 ||
              input.style >= STYLES.length ||
              !["720", "1080"].includes(input.resolution) ||
              !["30", "60"].includes(input.fps)
            )
              throw Error("Invalid settings");
            state.style = input.style;
            $("resolution").value = input.resolution;
            $("fps").value = input.fps;
            update();
            return { style: state.style, resolution: $("resolution").value, fps: $("fps").value };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
  } catch {
    /* Unsupported experimental API does not block the editor. */
  }
}
update();
animate();

function resetTrimInputs() {
  for (const edge of ["start", "end"]) for (const suffix of ["", "-range"]) {
    const input = $(`trim-${edge}${suffix}`);
    input.max = state.originalBuffer.duration;
    const seconds = edge === "start" ? 0 : state.originalBuffer.duration;
    input.value = suffix ? seconds : formatTrimTime(seconds);
  }
  $("trim-info").textContent = `完整音樂：${formatTrimTime(state.originalBuffer.duration)}`;
}
for (const edge of ["start", "end"]) for (const suffix of ["", "-range"]) {
  $(`trim-${edge}${suffix}`).addEventListener("input", () => {
    const value = $(`trim-${edge}${suffix}`).value;
    if (suffix) $(`trim-${edge}`).value = formatTrimTime(Number(value));
    else if (Number.isFinite(parseTrimTime(value))) $(`trim-${edge}-range`).value = parseTrimTime(value);
    updateTrimMarkers();
    const length = parseTrimTime($("trim-end").value) - parseTrimTime($("trim-start").value);
    $("trim-info").textContent = length > 0 ? `選取 ${formatTrimTime(length)}，按「套用裁剪」生效` : "請使用分：秒格式（例如 01:30.00），結束時間須大於開始時間";
  });
}
async function applyTrim() {
  if (!state.originalBuffer || state.busy || state.loading || state.imageLoading) return;
  state.loading = true;
  audio.pause();
  update();
  try {
    const { trimAudio } = await import("./trim.js");
    const start = parseTrimTime($("trim-start").value);
    let end = parseTrimTime($("trim-end").value);
    // The displayed end is rounded to hundredths; retain the exact full endpoint.
    if ($("trim-end").value === formatTrimTime(state.originalBuffer.duration)) end = state.originalBuffer.duration;
    const result = trimAudio(state.originalBuffer, start, end);
    state.buffer = result.buffer;
    state.trimStart = result.start;
    audio.currentTime = state.trimStart;
    $("trim-info").textContent = `已套用：${formatTrimTime(state.buffer.duration)}`;
    message("裁剪已套用，可播放試聽或匯出。");
  } catch (error) { message(error.message || "裁剪失敗，請重新設定範圍。"); }
  finally { state.loading = false; update(); }
}
$("trim-apply").addEventListener("click", applyTrim);
for (const edge of ["start", "end"]) $(`trim-${edge}-range`).addEventListener("change", applyTrim);
$("trim-reset").addEventListener("click", () => {
  if (!state.originalBuffer || state.busy || state.loading || state.imageLoading) return;
  audio.pause();
  state.buffer = state.originalBuffer;
  state.trimStart = 0;
  audio.currentTime = 0;
  $("trim-info").textContent = `已恢復完整音樂：${formatTrimTime(state.buffer.duration)}，裁剪時間已保留`;
  update();
});
function enforceTrimEnd() {
  if (state.buffer && !audio.paused && audio.currentTime >= state.trimStart + state.buffer.duration) {
    audio.pause();
    audio.currentTime = state.trimStart + state.buffer.duration;
  }
}
audio.addEventListener("timeupdate", enforceTrimEnd);

function updateTrimMarkers() {
  const duration = state.originalBuffer?.duration || 0;
  const start = parseTrimTime($("trim-start").value);
  const end = parseTrimTime($("trim-end").value);
  const valid = duration > 0 && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= duration + .005;
  $("trim-markers").hidden = !valid;
  if (!valid) return;
  $("trim-selection").style.left = `${start / duration * 100}%`;
  $("trim-selection").style.width = `${(Math.min(end, duration) - start) / duration * 100}%`;
  $("trim-selection-duration").textContent = formatTrimTime(Math.min(end, duration) - start);
  $("trim-drag-body").setAttribute("aria-label", `拖曳平移裁剪範圍，長度 ${formatTrimTime(Math.min(end, duration) - start)}`);
  $("trim-start-label").textContent = `開始 ${formatTrimTime(start)}`;
  $("trim-end-label").textContent = `結束 ${formatTrimTime(end)}`;
}

function setTrimRange(start, end) {
  for (const [edge, value] of [["start", start], ["end", end]]) {
    $(`trim-${edge}`).value = formatTrimTime(value);
    $(`trim-${edge}-range`).value = value;
  }
  updateTrimMarkers();
  $("trim-info").textContent = `選取 ${formatTrimTime(end - start)}，放開後自動套用`;
}
for (const mode of ["start", "body", "end"]) {
  const handle = $(`trim-drag-${mode}`);
  let drag = null;
  const locked = () => !state.originalBuffer || state.busy || state.loading || state.imageLoading;
  handle.addEventListener("pointerdown", event => {
    if (locked() || event.button !== 0) return;
    const start = parseTrimTime($("trim-start").value);
    const end = Math.min(state.originalBuffer.duration, parseTrimTime($("trim-end").value));
    const width = $("trim-track").getBoundingClientRect().width;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || width <= 0) return;
    event.preventDefault();
    drag = {id:event.pointerId, x:event.clientX, start, end, width, duration:state.originalBuffer.duration};
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId || locked()) return;
    const delta = (event.clientX - drag.x) / drag.width * drag.duration;
    setTrimRange(...moveTrimRange(drag.start, drag.end, delta, drag.duration, mode));
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(type, event => {
    if (!drag || drag.id !== event.pointerId) return;
    const completed = type === "pointerup";
    drag = null;
    if (completed && !locked()) void applyTrim();
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  });
  let keyboardChanged = false;
  handle.addEventListener("keyup", event => {
    if (keyboardChanged && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      keyboardChanged = false;
      void applyTrim();
    }
  });
  handle.addEventListener("keydown", event => {
    if (locked() || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const start = parseTrimTime($("trim-start").value), end = Math.min(state.originalBuffer.duration, parseTrimTime($("trim-end").value));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    keyboardChanged = true;
    setTrimRange(...moveTrimRange(start, end, (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 1 : .1), state.originalBuffer.duration, mode));
  });
}
