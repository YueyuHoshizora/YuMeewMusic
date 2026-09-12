import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { getApiKey, listApiKeys, saveApiKey } from "./api-keys.js";

const $ = id => document.getElementById(id);
const VIDEO_MODELS = Object.freeze({
  "MiniMax-H3": Object.freeze({ label: "MiniMax H3", apiKey: "MiniMax" }),
  "MiniMax-H3-Max": Object.freeze({ label: "MiniMax H3 Max", apiKey: "MiniMax" }),
});
const settings = loadSettings();
applyTheme(settings.mode, settings.theme);

function syncDraftStatus() {
  const hasPrompt = Boolean($("video-prompt").value.trim() || $("video-keywords").value.trim());
  $("video-generation-status").textContent = hasPrompt ? "題詞已輸入" : "等待輸入影片描述";
}

function syncModelDetails() {
  const stored = getApiKey($("video-model").value);
  $("video-api-key").textContent = stored ? "已設定" : "未設定";
}

function syncApiKeySources(modelId) {
  const select = $("video-api-key-source");
  const sources = listApiKeys().filter(key => key.id !== modelId);
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = sources.length ? "選擇已保存的金鑰…" : "目前沒有其他已保存的金鑰";
  select.replaceChildren(placeholder, ...sources.map(source => {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.label;
    return option;
  }));
  select.disabled = !sources.length;
}

function openApiKeyDialog() {
  const modelId = $("video-model").value;
  const model = VIDEO_MODELS[modelId];
  if (!model) return;
  $("video-api-key-dialog-title").textContent = `${model.label} API KEY`;
  $("video-api-key-input").value = "";
  $("video-api-key-input").placeholder = getApiKey(modelId) ? "輸入新金鑰以取代目前金鑰" : "輸入 API KEY";
  $("video-api-key-error").hidden = true;
  syncApiKeySources(modelId);
  $("video-api-key-dialog").showModal();
  $("video-api-key-input").focus();
}

function copyApiKeyFromSource() {
  const source = getApiKey($("video-api-key-source").value);
  if (!source) return;
  $("video-api-key-input").value = source.value;
  $("video-api-key-error").hidden = true;
}

function submitApiKey(event) {
  event.preventDefault();
  const modelId = $("video-model").value;
  const model = VIDEO_MODELS[modelId];
  const value = $("video-api-key-input").value.trim();
  if (!model) return;
  if (!value) {
    $("video-api-key-error").textContent = "請輸入 API KEY。";
    $("video-api-key-error").hidden = false;
    return;
  }
  if (!saveApiKey(modelId, model.label, value)) {
    $("video-api-key-error").textContent = "瀏覽器無法保存 API KEY。";
    $("video-api-key-error").hidden = false;
    return;
  }
  $("video-api-key-dialog").close();
  syncModelDetails();
}

$("video-keywords").addEventListener("input", syncDraftStatus);
$("video-prompt").addEventListener("input", syncDraftStatus);
$("video-model").addEventListener("change", syncModelDetails);
$("video-api-key").addEventListener("click", openApiKeyDialog);
$("video-api-key-source").addEventListener("change", copyApiKeyFromSource);
$("video-api-key-form").addEventListener("submit", submitApiKey);
$("cancel-video-api-key").addEventListener("click", () => $("video-api-key-dialog").close());

syncModelDetails();
