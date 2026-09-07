import { draw } from "./visualizer.js";
import { encodeVideo } from "./export.js";

const $ = (id) => document.getElementById(id);
const audio = $("audio");
const state = {
  style: 0,
  color: "#c5fa75",
  strength: 70,
  darkness: 45,
  buffer: null,
  image: null,
  name: "",
  imageName: "",
  url: "",
  busy: false,
  loading: false,
  imageLoading: false,
};
let exportController;
const styles = ["環形脈衝", "經典音柱", "鏡像頻譜", "流動波形", "放射光芒", "點陣節奏"];
const colors = ["#c5fa75", "#a99bff", "#61dcff", "#ff9caf", "#ffffff"];
const colorNames = ["萊姆綠", "紫色", "冰藍", "粉紅", "白色"];
const format = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function message(text = "") {
  $("message-text").textContent = text;
  $("message").hidden = !text;
}
function update() {
  const locked = state.busy || state.loading || state.imageLoading;
  document
    .querySelectorAll(
      ".style-card, .colors button, #strength, #darkness, #resolution, #fps, #restart, #remove-image, #audio-drop, #image-drop",
    )
    .forEach((el) => (el.disabled = locked));
  $("play").disabled = $("seek").disabled = $("export").disabled = !state.buffer || locked;
  $("audio-name").textContent = state.loading ? "正在讀取音樂…" : state.name || "選擇本機音樂";
  $("audio-info").textContent = state.buffer
    ? `${format(state.buffer.duration)} · 點擊更換`
    : "拖放檔案或點擊選擇";
  $("image-name").textContent = state.imageLoading
    ? "正在讀取圖片…"
    : state.imageName || "加入背景圖片";
  $("remove-image").hidden = !state.image;
  $("duration").textContent = format(state.buffer?.duration || 0);
  $("seek").max = state.buffer?.duration || 1;
  $("preview-tag").textContent = state.buffer
    ? "YOUR SOUND, IN MOTION"
    : "DEMO VISUAL · 選擇音樂開始創作";
  $("preview-resolution").textContent = `${$("resolution").value}p`;
  $("strength-value").textContent = `${state.strength}%`;
  $("darkness-value").textContent = `${state.darkness}%`;
  $("export-note").textContent = state.buffer
    ? "匯出期間請保持此頁面開啟。"
    : "先選擇音樂，就能匯出影片。";
  $("progress").hidden = $("cancel").hidden = !state.busy;
  if (!state.busy) $("export").textContent = "↓ 匯出 MP4 ↗";
  document.querySelectorAll(".style-card").forEach((el, i) => {
    el.classList.toggle("selected", state.style === i);
    el.setAttribute("aria-pressed", String(state.style === i));
    el.querySelector(".check").hidden = state.style !== i;
  });
  document.querySelectorAll(".colors button").forEach((el, i) => {
    el.classList.toggle("active", state.color === colors[i]);
    el.setAttribute("aria-pressed", String(state.color === colors[i]));
    el.textContent = state.color === colors[i] ? "✓" : "";
  });
}

function mini(index) {
  const ns = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 150 65");
  svg.setAttribute("aria-hidden", "true");
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
styles.forEach((name, index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "style-card";
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
colors.forEach((color, index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.style.background = color;
  button.setAttribute("aria-label", colorNames[index]);
  button.addEventListener("click", () => {
    state.color = color;
    update();
  });
  $("colors").append(button);
});

async function loadAudio(file) {
  if (!file || state.busy || state.loading || state.imageLoading) return;
  state.loading = true;
  message();
  update();
  let context;
  try {
    if (file.size > 150 * 1024 * 1024) throw Error("音樂檔案請小於 150 MB。");
    context = new AudioContext();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration > 1200) throw Error("請選擇 20 分鐘以內的音樂。");
    if (!buffer.length) throw Error("音樂沒有可播放的內容。");
    audio.pause();
    URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(file);
    audio.src = state.url;
    state.buffer = buffer;
    state.name = file.name;
  } catch (error) {
    message(`無法讀取音樂：${error.message}`);
  } finally {
    if (context) await context.close().catch(() => {});
    state.loading = false;
    update();
  }
}
async function loadImage(file) {
  if (!file || state.busy || state.loading || state.imageLoading) return;
  state.imageLoading = true;
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
    state.image = image;
    state.imageName = file.name;
  } catch (error) {
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
$("remove-image").addEventListener("click", () => {
  state.image = null;
  state.imageName = "";
  update();
});
$("dismiss-message").addEventListener("click", () => message());
$("play").addEventListener("click", async () => {
  try {
    if (audio.paused) await audio.play();
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
  audio.currentTime = Number($("seek").value);
});
$("restart").addEventListener("click", () => {
  audio.currentTime = 0;
});
for (const id of ["strength", "darkness"])
  $(id).addEventListener("input", () => {
    state[id] = Number($(id).value);
    update();
  });
$("resolution").addEventListener("change", update);
$("cancel").addEventListener("click", () => exportController?.abort());
$("export").addEventListener("click", async () => {
  if (!state.buffer || state.busy || state.loading || state.imageLoading) return;
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
    const blob = await encodeVideo({
      buffer: state.buffer,
      image: state.image,
      settings: { ...state },
      resolution,
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
    link.download = `${state.name.replace(/\.[^.]+$/, "") || "yumeew"}-${resolution}p-${fps}fps.mp4`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    message("MP4 已完成，下載已開始。");
  } catch (error) {
    message(error.message || "匯出失敗，請降低解析度再試。");
  } finally {
    state.busy = false;
    exportController = null;
    update();
  }
});

function animate() {
  if (!state.busy) draw($("preview"), audio.currentTime || 0, state.buffer, state.image, state);
  $("time").textContent = format(audio.currentTime || 0);
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
              style: { type: "integer", minimum: 0, maximum: 5 },
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
              input.style > 5 ||
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
