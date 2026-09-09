import { drawLayerWithEffect } from "./video-effects.js";

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

function loadProjectImage(blob, name = "圖片") {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve({ image, url });
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
    for (const slide of project.slides) loaded.push(await loadProjectImage(slide.blob, slide.name));
    const canvas = document.createElement("canvas");
    canvas.width = Number(project.width) || 1280;
    canvas.height = Number(project.height) || 720;
    const context = canvas.getContext("2d");
    const slides = project.slides.map((slide, index) => ({ ...slide, element: loaded[index].image }));
    const renderer = {
      width: canvas.width,
      height: canvas.height,
      duration: imageSequenceDuration(slides),
      setTime(time) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        const active = imageSequenceAt(slides, time, loop);
        if (!active) return;
        const layer = { ...active.slide, type: "image", start: active.start };
        drawLayerWithEffect(context, layer, active.slide.element, active.slide.element.naturalWidth, active.slide.element.naturalHeight, active.time);
      },
      draw(target, x, y, width, height) { target.drawImage(canvas, x, y, width, height); },
      dispose() { for (const item of loaded) URL.revokeObjectURL(item.url); },
    };
    renderer.setTime(0);
    return renderer;
  } catch (error) {
    for (const item of loaded) URL.revokeObjectURL(item.url);
    throw error;
  }
}
