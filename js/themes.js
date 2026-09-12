export const THEMES = Object.freeze({
  lime: { name: "青檸", dark: "#c5fa75", light: "#3b6812" },
  ocean: { name: "海藍", dark: "#72d9ff", light: "#006586" },
  violet: { name: "紫羅蘭", dark: "#c3adff", light: "#7040b0" },
  rose: { name: "玫瑰", dark: "#ffa6be", light: "#ae2852" },
  amber: { name: "琥珀", dark: "#ffd078", light: "#895200" },
  mint: { name: "薄荷", dark: "#73f5bd", light: "#08784f" },
  indigo: { name: "靛青", dark: "#aab9ff", light: "#3e4da1" },
  coral: { name: "珊瑚", dark: "#ffae91", light: "#9c3f22" },
  magenta: { name: "洋紅", dark: "#f5a3ef", light: "#922786" },
  silver: { name: "銀灰", dark: "#cbd5e1", light: "#475569" },
});

// Interface-only CSS properties: never mutate renderer or export settings.
export function applyTheme(mode, theme, root = document.documentElement) {
  const safeMode = mode === "light" ? "light" : "dark";
  const safeTheme = Object.hasOwn(THEMES, theme) ? theme : "lime";
  root.dataset.mode = safeMode;
  root.dataset.theme = safeTheme;
  root.style.setProperty("--primary", THEMES[safeTheme][safeMode]);
}
