import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { videoDimensions } from "./dimensions.js";
import { drawLayerWithEffect, effectDuration, layerEffectState, VIDEO_EFFECTS } from "./video-effects.js";
import { formatEditorTime } from "./video-editor-core.js";
import { createPngMov } from "./png-mov.js";
import { imageSequenceAt, imageSequenceDuration, serializeImageSequence } from "./image-sequence.js";
import { saveStoredMedia, saveStoredValue } from "./media-store.js";

const $ = id => document.getElementById(id);
const settings = loadSettings();
applyTheme(settings.mode, settings.theme);

const state = {
  slides: [],
  selectedId: null,
  time: 0,
  playing: false,
  clockStart: 0,
  exporting: false,
  controller: null,
};
let nextId = 1;

function status(text, mode = "") {
  $("image-video-status").textContent = text;
  $("image-video-status").className = `editor-status ${mode}`.trim();
}

function error(text = "") {
  $("image-video-error").textContent = text;
  $("image-video-error").hidden = !text;
}

function duration() {
  return state.slides.length ? imageSequenceDuration(state.slides) : 0;
}

function selected() {
  return state.slides.find(slide => slide.id === state.selectedId) || null;
}

function slideStart(target) {
  let start = 0;
  for (const slide of state.slides) {
    if (slide === target) return start;
    start += slide.duration;
  }
  return 0;
}

function moveSlide(id, direction) {
  if (state.exporting) return;
  const index = state.slides.findIndex(slide => slide.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.slides.length) return;
  pause();
  [state.slides[index], state.slides[target]] = [state.slides[target], state.slides[index]];
  state.selectedId = id;
  state.time = slideStart(selected());
  status(`已將 ${selected().name}${direction < 0 ? "上移" : "下移"}。`, "success");
  update();
}

function setCanvasSize() {
  const dimensions = videoDimensions($("image-video-resolution").value, settings.aspectRatio);
  const canvas = $("image-video-preview");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  $("image-video-preview-size").textContent = `${settings.aspectRatio} · ${$("image-video-resolution").value}p`;
  $("image-video-aspect").textContent = `MOV · PNG 透明影格 · ${settings.aspectRatio}（畫面比例從主畫面帶入）`;
}

function renderFrame(time = state.time) {
  const canvas = $("image-video-preview");
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.slides.length) return;
  const total = duration();
  const active = imageSequenceAt(state.slides, Math.min(Math.max(0, time), Math.max(0, total - .0001)));
  if (!active) return;
  drawLayerWithEffect(
    context,
    { ...active.slide, type: "image", start: active.start },
    active.slide.element,
    active.slide.element.naturalWidth,
    active.slide.element.naturalHeight,
    active.time,
  );
}

function renderList() {
  $("image-list").replaceChildren(...state.slides.map((slide, index) => {
    const row = document.createElement("div");
    row.className = `layer-row image-sequence-row${slide.id === state.selectedId ? " selected" : ""}`;
    const select = document.createElement("button");
    select.type = "button";
    select.className = "image-sequence-select";
    const image = document.createElement("img");
    image.src = slide.url;
    image.alt = "";
    const detail = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = slide.name;
    const timing = document.createElement("small");
    timing.textContent = `${formatEditorTime(slideStart(slide))}–${formatEditorTime(slideStart(slide) + slide.duration)} · ${slide.duration.toFixed(1)} 秒`;
    detail.append(name, timing);
    select.append(image, detail);
    select.addEventListener("click", () => { state.selectedId = slide.id; state.time = slideStart(slide); update(); });
    const controls = document.createElement("div");
    controls.className = "image-sequence-order";
    const order = document.createElement("b");
    order.textContent = String(index + 1);
    const up = document.createElement("button");
    up.type = "button";
    up.className = "image-order-button";
    up.textContent = "↑";
    up.title = "上移圖片";
    up.setAttribute("aria-label", `上移 ${slide.name}`);
    up.disabled = index === 0 || state.exporting;
    up.addEventListener("click", () => moveSlide(slide.id, -1));
    const down = document.createElement("button");
    down.type = "button";
    down.className = "image-order-button";
    down.textContent = "↓";
    down.title = "下移圖片";
    down.setAttribute("aria-label", `下移 ${slide.name}`);
    down.disabled = index === state.slides.length - 1 || state.exporting;
    down.addEventListener("click", () => moveSlide(slide.id, 1));
    controls.append(order, up, down);
    row.append(select, controls);
    return row;
  }));
  $("image-count").textContent = `${state.slides.length} 張`;
  $("empty-images").hidden = Boolean(state.slides.length);
}

