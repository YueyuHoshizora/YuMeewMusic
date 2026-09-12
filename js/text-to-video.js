import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";

const $ = id => document.getElementById(id);
const settings = loadSettings();
applyTheme(settings.mode, settings.theme);

function syncDraftStatus() {
  const hasPrompt = Boolean($("video-prompt").value.trim() || $("video-keywords").value.trim());
  $("video-generation-status").textContent = hasPrompt ? "題詞已輸入 · 等待設定影片模型" : "等待設定影片模型";
}

$("video-keywords").addEventListener("input", syncDraftStatus);
$("video-prompt").addEventListener("input", syncDraftStatus);
