import { spectrum } from "./visualizer.js";

// Each MV storyboard card carries a "scene spec" — a small structured description of a
// 2.5D parallax illustration (sky/ground/character/prop layers, a camera movement, and an
// optional particle effect) produced either by the AI scene generator
// (inspiration-chat's POST /api/mv-scene/generate, see js/mv-animation.js) or, when that
// call is unavailable, by fallbackSceneSpec() below using local keyword matching. Both
// sources produce the exact same shape so this renderer never needs to know which one it
// is drawing — that is the point of constraining the AI's JSON Schema to this vocabulary.
//
// Every frame is a pure function of (t, buffer, spec); positions use a fixed hash instead
// of Math.random() so seeking and export stay frame-identical, matching the determinism
// rule used by js/visualizer.js.

const LAYER_KINDS = Object.freeze(["sky", "sun", "moon", "cloud", "mountain", "building", "tree", "ground", "water", "character", "prop", "text"]);
const LAYER_SHAPES = Object.freeze(["circle", "rect", "triangle", "blob"]);
const LAYER_MOTIONS = Object.freeze(["none", "drift_left", "drift_right", "bob", "pulse", "rise", "fall", "orbit"]);
const CAMERA_MOVEMENTS = Object.freeze(["static", "pan_left", "pan_right", "pan_up", "pan_down", "zoom_in", "zoom_out", "dolly_in", "dolly_out", "tilt"]);
const PARTICLE_TYPES = Object.freeze(["none", "rain", "snow", "confetti", "fireworks", "notes", "hearts", "sparkle"]);