function renderInspector() {
  const slide = selected();
  $("empty-image-inspector").hidden = Boolean(slide);
  $("image-controls").hidden = !slide;
  if (!slide) return;
  $("selected-image-name").textContent = slide.name;
  $("image-duration").value = slide.duration;
  for (const phase of ["enter", "exit"]) {
    $(`image-${phase}-effect`).value = slide[`${phase}Effect`];
    $(`image-${phase}-duration`).value = slide[`${phase}Duration`];
  }
  const index = state.slides.indexOf(slide);
  $("move-image-up").disabled = index <= 0 || state.exporting;
  $("move-image-down").disabled = index < 0 || index >= state.slides.length - 1 || state.exporting;
}

function renderTimeline() {
  const total = duration();
  const scaleDuration = Math.max(.1, total);
  const ruler = $("image-video-ruler");
  ruler.replaceChildren();
  const ticks = Math.min(8, Math.max(2, Math.ceil(total / 5)));
  for (let index = 0; index <= ticks; index++) {
    const tick = document.createElement("span");
    tick.className = "timeline-tick";
    tick.style.left = `${index / ticks * 100}%`;
    tick.textContent = formatEditorTime(total * index / ticks);
    ruler.append(tick);
  }
  let start = 0;
  $("image-video-tracks").replaceChildren(...state.slides.map(slide => {
    const track = document.createElement("div");
    track.className = "timeline-track";
    track.dataset.label = slide.name;
    const band = document.createElement("button");
    band.type = "button";
    band.className = `timeline-band${slide.id === state.selectedId ? " selected" : ""}`;
    band.style.left = `${start / scaleDuration * 100}%`;
    band.style.width = `${slide.duration / scaleDuration * 100}%`;
    band.textContent = `${slide.duration.toFixed(1)} 秒`;
    const seek = start;
    band.addEventListener("click", () => { state.selectedId = slide.id; state.time = seek; update(); });
    track.append(band);
    start += slide.duration;
    return track;
  }));
}

function updatePlayer() {
  const total = duration();
  const scaleDuration = Math.max(.1, total);
  state.time = Math.max(0, Math.min(state.time, total));
  $("image-video-seek").max = total;
  $("image-video-seek").value = state.time;
  $("image-video-current").textContent = formatEditorTime(state.time);
  $("image-video-total").textContent = formatEditorTime(total);
  $("image-video-playhead").style.left = `calc(78px + (100% - 84px) * ${state.time / scaleDuration})`;
  $("play-image-video").textContent = state.playing ? "❚❚" : "▶";
  const ready = state.slides.length > 0 && !state.exporting;
  $("play-image-video").disabled = !ready;
  $("image-video-seek").disabled = !ready;
  $("export-image-video").disabled = !ready;
  $("export-image-video-to-main").disabled = !ready;
}

function update() {
  setCanvasSize();
  renderList();
  renderInspector();
  renderTimeline();
  updatePlayer();
  renderFrame();
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => { URL.revokeObjectURL(url); reject(Error(`${file.name} 無法載入。`)); };
    image.src = url;
  });
}

