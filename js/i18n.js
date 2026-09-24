export const LOCALES = Object.freeze({
  "zh-Hant": "繁體中文",
  en: "English",
  ja: "日本語",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  es: "Español",
});

const STORAGE_KEY = "yumeew.locale.v1";
const page = globalThis.location?.pathname.split("/").pop()?.replace(/\.html$/, "") || "index";
const pages = {
  index: () => import("./locales/index.js"),
  account: () => import("./locales/account.js"),
  admin: () => import("./locales/admin.js"),
  settings: () => import("./locales/settings.js"),
  "subtitle-editor": () => import("./locales/subtitle-editor.js"),
  converter: () => import("./locales/converter.js"),
  "video-editor": () => import("./locales/video-editor.js"),
  "image-video": () => import("./locales/image-video.js"),
  "vocal-separator": () => import("./locales/vocal-separator.js"),
  "music-rating": () => import("./locales/music-rating.js"),
  "suno-tool": () => import("./locales/suno-tool.js"),
  "image-generator": () => import("./locales/image-generator.js"),
  "video-generator": () => import("./locales/video-generator.js"),
  "ai-mastering": () => import("./locales/ai-mastering.js"),
};

function storedLocale() {
  let value;
  try { value = localStorage.getItem(STORAGE_KEY); } catch { /* Storage may be blocked. */ }
  if (!value) {
    try { value = sessionStorage.getItem(STORAGE_KEY); } catch { /* Use the default language. */ }
  }
  return Object.hasOwn(LOCALES, value) ? value : "zh-Hant";
}

export const locale = storedLocale();
if (globalThis.document) document.documentElement.lang = locale;
let messages = {};
let patterns = [];

if (locale !== "zh-Hant") {
  try {
    const [common, shared, pageModule] = await Promise.all([
      import("./locales/common.js"),
      import("./locales/shared.js"),
      pages[page]?.(),
    ]);
    messages = { ...common.default, ...shared.default, ...pageModule?.default };
  } catch (error) {
    console.error("Unable to load translations", error);
  }
  patterns = Object.entries(messages)
    .filter(([source]) => /\{\d+\}/.test(source))
    .map(([source, translations]) => {
      const numericUnit = /^\{\d+\} 秒$/.test(source);
      const expression = source.split(/(\{\d+\})/g).map(part => /^\{\d+\}$/.test(part)
        ? (numericUnit ? "([0-9]+(?:\\.[0-9]+)?)" : "([\\s\\S]*?)")
        : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
      const slots = [...source.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1]));
      return { expression: new RegExp(`^${expression}$`), slots, translations };
    });
}

function interpolate(text, values) {
  return text.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ""));
}

export function t(source, ...values) {
  const text = String(source);
  if (locale === "zh-Hant") return interpolate(text, values);
  const exact = messages[text]?.[locale];
  if (exact) return interpolate(exact, values);
  if (values.length) return interpolate(text, values);
  for (const { expression, slots, translations } of patterns) {
    const match = expression.exec(text);
    if (!match || !translations[locale]) continue;
    const captures = [];
    slots.forEach((slot, index) => { captures[slot] = match[index + 1]; });
    return interpolate(translations[locale], captures);
  }
  return text;
}

const TRANSLATABLE_ATTRIBUTES = ["placeholder", "data-placeholder", "title", "aria-label", "alt"];
const SKIP_TEXT = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE"]);

function translateText(node) {
  if (SKIP_TEXT.has(node.parentElement?.tagName) || node.parentElement?.closest("[contenteditable], [data-i18n-ignore]")) return;
  const original = node.nodeValue;
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(original);
  if (!match || !match[2]) return;
  const result = t(match[2]);
  if (result !== match[2]) node.nodeValue = match[1] + result + match[3];
}

function translateElement(element) {
  if (element.closest("[data-i18n-ignore]")) return;
  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    const original = element.getAttribute(attribute);
    if (original === null) continue;
    const result = t(original);
    if (result !== original) element.setAttribute(attribute, result);
  }
  if (element.tagName === "META" && element.getAttribute("name") === "description") {
    const original = element.getAttribute("content");
    const result = t(original);
    if (result !== original) element.setAttribute("content", result);
  }
}

function translateTree(root) {
  if (locale === "zh-Hant") return;
  if (root.nodeType === Node.TEXT_NODE) return translateText(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  translateElement(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) translateText(node);
    else translateElement(node);
  }
}

if (locale !== "zh-Hant") {
  translateTree(document.documentElement);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "characterData") translateText(record.target);
      else if (record.type === "attributes") translateElement(record.target);
      else for (const node of record.addedNodes) translateTree(node);
    }
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATABLE_ATTRIBUTES, "content"],
  });
}

export function selectLocale(next) {
  if (!Object.hasOwn(LOCALES, next) || next === locale) return;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    try { sessionStorage.setItem(STORAGE_KEY, next); } catch { return; }
  }
  location.reload();
}