function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function wrap01(v) {
  return ((v % 1) + 1) % 1;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
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

// ---- 場景規格（AI 生成或本機備援模板皆共用這個形狀）----

/** A syntactically valid empty-ish spec used when nothing else is available yet. */
export function emptySceneSpec() {
  return {
    palette: { sky_top: "#1c2333", sky_bottom: "#4a5578", accent: "#7ee0ff" },
    camera: { movement: "static", intensity: 0.2 },
    layers: [],
    particles: { type: "none", density: 0, color: "#ffffff" },
    mood: "",
  };
}

const FALLBACK_TEMPLATES = [
  {
    keywords: ["貓", "狗", "寵物", "追", "球", "動物"],
    mood: "活潑",
    build: (accent) => ({
      palette: { sky_top: "#ffd9a0", sky_bottom: "#ff9f68", accent },
      camera: { movement: "pan_right", intensity: 0.35 },
      layers: [
        { kind: "sun", shape: "circle", x: 0.82, y: 0.18, width: 0.16, height: 0.16, color: "#ffe07a", depth: 0.1, motion: "none", speed: 0, label: null },
        { kind: "cloud", shape: "blob", x: 0.25, y: 0.15, width: 0.22, height: 0.08, color: "#fff0d8", depth: 0.15, motion: "drift_left", speed: 0.2, label: null },
        { kind: "ground", shape: "rect", x: 0.5, y: 0.86, width: 1.1, height: 0.28, color: "#c98a4b", depth: 0.3, motion: "none", speed: 0, label: null },
        { kind: "prop", shape: "circle", x: 0.62, y: 0.78, width: 0.06, height: 0.06, color: accent, depth: 0.8, motion: "bob", speed: 0.9, label: null },
        { kind: "character", shape: "blob", x: 0.32, y: 0.74, width: 0.16, height: 0.12, color: "#e8863c", depth: 0.9, motion: "bob", speed: 0.7, label: null },
      ],
      particles: { type: "sparkle", density: 0.25, color: "#fff3d6" },
    }),
  },
  {
    keywords: ["煙火", "煙花", "慶典", "跨年", "派對", "祭典"],
    mood: "歡慶",
    build: (accent) => ({
      palette: { sky_top: "#0a0f24", sky_bottom: "#2a1f4a", accent },
      camera: { movement: "zoom_in", intensity: 0.3 },
      layers: [
        { kind: "moon", shape: "circle", x: 0.2, y: 0.16, width: 0.09, height: 0.09, color: "#f4f1de", depth: 0.05, motion: "none", speed: 0, label: null },
        { kind: "building", shape: "rect", x: 0.18, y: 0.82, width: 0.16, height: 0.3, color: "#1c1f33", depth: 0.4, motion: "none", speed: 0, label: null },
        { kind: "building", shape: "rect", x: 0.82, y: 0.8, width: 0.2, height: 0.34, color: "#141726", depth: 0.4, motion: "none", speed: 0, label: null },
        { kind: "ground", shape: "rect", x: 0.5, y: 0.95, width: 1.2, height: 0.12, color: "#0d0f1c", depth: 0.35, motion: "none", speed: 0, label: null },
      ],
      particles: { type: "fireworks", density: 0.55, color: accent },
    }),
  },
  {
    keywords: ["雨", "憂鬱", "傷心", "眼淚", "孤單", "陰天"],
    mood: "憂鬱",
    build: (accent) => ({
      palette: { sky_top: "#232c3d", sky_bottom: "#4a5568", accent },
      camera: { movement: "static", intensity: 0.15 },
      layers: [
        { kind: "cloud", shape: "blob", x: 0.3, y: 0.16, width: 0.34, height: 0.12, color: "#5b6478", depth: 0.1, motion: "drift_left", speed: 0.1, label: null },
        { kind: "building", shape: "rect", x: 0.5, y: 0.72, width: 0.9, height: 0.5, color: "#2b3142", depth: 0.5, motion: "none", speed: 0, label: null },
        { kind: "character", shape: "blob", x: 0.5, y: 0.86, width: 0.08, height: 0.16, color: accent, depth: 0.9, motion: "none", speed: 0, label: null },
      ],
      particles: { type: "rain", density: 0.6, color: "#9db4d8" },
    }),
  },
  {
    keywords: ["雪", "冬天", "聖誕", "冰"],
    mood: "寧靜",
    build: (accent) => ({
      palette: { sky_top: "#dfe9f5", sky_bottom: "#b9cbe0", accent },
      camera: { movement: "pan_up", intensity: 0.2 },
      layers: [
        { kind: "mountain", shape: "triangle", x: 0.25, y: 0.7, width: 0.5, height: 0.3, color: "#ffffff", depth: 0.2, motion: "none", speed: 0, label: null },
        { kind: "mountain", shape: "triangle", x: 0.7, y: 0.75, width: 0.55, height: 0.35, color: "#eef3fb", depth: 0.25, motion: "none", speed: 0, label: null },
        { kind: "tree", shape: "triangle", x: 0.15, y: 0.86, width: 0.1, height: 0.2, color: "#2f5d42", depth: 0.6, motion: "none", speed: 0, label: null },
        { kind: "ground", shape: "rect", x: 0.5, y: 0.94, width: 1.2, height: 0.14, color: "#f4f8ff", depth: 0.3, motion: "none", speed: 0, label: null },
      ],
      particles: { type: "snow", density: 0.5, color: "#ffffff" },
    }),
  },
  {
    keywords: ["海", "沙灘", "日落", "夕陽", "浪", "海邊"],
    mood: "溫暖",
    build: (accent) => ({
      palette: { sky_top: "#ff9d6c", sky_bottom: "#ffd97a", accent },
      camera: { movement: "dolly_in", intensity: 0.25 },
      layers: [
        { kind: "sun", shape: "circle", x: 0.5, y: 0.55, width: 0.22, height: 0.22, color: "#ffdf8f", depth: 0.1, motion: "none", speed: 0, label: null },
        { kind: "water", shape: "rect", x: 0.5, y: 0.78, width: 1.2, height: 0.35, color: "#3f7ea6", depth: 0.4, motion: "bob", speed: 0.2, label: null },
        { kind: "ground", shape: "rect", x: 0.5, y: 0.96, width: 1.2, height: 0.14, color: "#e8cf9c", depth: 0.7, motion: "none", speed: 0, label: null },
      ],
      particles: { type: "sparkle", density: 0.3, color: accent },
    }),
  },
  {
    keywords: ["城市", "演唱會", "舞台", "霓虹", "夜景", "都市"],
    mood: "熱鬧",
    build: (accent) => ({
      palette: { sky_top: "#0b0d1c", sky_bottom: "#1c1440", accent },
      camera: { movement: "pan_left", intensity: 0.3 },
      layers: [
        { kind: "building", shape: "rect", x: 0.15, y: 0.8, width: 0.18, height: 0.35, color: "#221b3d", depth: 0.35, motion: "none", speed: 0, label: null },
        { kind: "building", shape: "rect", x: 0.4, y: 0.75, width: 0.2, height: 0.45, color: "#2a1f4f", depth: 0.4, motion: "none", speed: 0, label: null },
        { kind: "building", shape: "rect", x: 0.68, y: 0.78, width: 0.22, height: 0.4, color: "#241a48", depth: 0.4, motion: "none", speed: 0, label: null },
        { kind: "prop", shape: "circle", x: 0.5, y: 0.86, width: 0.05, height: 0.05, color: accent, depth: 0.85, motion: "pulse", speed: 1.2, label: null },
      ],
      particles: { type: "sparkle", density: 0.4, color: accent },
    }),
  },
  {
    keywords: ["愛", "浪漫", "告白", "戀愛", "心", "喜歡"],
    mood: "浪漫",
    build: (accent) => ({
      palette: { sky_top: "#3a2140", sky_bottom: "#7a3f66", accent },
      camera: { movement: "zoom_in", intensity: 0.2 },
      layers: [
        { kind: "moon", shape: "circle", x: 0.78, y: 0.2, width: 0.1, height: 0.1, color: "#ffe8f2", depth: 0.1, motion: "none", speed: 0, label: null },
        { kind: "character", shape: "blob", x: 0.4, y: 0.82, width: 0.1, height: 0.18, color: accent, depth: 0.85, motion: "bob", speed: 0.4, label: null },
        { kind: "character", shape: "blob", x: 0.58, y: 0.82, width: 0.1, height: 0.18, color: "#f4b8d8", depth: 0.85, motion: "bob", speed: 0.4, label: null },
      ],
      particles: { type: "hearts", density: 0.35, color: "#ff9dc4" },
    }),
  },
];

const DEFAULT_TEMPLATE = {
  mood: "平靜",
  build: (accent) => ({
    palette: { sky_top: "#243447", sky_bottom: "#5a7291", accent },
    camera: { movement: "pan_right", intensity: 0.2 },
    layers: [
      { kind: "sun", shape: "circle", x: 0.75, y: 0.22, width: 0.14, height: 0.14, color: "#ffe9a8", depth: 0.1, motion: "none", speed: 0, label: null },
      { kind: "cloud", shape: "blob", x: 0.3, y: 0.18, width: 0.24, height: 0.09, color: "#f4f7ff", depth: 0.15, motion: "drift_left", speed: 0.15, label: null },
      { kind: "mountain", shape: "triangle", x: 0.5, y: 0.72, width: 0.7, height: 0.3, color: "#3d5a72", depth: 0.35, motion: "none", speed: 0, label: null },
      { kind: "ground", shape: "rect", x: 0.5, y: 0.94, width: 1.2, height: 0.14, color: "#33465a", depth: 0.5, motion: "none", speed: 0, label: null },
    ],
    particles: { type: "none", density: 0, color: "#ffffff" },
  }),
};

/**
 * Deterministic, offline keyword-matched scene spec for when the AI scene generator
 * (js/mv-animation.js's callMvSceneGenerator) is unavailable, rate-limited, or returns an
 * unparsable/invalid result. Shares the exact same output shape as the AI schema so
 * drawMvScene() never has to special-case which source produced a card's spec.
 */
export function fallbackSceneSpec(description = "", accent = "#7ee0ff") {
  const text = String(description || "");
  const template = FALLBACK_TEMPLATES.find((entry) => entry.keywords.some((word) => text.includes(word))) || DEFAULT_TEMPLATE;
  const spec = template.build(accent);
  spec.mood = template.mood;
  return spec;
}

/** True when every layer/enum in a parsed AI response matches the vocabulary this renderer understands. */
export function isValidSceneSpec(spec) {
  if (!spec || typeof spec !== "object") return false;
  const { palette, camera, layers, particles } = spec;
  const isHex = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  if (!palette || !isHex(palette.sky_top) || !isHex(palette.sky_bottom) || !isHex(palette.accent)) return false;
  if (!camera || !CAMERA_MOVEMENTS.includes(camera.movement) || typeof camera.intensity !== "number") return false;
  if (!Array.isArray(layers) || layers.length > 12) return false;
  for (const layer of layers) {
    if (!layer || !LAYER_KINDS.includes(layer.kind) || !LAYER_SHAPES.includes(layer.shape) || !LAYER_MOTIONS.includes(layer.motion)) return false;
    if (![layer.x, layer.y, layer.width, layer.height, layer.depth, layer.speed].every((value) => typeof value === "number")) return false;
    if (!isHex(layer.color)) return false;
  }
  if (!particles || !PARTICLE_TYPES.includes(particles.type) || typeof particles.density !== "number" || !isHex(particles.color)) return false;
  return true;
}

// ---- 渲染 ----

function cameraState(camera, localT) {
  const intensity = clamp01(camera?.intensity ?? 0.2);
  const centered = localT - 0.5;
  const state = { panX: 0, panY: 0, scale: 1, rotate: 0 };
  switch (camera?.movement) {
    case "pan_left": state.panX = centered * intensity; break;
    case "pan_right": state.panX = -centered * intensity; break;
    case "pan_up": state.panY = centered * intensity; break;
    case "pan_down": state.panY = -centered * intensity; break;
    case "zoom_in": state.scale = 1 + intensity * localT * 0.6; break;
    case "zoom_out": state.scale = 1 + intensity * (1 - localT) * 0.6; break;
    case "dolly_in": state.scale = 1 + intensity * localT * 0.4; state.panY = -intensity * localT * 0.05; break;
    case "dolly_out": state.scale = 1 + intensity * (1 - localT) * 0.4; state.panY = intensity * (1 - localT) * 0.05; break;
    case "tilt": state.rotate = centered * intensity * 0.2; break;
    default: break;
  }
  return state;
}

function layerMotionOffset(layer, t, seed) {
  const speed = Math.max(0, layer.speed || 0);
  const phase = hash(seed) * Math.PI * 2;
  switch (layer.motion) {
    case "drift_left": return { dx: -wrap01(t * speed * 0.03) * 0.3, dy: 0, scale: 1 };
    case "drift_right": return { dx: wrap01(t * speed * 0.03) * 0.3, dy: 0, scale: 1 };
    case "bob": return { dx: 0, dy: Math.sin(t * 2.2 * speed + phase) * 0.02, scale: 1 };
    case "pulse": return { dx: 0, dy: 0, scale: 1 + Math.sin(t * 3 * speed + phase) * 0.15 };
    case "rise": return { dx: 0, dy: -wrap01(t * speed * 0.08 + hash(seed + 1)) * 0.9, scale: 1 };
    case "fall": return { dx: 0, dy: wrap01(t * speed * 0.08 + hash(seed + 1)) * 0.9, scale: 1 };
    case "orbit": return { dx: Math.cos(t * speed + phase) * 0.03, dy: Math.sin(t * speed + phase) * 0.03, scale: 1 };
    default: return { dx: 0, dy: 0, scale: 1 };
  }
}

function drawLayerShape(ctx, shape, cx, cy, w, h, color, seed) {
  ctx.fillStyle = color;
  if (shape === "circle") {
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (shape === "triangle") {
    ctx.beginPath();
    ctx.moveTo(cx, cy - h / 2);
    ctx.lineTo(cx - w / 2, cy + h / 2);
    ctx.lineTo(cx + w / 2, cy + h / 2);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (shape === "blob") {
    const points = 8;
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const wobble = 0.75 + hash(seed * 97 + i) * 0.4;
      const px = cx + Math.cos(angle) * (w / 2) * wobble;
      const py = cy + Math.sin(angle) * (h / 2) * wobble;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    return;
  }
  // rect (default)
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
}

function drawLayer(ctx, layer, index, w, h, t, energy) {
  const motion = layerMotionOffset(layer, t, index + 1);
  const cx = (layer.x + motion.dx) * w;
  const cy = (layer.y + motion.dy) * h;
  const boost = layer.kind === "character" || layer.kind === "prop" ? 1 + energy * 0.25 : 1;
  const lw = layer.width * w * motion.scale * boost;
  const lh = layer.height * h * motion.scale * boost;

  if (layer.kind === "sun" || layer.kind === "moon") {
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(lw, lh));
    glow.addColorStop(0, withAlpha(layer.color, 0.9));
    glow.addColorStop(1, withAlpha(layer.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(lw, lh), 0, Math.PI * 2);
    ctx.fill();
  }

  drawLayerShape(ctx, layer.shape, cx, cy, lw, lh, layer.color, index + 1);

  if (layer.kind === "character") {
    const headRadius = lw * 0.28;
    ctx.beginPath();
    ctx.ellipse(cx, cy - lh / 2 - headRadius * 0.6, headRadius, headRadius, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1a1a";
    const eyeOffset = headRadius * 0.35;
    ctx.beginPath();
    ctx.ellipse(cx - eyeOffset, cy - lh / 2 - headRadius * 0.6, headRadius * 0.12, headRadius * 0.12, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + eyeOffset, cy - lh / 2 - headRadius * 0.6, headRadius * 0.12, headRadius * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (layer.kind === "text" && layer.label) {
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.max(14, lh)}px "Noto Sans TC", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(layer.label, cx, cy);
  } else if (layer.label) {
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.max(11, lh * 0.3)}px "Noto Sans TC", sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(layer.label, cx, cy + lh / 2 + 14);
  }
}

function drawHeart(ctx, x, y, size, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.3);
  ctx.bezierCurveTo(x, y, x - size / 2, y, x - size / 2, y + size * 0.3);
  ctx.bezierCurveTo(x - size / 2, y + size * 0.6, x, y + size * 0.8, x, y + size);
  ctx.bezierCurveTo(x, y + size * 0.8, x + size / 2, y + size * 0.6, x + size / 2, y + size * 0.3);
  ctx.bezierCurveTo(x + size / 2, y, x, y, x, y + size * 0.3);
  ctx.fill();
  ctx.restore();
}

function drawNoteGlyph(ctx, x, y, size, rotation, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, size * 0.6, size * 0.32, size * 0.22, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(size * 0.28, -size * 0.9, size * 0.08, size * 1.5);
  ctx.restore();
}

function drawParticles(ctx, w, h, t, particles, energy) {
  const density = clamp01(particles?.density ?? 0);
  if (!particles || particles.type === "none" || density <= 0) return;
  const color = particles.color;

  if (particles.type === "fireworks") {
    const burstCount = Math.round(2 + density * 5);
    for (let b = 0; b < burstCount; b++) {
      const period = 1.6 - density * 0.6;
      const seed = b * 31.7;
      const cycle = t / period + hash(seed) * 5;
      const localT = wrap01(cycle);
      if (localT > 0.7) continue;
      const burstX = (0.15 + hash(seed + 1) * 0.7) * w;
      const burstY = (0.15 + hash(seed + 2) * 0.35) * h;
      const life = localT / 0.7;
      const radius = life * (60 + hash(seed + 3) * 80) * (0.6 + energy);
      const sparks = 14;
      for (let i = 0; i < sparks; i++) {
        const angle = (i / sparks) * Math.PI * 2 + hash(seed + i) * 0.3;
        const px = burstX + Math.cos(angle) * radius;
        const py = burstY + Math.sin(angle) * radius + life * life * 40;
        ctx.fillStyle = withAlpha(color, Math.max(0, 1 - life) * 0.9);
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return;
  }

  const count = Math.round(12 + density * 90);
  for (let i = 0; i < count; i++) {
    const seedX = hash(i * 7.13 + 1);
    const seedY = hash(i * 13.71 + 2);
    const speedSeed = 0.4 + hash(i * 3.31 + 3) * 0.8;

    if (particles.type === "rain") {
      const y = wrap01(seedY + t * speedSeed * 1.4) * h;
      const x = seedX * w - y * 0.15;
      ctx.strokeStyle = withAlpha(color, 0.5);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 5, y + 16);
      ctx.stroke();
    } else if (particles.type === "snow") {
      const y = wrap01(seedY + t * speedSeed * 0.25) * h;
      const x = (seedX + Math.sin(t * 0.6 + i) * 0.02) * w;
      ctx.fillStyle = withAlpha(color, 0.8);
      ctx.beginPath();
      ctx.arc(x, y, 2 + hash(i) * 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (particles.type === "confetti") {
      const y = wrap01(seedY + t * speedSeed * 0.4) * h;
      const x = (seedX + Math.sin(t * 0.8 + i * 2) * 0.05) * w;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * 3 + i);
      ctx.fillStyle = withAlpha(i % 2 === 0 ? color : "#ffffff", 0.85);
      ctx.fillRect(-3, -5, 6, 10);
      ctx.restore();
    } else if (particles.type === "sparkle") {
      const x = seedX * w;
      const y = seedY * h;
      const twinkle = (Math.sin(t * 3 + i * 5) + 1) / 2;
      ctx.fillStyle = withAlpha(color, twinkle * 0.7 * (0.5 + energy));
      ctx.beginPath();
      ctx.arc(x, y, 1.6 + twinkle * 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (particles.type === "notes") {
      const y = (1 - wrap01(seedY + t * speedSeed * 0.18)) * h;
      const x = (seedX + Math.sin(t * 0.5 + i) * 0.04) * w;
      drawNoteGlyph(ctx, x, y, 16 + hash(i) * 8, Math.sin(t + i) * 0.3, color, 0.85);
    } else if (particles.type === "hearts") {
      const y = (1 - wrap01(seedY + t * speedSeed * 0.15)) * h;
      const x = (seedX + Math.sin(t * 0.4 + i) * 0.05) * w;
      drawHeart(ctx, x, y, 10 + hash(i) * 10, color, 0.85);
    }
  }
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

// Finds the storyboard card covering time t, falling back to the last card so a frame
// requested slightly past the final card's end (rounding) still renders something.
function segmentAt(storyboard, t) {
  if (!Array.isArray(storyboard) || !storyboard.length) return null;
  return storyboard.find((card) => t >= card.start && t < card.end) || storyboard[storyboard.length - 1];
}

function drawScene(ctx, w, h, t, buffer, segment, strength) {
  const spec = (segment?.spec && isValidSceneSpec(segment.spec)) ? segment.spec : fallbackSceneSpec(segment?.description, segment?.accent || "#7ee0ff");
  const energy = energyOf(buffer, t) * clamp01((strength ?? 60) / 60);
  const duration = Math.max(0.001, (segment?.end ?? 1) - (segment?.start ?? 0));
  const localT = clamp01(((t - (segment?.start ?? 0)) / duration));

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, spec.palette.sky_top);
  g.addColorStop(1, spec.palette.sky_bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const camera = cameraState(spec.camera, localT);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(camera.rotate);
  ctx.scale(camera.scale, camera.scale);
  ctx.translate(-w / 2, -h / 2);

  const layers = [...spec.layers].sort((a, b) => a.depth - b.depth);
  layers.forEach((layer, index) => {
    ctx.save();
    const parallax = 0.2 + clamp01(layer.depth) * 0.8;
    ctx.translate(camera.panX * w * parallax, camera.panY * h * parallax);
    drawLayer(ctx, layer, index, w, h, t, energy);
    ctx.restore();
  });
  ctx.restore();

  drawParticles(ctx, w, h, t, spec.particles, energy);
}

/** Signature matches js/visualizer.js draw(); passed to encodeMedia as drawFrame. */
export function drawMvScene(canvas, t, buffer, image, settings) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const segment = segmentAt(settings.storyboard, t);
  drawScene(ctx, w, h, t, buffer, segment, settings.strength);
  applyDarkness(ctx, w, h, settings.darkness);
  drawReferenceOverlay(ctx, w, h, segment?.resolvedImage);
}