async function addImages(files) {
  if (state.exporting) return;
  error();
  const added = [];
  try {
    for (const file of files) {
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) && !["jpg", "jpeg", "png", "webp"].includes(extension)) throw Error(`${file.name} 不是支援的圖片格式。`);
      if (file.size > 30 * 1024 * 1024) throw Error(`${file.name} 超過 30 MB。`);
      const loaded = await loadImage(file);
      added.push({
        id: nextId++, type: "image", file, name: file.name, element: loaded.image, url: loaded.url,
        duration: 5, enterEffect: "none", enterDuration: .5, exitEffect: "none", exitDuration: .5,
      });
    }
    state.slides.push(...added);
    state.selectedId = added[0]?.id || state.selectedId;
    state.time = added[0] ? slideStart(added[0]) : state.time;
    status(`已加入 ${added.length} 張圖片。`, "success");
    update();
  } catch (reason) {
    for (const slide of added) URL.revokeObjectURL(slide.url);
    error(reason.message || "圖片無法載入。");
    status("部分或全部圖片無法加入。", "error");
  }
}

function patchSelected(patch) {
  const slide = selected();
  if (!slide || state.exporting) return;
  Object.assign(slide, patch);
  slide.duration = Math.max(.1, Math.min(3600, Number(slide.duration) || 5));
  slide.enterEffect = Object.hasOwn(VIDEO_EFFECTS, slide.enterEffect) ? slide.enterEffect : "none";
  slide.exitEffect = Object.hasOwn(VIDEO_EFFECTS, slide.exitEffect) ? slide.exitEffect : "none";
  slide.enterDuration = effectDuration(slide.enterDuration);
  slide.exitDuration = effectDuration(slide.exitDuration);
  update();
}

function pause() {
  state.playing = false;
  updatePlayer();
}

function animate(timestamp) {
  if (state.playing) {
    state.time = (timestamp - state.clockStart) / 1000;
    if (state.time >= duration()) { state.time = duration(); pause(); }
    updatePlayer();
    renderFrame();
  }
  requestAnimationFrame(animate);
}

function canvasPng(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error("PNG 影格編碼失敗。")), "image/png"));
}

