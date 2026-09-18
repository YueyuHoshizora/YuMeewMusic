import { spectrum } from "./visualizer.js";

// Scene animations are narrative/character canvas illustrations driven by the music,
// not the audio-reactive geometric rhythm styles used on the main studio screen.
// Every frame is a pure function of (t, buffer, settings) so seeking and export stay
// consistent, matching the determinism rule used by js/visualizer.js.
export const SCENES = Object.freeze(["貓咪追球", "煙火慶典", "音符雨"]);

// Deterministic pseudo-random in [0, 1) from an integer seed; used instead of Math.random()
// so bursts/notes/positions never change between preview scrubbing and the final export.
function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function energyOf(buffer, t, from = 0, to = 64) {
  const values = spectrum(buffer, t);
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i];
  return sum / (to - from);
}

function hexToRgb(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!match) return { r: 126, g: 224, b: 255 };
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyDarkness(ctx, w, h, darkness) {
  ctx.fillStyle = `rgba(0, 0, 0, ${(Math.max(0, Math.min(100, darkness || 0)) / 100) * 0.85})`;
  ctx.fillRect(0, 0, w, h);
}

function drawCat(ctx, x, y, scale, tailWag) {
  const orange = "#e07a2f", dark = "#c45a18", cream = "#f4b48a", ink = "#2a2018";
  const p = (dx, dy) => [x + dx * scale, y + dy * scale];
  ctx.save();
  // Tail: wags faster and higher with the music's energy.
  ctx.strokeStyle = orange;
  ctx.lineWidth = 11 * scale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(...p(-48, 6));
  ctx.quadraticCurveTo(...p(-78, -14 - tailWag * 16), ...p(-60, -44 - tailWag * 6));
  ctx.stroke();
  // Body.
  ctx.fillStyle = orange;
  ctx.beginPath();
  ctx.ellipse(...p(-4, 20), 46 * scale, 30 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 4 * scale;
  ctx.beginPath();
  ctx.moveTo(...p(-24, 6));
  ctx.quadraticCurveTo(...p(-10, -2), ...p(4, 10));
  ctx.stroke();
  // Legs.
  ctx.fillStyle = orange;
  for (const dx of [-32, -6, 20]) {
    ctx.beginPath();
    ctx.ellipse(...p(dx, 44), 10 * scale, 15 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Head.
  ctx.beginPath();
  ctx.ellipse(...p(38, -10), 27 * scale, 23 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(...p(20, -26));
  ctx.lineTo(...p(16, -54));
  ctx.lineTo(...p(36, -30));
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(...p(52, -28));
  ctx.lineTo(...p(62, -54));
  ctx.lineTo(...p(68, -22));
  ctx.fill();
  ctx.fillStyle = cream;
  ctx.beginPath();
  ctx.moveTo(...p(22, -28));
  ctx.lineTo(...p(20, -46));
  ctx.lineTo(...p(32, -30));
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(...p(54, -30));
  ctx.lineTo(...p(60, -46));
  ctx.lineTo(...p(64, -24));
  ctx.fill();
  // Face.
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.ellipse(...p(34, -14), 3.4 * scale, 4.4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(...p(50, -14), 3.4 * scale, 4.4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(...p(33, -16), 1.2 * scale, 1.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(...p(49, -16), 1.2 * scale, 1.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f2a0b0";
  ctx.beginPath();
  ctx.ellipse(...p(42, -4), 3.2 * scale, 2.4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.6 * scale;
  for (const [sx, sy, ex, ey] of [[36, -2, 16, -8], [36, 0, 16, 4], [58, -2, 78, -8], [58, 0, 78, 4]]) {
    ctx.beginPath();
    ctx.moveTo(...p(sx, sy));
    ctx.lineTo(...p(ex, ey));
    ctx.stroke();
  }
  ctx.restore();
}

function sceneCatChase(ctx, w, h, t, buffer, settings) {
  const energy = energyOf(buffer, t, 0, 24);
  const gain = 0.5 + (Math.max(0, Math.min(100, settings.strength ?? 60)) / 100) * 1.3;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#f7e7c6");
  sky.addColorStop(1, "#e8c48a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#d9b06a";
  ctx.fillRect(0, h * 0.72, w, h * 0.28);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  for (let i = 0; i < 14; i++) {
    const cx = ((i * 173 + t * 6) % (w + 40)) - 20;
    const cy = 30 + ((i * 91) % (h * 0.28));
    const r = 7 + (i % 5);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const cycle = (t * 0.16) % 1;
  const catX = w * 0.08 + cycle * w * 0.72;
  const ballX = catX + w * 0.1;
  const bounce = Math.abs(Math.sin(t * 5.4)) * h * 0.05 * gain * (0.5 + energy);
  const ballY = h * 0.62 - bounce;
  const catY = h * 0.58 + Math.sin(t * 9) * h * 0.008;
  const tailWag = 0.4 + Math.sin(t * 8) * 0.3 + energy * 0.5;
  ctx.fillStyle = "rgba(120, 75, 30, 0.25)";
  ctx.beginPath();
  ctx.ellipse(catX + w * 0.02, h * 0.78, w * 0.05, h * 0.012, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(ballX, h * 0.775, w * 0.018, h * 0.006, 0, 0, Math.PI * 2);
  ctx.fill();
  const ballR = h * 0.036;
  ctx.save();
  ctx.translate(ballX, ballY);
  ctx.rotate(t * 6);
  const ballFill = ctx.createRadialGradient(-ballR * 0.3, -ballR * 0.3, ballR * 0.15, 0, 0, ballR);
  ballFill.addColorStop(0, withAlpha(settings.color, 0.95));
  ballFill.addColorStop(1, withAlpha(settings.color, 0.55));
  ctx.fillStyle = ballFill;
  ctx.beginPath();
  ctx.arc(0, 0, ballR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = ballR * 0.1;
  ctx.beginPath();
  ctx.arc(0, 0, ballR * 0.55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  drawCat(ctx, catX, catY, h / 480, tailWag);
}

function drawFirework(ctx, x, apexY, groundY, localT, color, energy) {
  const riseDuration = 0.55;
  if (localT < riseDuration) {
    const progress = localT / riseDuration;
    const y = groundY - (groundY - apexY) * progress;
    ctx.strokeStyle = withAlpha(color, 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + 14);
    ctx.lineTo(x, y);
    ctx.stroke();
    return;
  }
  const burstT = localT - riseDuration;
  const life = 0.9;
  if (burstT > life) return;
  const fade = 1 - burstT / life;
  const particles = 26;
  const radius = burstT * 210 * (0.6 + energy);
  for (let i = 0; i < particles; i++) {
    const angle = (i / particles) * Math.PI * 2 + i * 0.13;
    const drift = burstT * burstT * 60;
    const px = x + Math.cos(angle) * radius;
    const py = apexY + Math.sin(angle) * radius * 0.85 + drift;
    ctx.fillStyle = withAlpha(color, Math.max(0, fade));
    ctx.beginPath();
    ctx.arc(px, py, 2.6 * fade + 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function sceneFireworks(ctx, w, h, t, buffer, settings) {
  const energy = energyOf(buffer, t, 0, 20);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#050414");
  sky.addColorStop(1, "#12102b");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    const sx = hash(i) * w;
    const sy = hash(i + 500) * h * 0.7;
    const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * (1 + hash(i + 900) * 2) + i));
    ctx.fillStyle = `rgba(255,255,255,${0.5 * twinkle})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const palette = [settings.color, "#ff6b6b", "#ffd166", "#7ee0ff", "#c792ea"];
  const interval = 1.15;
  const groundY = h * 0.98;
  const firstIndex = Math.max(0, Math.floor(t / interval) - 2);
  for (let k = firstIndex; k <= Math.floor(t / interval) + 1; k++) {
    const burstStart = k * interval;
    const localT = t - burstStart;
    if (localT < 0 || localT > 1.6) continue;
    const x = (0.15 + hash(k) * 0.7) * w;
    const apexY = h * (0.18 + hash(k + 1) * 0.28);
    const color = palette[k % palette.length];
    drawFirework(ctx, x, apexY, groundY, localT, color, energy);
  }
  ctx.fillStyle = "#0a0a18";
  ctx.fillRect(0, h * 0.9, w, h * 0.1);
}

function drawNote(ctx, x, y, size, rotation, color, opacity) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, size * 0.9, size * 0.55, size * 0.4, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-size * 0.02, -size * 1.6, size * 0.12, size * 2.5);
  ctx.beginPath();
  ctx.moveTo(size * 0.1, -size * 1.6);
  ctx.quadraticCurveTo(size * 0.9, -size * 1.3, size * 0.75, -size * 0.5);
  ctx.quadraticCurveTo(size * 0.55, -size * 1.0, size * 0.1, -size * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function sceneNoteRain(ctx, w, h, t, buffer, settings) {
  const energy = energyOf(buffer, t, 4, 40);
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, withAlpha(settings.color, 0.16));
  bg.addColorStop(1, "#0c1220");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const count = 22;
  for (let i = 0; i < count; i++) {
    const speed = 60 + hash(i) * 60;
    const size = h * (0.02 + hash(i + 300) * 0.02) * (1 + energy * 0.6);
    const columnX = (hash(i + 100) * 0.9 + 0.05) * w;
    const drift = Math.sin(t * 0.8 + i) * w * 0.03;
    const y = ((t * speed + hash(i + 200) * h * 2) % (h + size * 4)) - size * 2;
    const rotation = Math.sin(t * 1.4 + i) * 0.3;
    const opacity = 0.55 + energy * 0.45;
    drawNote(ctx, columnX + drift, y, size, rotation, withAlpha(settings.color, 1), Math.min(1, opacity));
  }
}

const SCENE_DRAWERS = [sceneCatChase, sceneFireworks, sceneNoteRain];

// Finds the storyboard card covering time t, falling back to the last card so a frame
// requested slightly past the final card's end (rounding) still renders something.
function segmentAt(storyboard, t) {
  if (!Array.isArray(storyboard) || !storyboard.length) return null;
  return storyboard.find((card) => t >= card.start && t < card.end) || storyboard[storyboard.length - 1];
}

// Reference image/character composites as a framed photo prop in the corner, independent
// of which scene is drawing underneath, so any storyboard card can cameo a reference
// picture or a saved character without every scene needing its own image-handling code.
function drawReferenceOverlay(ctx, w, h, image) {
  if (!image) return;
  const unit = Math.min(w, h);
  const frame = unit * 0.24;
  const margin = unit * 0.035;
  const x = w - frame - margin;
  const y = h - frame - margin;
  const sourceWidth = image.width, sourceHeight = image.height;
  const crop = Math.min(sourceWidth, sourceHeight);
  ctx.save();
  ctx.translate(x + frame / 2, y + frame / 2);
  ctx.rotate(-0.05);
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = unit * 0.02;
  ctx.fillStyle = "#fdfdfb";
  ctx.fillRect(-frame / 2, -frame / 2, frame, frame);
  ctx.shadowBlur = 0;
  const padding = frame * 0.07;
  const photo = frame - padding * 2;
  ctx.drawImage(
    image,
    (sourceWidth - crop) / 2, (sourceHeight - crop) / 2, crop, crop,
    -frame / 2 + padding, -frame / 2 + padding, photo, photo * 0.86,
  );
  ctx.restore();
}

/** Signature matches js/visualizer.js draw(); passed to encodeMedia as drawFrame. */
export function drawMvScene(canvas, t, buffer, image, settings) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const segment = segmentAt(settings.storyboard, t);
  const drawer = SCENE_DRAWERS[segment?.scene ?? 0] || SCENE_DRAWERS[0];
  const sceneSettings = segment ? { ...settings, color: segment.color } : settings;
  drawer(ctx, w, h, t, buffer, sceneSettings);
  applyDarkness(ctx, w, h, settings.darkness);
  drawReferenceOverlay(ctx, w, h, segment?.resolvedImage);
}
