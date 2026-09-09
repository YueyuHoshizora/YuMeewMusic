import { drawLayerWithEffect } from "./video-effects.js";
import { isBackgroundVideo } from "./background-video.js";

export function imageSequenceDuration(slides) {
  return Math.max(.1, (slides || []).reduce((sum, slide) => sum + Math.max(.1, Number(slide.duration) || 5), 0));
}

export function imageSequenceAt(slides, time, loop = false) {
  const duration = imageSequenceDuration(slides);
  let value = Math.max(0, Number(time) || 0);
  if (loop && duration > 0) value %= duration;
  let start = 0;
  for (let index = 0; index < slides.length; index++) {
    const slide = slides[index];
    const length = Math.max(.1, Number(slide.duration) || 5);
    if (value < start + length || index === slides.length - 1) return { slide, index, start, time: value };
    start += length;
  }
  return null;
}

function loadProjectMedia(slide) {
  return new Promise((resolve, reject) => {
    const blob = slide.blob;
    const name = slide.name || "素材";
    const url = URL.createObjectURL(blob);
    const video = slide.kind === "video" || isBackgroundVideo({ type: slide.type || blob.type, name });
    if (video) {
      const element = document.createElement("video");
      element.preload = "auto";
      element.playsInline = true;
      element.muted = true;
      element.defaultMuted = true;
      element.loop = false;
      element.onloadeddata = () => {
        if (!Number.isFinite(element.duration) || !(element.duration > 0) || !element.videoWidth || !element.videoHeight) {
          URL.revokeObjectURL(url);
          reject(Error(`${name} 沒有可播放的影片畫面。`));
          return;
        }
        resolve({ element, url, kind: "video" });
      };
      element.onerror = () => { URL.revokeObjectURL(url); reject(Error(`${name} 無法載入。`)); };
      element.src = url;
      return;
    }
    const image = new Image();
    image.onload = () => resolve({ element: image, url, kind: "image" });
    image.onerror = () => { URL.revokeObjectURL(url); reject(Error(`${name} 無法載入。`)); };
    image.src = url;
  });
}

export function serializeImageSequence(slides, metadata) {
  return {
    version: 1,
    outputName: metadata.outputName,
    width: metadata.width,
    height: metadata.height,
    aspectRatio: metadata.aspectRatio,
    fps: metadata.fps,
    slides: slides.map(slide => ({
      blob: slide.file,
      kind: slide.type,
      name: slide.name,
      type: slide.file.type,
      lastModified: slide.file.lastModified,
      duration: slide.duration,
      enterEffect: slide.enterEffect,
      enterDuration: slide.enterDuration,
      exitEffect: slide.exitEffect,
      exitDuration: slide.exitDuration,
    })),
  };
}

export async function createImageSequenceRenderer(project, loop = true) {
  if (project?.version !== 1 || !Array.isArray(project.slides) || !project.slides.length) throw Error("保存的圖轉影片資料無效。");
  const loaded = [];
  try {
    for (const slide of project.slides) loaded.push(await loadProjectMedia(slide));
    const canvas = document.createElement("canvas");
    canvas.width = Number(project.width) || 1280;
    canvas.height = Number(project.height) || 720;
    const context = canvas.getContext("2d");
    const slides = project.slides.map((slide, index) => ({ ...slide, type: loaded[index].kind, element: loaded[index].element }));
    let currentTime = 0;
    const paint = (time, seek = false) => {
      currentTime = time;
      context.clearRect(0, 0, canvas.width, canvas.height);
      const active = imageSequenceAt(slides, time, loop);
      if (!active) return Promise.resolve();
      const source = active.slide.element;
      const draw = () => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        const width = source.videoWidth || source.naturalWidth;
        const height = source.videoHeight || source.naturalHeight;
        drawLayerWithEffect(context, { ...active.slide, start: active.start }, source, width, height, active.time);
      };
      if (active.slide.type !== "video") {
        draw();
        return Promise.resolve();
      }
      const local = Math.max(0, Math.min(active.slide.duration - .001, active.time - active.start));
      source.muted = true;
      source.loop = false;
      source.pause();
      if (Math.abs(source.currentTime - local) <= (seek ? .001 : .15)) {
        draw();
        return Promise.resolve();
      }
      if (!seek) {
        source.currentTime = local;
        if (source.readyState >= 2) draw();
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const cleanup = () => { source.removeEventListener("seeked", done); source.removeEventListener("error", failed); };
        const done = () => { cleanup(); draw(); resolve(); };
        const failed = () => { cleanup(); reject(Error(`${active.slide.name} 無法讀取影片畫面。`)); };
        source.addEventListener("seeked", done, { once: true });
        source.addEventListener("error", failed, { once: true });
        source.currentTime = local;
      });
    };
    for (const item of loaded.filter(item => item.kind === "video")) item.element.addEventListener("seeked", () => void paint(currentTime));
    const renderer = {
      width: canvas.width,
      height: canvas.height,
      duration: imageSequenceDuration(slides),
      setTime(time) { void paint(time); },
      seekTime(time) { return paint(time, true); },
      draw(target, x, y, width, height) { target.drawImage(canvas, x, y, width, height); },
      dispose() { for (const item of loaded) { if (item.kind === "video") item.element.pause(); URL.revokeObjectURL(item.url); } },
    };
    renderer.setTime(0);
    return renderer;
  } catch (error) {
    for (const item of loaded) { if (item.kind === "video") item.element.pause(); URL.revokeObjectURL(item.url); }
    throw error;
  }
}