async function encodeMovie(toMain) {
  if (!state.slides.length || state.exporting) return;
  pause();
  state.exporting = true;
  state.controller = new AbortController();
  const signal = state.controller.signal;
  $("image-video-progress").hidden = false;
  $("cancel-image-video-export").hidden = false;
  $("image-video-progress").value = 0;
  updatePlayer();
  try {
    const fps = Number($("image-video-fps").value);
    const resolution = $("image-video-resolution").value;
    const dimensions = videoDimensions(resolution, settings.aspectRatio);
    const total = duration();
    const count = Math.ceil(total * fps);
    const canvas = $("image-video-preview");
    const frames = [];
    const stillFrames = new Map();
    for (let index = 0; index < count; index++) {
      if (signal.aborted) throw Error("已取消匯出。");
      const frameTime = index / fps;
      const active = imageSequenceAt(state.slides, Math.min(frameTime, Math.max(0, total - .0001)));
      const effect = active ? layerEffectState({ ...active.slide, start: active.start }, frameTime) : null;
      let frame = effect?.effect === "none" ? stillFrames.get(active.slide.id) : null;
      if (!frame) {
        renderFrame(frameTime);
        frame = await canvasPng(canvas);
        if (effect?.effect === "none") stillFrames.set(active.slide.id, frame);
      }
      frames.push(frame);
      if (index % 3 === 0 || index === count - 1) {
        const progress = Math.round((index + 1) / count * 94);
        $("image-video-progress").value = progress;
        status(`正在建立透明 MOV ${progress}% · ${index + 1}/${count} 影格`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    const blob = createPngMov(frames, dimensions.width, dimensions.height, fps);
    const outputName = `yumeew-image-video-${resolution}p-${fps}fps.mov`;
    const file = new File([blob], outputName, { type: "video/quicktime", lastModified: Date.now() });
    if (toMain) {
      if (file.size > 1024 ** 3) throw Error("這個 MOV 超過主畫面背景素材的 1 GB 上限，請降低解析度、FPS 或縮短圖片時間。");
      const project = serializeImageSequence(state.slides, { outputName, ...dimensions, aspectRatio: settings.aspectRatio, fps });
      status("正在保存背景素材到瀏覽器…");
      await saveStoredValue("image-video-project", project);
      await saveStoredMedia("image", file);
      void navigator.storage?.persist?.().catch(() => false);
      $("image-video-progress").value = 100;
      window.location.href = "./";
      return;
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = outputName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    $("image-video-progress").value = 100;
    status("透明 MOV 已完成，下載已開始。", "success");
  } catch (reason) {
    status(reason.message || "MOV 匯出失敗。", "error");
  } finally {
    state.exporting = false;
    state.controller = null;
    $("cancel-image-video-export").hidden = true;
    updatePlayer();
    renderFrame();
  }
}

$("add-images").addEventListener("click", () => { $("images-input").value = ""; $("images-input").click(); });
$("images-input").addEventListener("change", event => void addImages(event.target.files || []));
for (const name of ["dragenter", "dragover"]) $("add-images").addEventListener(name, event => { event.preventDefault(); $("add-images").classList.add("dragging"); });
for (const name of ["dragleave", "drop"]) $("add-images").addEventListener(name, event => { event.preventDefault(); $("add-images").classList.remove("dragging"); });
$("add-images").addEventListener("drop", event => void addImages(event.dataTransfer?.files || []));
$("image-duration").addEventListener("input", event => {
  if (event.target.value !== "") patchSelected({ duration: event.target.value });
});
for (const phase of ["enter", "exit"]) {
  $(`image-${phase}-effect`).addEventListener("change", event => patchSelected({ [`${phase}Effect`]: event.target.value }));
  $(`image-${phase}-duration`).addEventListener("input", event => {
    if (event.target.value !== "") patchSelected({ [`${phase}Duration`]: event.target.value });
  });
}
for (const [id, direction] of [["move-image-up", -1], ["move-image-down", 1]]) $(id).addEventListener("click", () => moveSlide(state.selectedId, direction));
$("remove-image-video-item").addEventListener("click", () => {
  const index = state.slides.findIndex(slide => slide.id === state.selectedId);
  if (index < 0) return;
  const [removed] = state.slides.splice(index, 1);
  URL.revokeObjectURL(removed.url);
  state.selectedId = state.slides[Math.min(index, state.slides.length - 1)]?.id || null;
  state.time = 0;
  update();
});
$("play-image-video").addEventListener("click", () => {
  if (state.playing) return pause();
  if (state.time >= duration()) state.time = 0;
  state.clockStart = performance.now() - state.time * 1000;
  state.playing = true;
  updatePlayer();
});
$("restart-image-video").addEventListener("click", () => { pause(); state.time = 0; updatePlayer(); renderFrame(); });
$("image-video-seek").addEventListener("input", event => { pause(); state.time = Number(event.target.value); updatePlayer(); renderFrame(); });
$("image-video-resolution").addEventListener("change", update);
$("image-video-fps").addEventListener("change", updatePlayer);
$("fullscreen-image-video").addEventListener("click", () => document.fullscreenElement ? document.exitFullscreen() : $("image-video-frame").requestFullscreen());
$("export-image-video").addEventListener("click", () => void encodeMovie(false));
$("export-image-video-to-main").addEventListener("click", () => void encodeMovie(true));
$("cancel-image-video-export").addEventListener("click", () => state.controller?.abort());
for (const link of document.querySelectorAll("[data-confirm-return]")) link.addEventListener("click", event => {
  if (!state.slides.length || window.confirm("返回主畫面將不會保留目前的圖片與設定，是否確定？")) return;
  event.preventDefault();
});
window.addEventListener("pagehide", () => {
  state.controller?.abort();
  for (const slide of state.slides) URL.revokeObjectURL(slide.url);
});

$("image-video-resolution").value = settings.resolution;
$("image-video-fps").value = settings.fps;
update();
requestAnimationFrame(animate);
