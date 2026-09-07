import { STYLES } from "./styles.js";
import { THEMES } from "./themes.js";
import { FORMATS } from "./formats.js";
const KEY = "yumeew.settings.v1";
export const DEFAULT_SETTINGS = Object.freeze({
  style: 0,
  color: "#c5fa75",
  strength: 70,
  darkness: 45,
  positionX: 0,
  positionY: 0,
  resolution: "1080",
  fps: "30",
  format: "mp4",
  mode: "dark",
  theme: "lime",
});

// Explicit allowlist: media, file names, object URLs and playback state are never persisted.
export function validateSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const result = { ...DEFAULT_SETTINGS };
  if (Number.isInteger(source.style) && source.style >= 0 && source.style < STYLES.length)
    result.style = source.style;
  if (typeof source.color === "string" && /^#[0-9a-f]{6}$/i.test(source.color))
    result.color = source.color.toLowerCase();
  for (const key of ["strength", "darkness"]) {
    if (
      typeof source[key] === "number" &&
      Number.isFinite(source[key]) &&
      source[key] >= 0 &&
      source[key] <= 100
    )
      result[key] = source[key];
  }
  for (const key of ["positionX", "positionY"]) {
    if (typeof source[key] === "number" && Number.isFinite(source[key]) && source[key] >= -50 && source[key] <= 50)
      result[key] = source[key];
  }
  if (["720", "1080"].includes(source.resolution)) result.resolution = source.resolution;
  if (["30", "60"].includes(source.fps)) result.fps = source.fps;
  if (typeof source.format === "string" && Object.hasOwn(FORMATS, source.format))
    result.format = source.format;
  if (["light", "dark"].includes(source.mode)) result.mode = source.mode;
  if (typeof source.theme === "string" && Object.hasOwn(THEMES, source.theme))
    result.theme = source.theme;
  return result;
}

export function loadSettings(getStorage = () => window.localStorage) {
  try {
    return validateSettings(JSON.parse(getStorage().getItem(KEY)));
  } catch {
    // Corrupt data or blocked browser storage must not prevent opening the editor.
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, getStorage = () => window.localStorage) {
  try {
    const storage = getStorage();
    const serialized = JSON.stringify(validateSettings(settings));
    if (storage.getItem(KEY) !== serialized) storage.setItem(KEY, serialized);
    return true;
  } catch {
    return false;
  }
}
