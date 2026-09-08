import { coverRect, finiteTime, layerEnd } from "./video-editor-core.js";

export const VIDEO_EFFECTS = Object.freeze({
  none: "無",
  fade: "淡入淡出",
  dissolve: "交叉溶解",
  "slide-left": "向左滑動",
  "slide-right": "向右滑動",
  "slide-up": "向上滑動",
  "slide-down": "向下滑動",
  zoom: "縮放",
  blur: "模糊轉場",
  "flash-white": "閃白",
  "flash-black": "閃黑",
  circle: "圓形揭露",
  blinds: "百葉窗",
  pixelate: "像素化",
  "rgb-glitch": "RGB 色差故障",
});

const buffers = new WeakMap();
const clamp01 = value => Math.max(0, Math.min(1, value));

export function effectDuration(value) {
  return Math.max(.1, Math.min(10, finiteTime(value, .5)));
}

export function layerEffectState(layer, time) {
  const start = finiteTime(layer.start);
  const end = layerEnd(layer);
  const enterEffect = Object.hasOwn(VIDEO_EFFECTS, layer.enterEffect) ? layer.enterEffect : "none";
  const exitEffect = Object.hasOwn(VIDEO_EFFECTS, layer.exitEffect) ? layer.exitEffect : "none";
  const enterProgress = enterEffect === "none" ? 1 : clamp01((time - start) / effectDuration(layer.enterDuration));
  const exitProgress = exitEffect === "none" ? 1 : clamp01((end - time) / effectDuration(layer.exitDuration));
  if (enterProgress < exitProgress) return { effect: enterEffect, phase: "enter", progress: enterProgress };
  if (exitProgress < 1) return { effect: exitEffect, phase: "exit", progress: exitProgress };
  if (enterProgress < 1) return { effect: enterEffect, phase: "enter", progress: enterProgress };
  return { effect: "none", phase: "steady", progress: 1 };
}

function effectBuffers(context) {
  let value = buffers.get(context);
  if (!value) {
    const createCanvas = () => context.canvas.ownerDocument.createElement("canvas");
    value = { layer: createCanvas(), pixel: createCanvas() };
    buffers.set(context, value);
  }
  for (const canvas of [value.layer, value.pixel]) {
    if (canvas.width !== context.canvas.width) canvas.width = context.canvas.width;
    if (canvas.height !== context.canvas.height) canvas.height = context.canvas.height;
  }
  return value;
}

function paintLayer(canvas, source, sourceWidth, sourceHeight) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  const rect = coverRect(sourceWidth, sourceHeight, canvas.width, canvas.height);
  if (typeof source.draw === "function") source.draw(context, rect.x, rect.y, rect.width, rect.height);
  else context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
}

function drawSlide(context, canvas, effect, phase, progress) {
  const distance = 1 - progress;
  let x = 0, y = 0;
  const exit = phase === "exit" ? -1 : 1;
  if (effect === "slide-left") x = context.canvas.width * distance * exit;
  if (effect === "slide-right") x = -context.canvas.width * distance * exit;
  if (effect === "slide-up") y = context.canvas.height * distance * exit;
  if (effect === "slide-down") y = -context.canvas.height * distance * exit;
  context.drawImage(canvas, x, y);
}

export function drawLayerWithEffect(context, layer, source, sourceWidth, sourceHeight, time) {
  const { layer: layerCanvas, pixel: pixelCanvas } = effectBuffers(context);
  paintLayer(layerCanvas, source, sourceWidth, sourceHeight);
  const { effect, phase, progress } = layerEffectState(layer, time);
  const eased = progress * progress * (3 - 2 * progress);
  const width = context.canvas.width, height = context.canvas.height;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);

  if (effect === "fade") {
    context.globalAlpha = eased;
    context.drawImage(layerCanvas, 0, 0);
  } else if (effect === "dissolve") {
    context.globalAlpha = eased;
    const scale = .985 + .015 * eased;
    context.translate(width / 2, height / 2);
    context.scale(scale, scale);
    context.drawImage(layerCanvas, -width / 2, -height / 2);
  } else if (effect.startsWith("slide-")) {
    drawSlide(context, layerCanvas, effect, phase, eased);
  } else if (effect === "zoom") {
    const scale = .55 + .45 * eased;
    context.globalAlpha = Math.min(1, .25 + eased);
    context.translate(width / 2, height / 2);
    context.scale(scale, scale);
    context.drawImage(layerCanvas, -width / 2, -height / 2);
  } else if (effect === "blur") {
    context.globalAlpha = Math.min(1, .2 + eased);
    context.filter = `blur(${Math.round((1 - eased) * 28)}px)`;
    context.drawImage(layerCanvas, 0, 0);
  } else if (effect === "circle") {
    const radius = Math.hypot(width, height) * .5 * eased;
    context.beginPath();
    context.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
    context.clip();
    context.drawImage(layerCanvas, 0, 0);
  } else if (effect === "blinds") {
    const count = 12, stripe = width / count;
    context.beginPath();
    for (let index = 0; index < count; index++) context.rect(index * stripe, 0, stripe * eased, height);
    context.clip();
    context.drawImage(layerCanvas, 0, 0);
  } else if (effect === "pixelate") {
    const block = Math.max(1, Math.round(1 + (1 - eased) * 38));
    const pixelWidth = Math.max(1, Math.ceil(width / block));
    const pixelHeight = Math.max(1, Math.ceil(height / block));
    pixelCanvas.width = pixelWidth;
    pixelCanvas.height = pixelHeight;
    const pixelContext = pixelCanvas.getContext("2d");
    pixelContext.imageSmoothingEnabled = false;
    pixelContext.drawImage(layerCanvas, 0, 0, pixelWidth, pixelHeight);
    context.imageSmoothingEnabled = false;
    context.globalAlpha = Math.min(1, .35 + eased);
    context.drawImage(pixelCanvas, 0, 0, width, height);
  } else if (effect === "rgb-glitch") {
    const offset = Math.round((1 - eased) * Math.min(width, height) * .035);
    context.globalAlpha = Math.min(1, .45 + eased);
    context.drawImage(layerCanvas, 0, 0);
    context.globalCompositeOperation = "screen";
    context.globalAlpha = (1 - eased) * .55;
    context.filter = "sepia(1) saturate(12) hue-rotate(300deg)";
    context.drawImage(layerCanvas, -offset, 0);
    context.filter = "sepia(1) saturate(12) hue-rotate(120deg)";
    context.drawImage(layerCanvas, offset, 0);
  } else {
    context.drawImage(layerCanvas, 0, 0);
  }

  if (effect === "flash-white" || effect === "flash-black") {
    context.globalAlpha = Math.min(1, .2 + eased);
    context.drawImage(layerCanvas, 0, 0);
    context.globalAlpha = (1 - eased) * .92;
    context.fillStyle = effect === "flash-white" ? "#fff" : "#000";
    context.fillRect(0, 0, width, height);
  }
  context.restore();
}
