import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { deleteStoredValue, loadStoredMedia, loadStoredValue, saveStoredMedia, saveStoredValue } from "./media-store.js";
import { getApiKey, listApiKeys, saveApiKey } from "./api-keys.js";

const VIDEO_PROXY_URL = "https://model-proxy.yustellar.idv.tw/minimax/video";
const CREATE_VIDEO_URL = `${VIDEO_PROXY_URL}/generate`;
const QUERY_VIDEO_URL = `${VIDEO_PROXY_URL}/query`;
const DOWNLOAD_VIDEO_URL = `${VIDEO_PROXY_URL}/download`;
const BYTEPLUS_VIDEO_PROXY_URL = "https://model-proxy.yustellar.idv.tw/byteplus/video";
const BYTEPLUS_CREATE_VIDEO_URL = `${BYTEPLUS_VIDEO_PROXY_URL}/generate`;
const BYTEPLUS_QUERY_VIDEO_URL = `${BYTEPLUS_VIDEO_PROXY_URL}/query`;
const BYTEPLUS_DOWNLOAD_VIDEO_URL = `${BYTEPLUS_VIDEO_PROXY_URL}/download`;
const GOOGLE_VIDEO_PROXY_URL = "https://model-proxy.yustellar.idv.tw/google/video";
const GOOGLE_CREATE_VIDEO_URL = `${GOOGLE_VIDEO_PROXY_URL}/generate`;
const GOOGLE_QUERY_VIDEO_URL = `${GOOGLE_VIDEO_PROXY_URL}/query`;
const GOOGLE_DOWNLOAD_VIDEO_URL = `${GOOGLE_VIDEO_PROXY_URL}/download`;
const POLL_INTERVAL = 5000;
const POLL_TIMEOUT = 30 * 60 * 1000;
const $ = id => document.getElementById(id);
const VIDEO_MODELS = Object.freeze({
  "MiniMax-H3": Object.freeze({ label: "MiniMax H3", provider: "minimax", apiKey: "MiniMax", resolutions: ["768P", "2K"], defaultResolution: "768P", minimumDuration: 4, maximumDuration: 15 }),
  "MiniMax-H3-Max": Object.freeze({ label: "MiniMax H3 Max", provider: "minimax", apiKey: "MiniMax", resolutions: ["480P", "768P"], defaultResolution: "480P", minimumDuration: 5, maximumDuration: 15 }),
  "dreamina-seedance-2-0-260128": Object.freeze({ label: "Seedance 2.0", provider: "byteplus", apiKey: "BytePlus", resolutions: ["480p", "720p", "1080p", "4k"], defaultResolution: "480p", minimumDuration: 4, maximumDuration: 15 }),
  "dreamina-seedance-2-5-260628": Object.freeze({ label: "Seedance 2.5", provider: "byteplus", apiKey: "BytePlus", resolutions: ["480p", "720p"], defaultResolution: "480p", minimumDuration: 4, maximumDuration: 30 }),
  "veo-3.1-generate-preview": Object.freeze({ label: "Veo 3.1", provider: "google", apiKey: "Google AI Studio", resolutions: ["720p", "1080p"], defaultResolution: "720p", durations: [4, 6, 8], ratios: ["16:9", "9:16"] }),
});
const VIDEO_RATIOS = Object.freeze(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);

const settings = loadSettings();
applyTheme(settings.mode, settings.theme);

let busy = false;
let generatedVideoBlob = null;
let generatedVideoUrl = "";
let generatedVideoRemoteUrl = "";
let generatedVideoProvider = "minimax";
let generatedVideoApiKey = "";
let generationAbort = null;
let characterTemplates = [];
const characterPreviewUrls = new Set();
let editingCharacterIndex = -1;
let editingCharacterReference = null;
let characterMentionTarget = null;
let characterMentionStart = -1;
let characterMentionActiveIndex = 0;

function setStatus(text, mode = "") {
  $("video-generation-status").textContent = text;
  $("video-generation-status").className = `generation-status ${mode}`.trim();
}

function showError(text = "") {
  $("video-generation-error").textContent = text;
  $("video-generation-error").hidden = !text;
  $("google-quota-help").hidden = !text.includes("Google Veo 額度或速率限制");
}

function syncGenerateAvailability() {
  const prompt = $("video-prompt").value.trim();
  const hasKey = Boolean(getApiKey($("video-model").value));
  $("generate-video").disabled = busy || !prompt || !hasKey;
}

function syncDraftStatus() {
  if (!busy) setStatus($("video-prompt").value.trim() ? "影片細節已輸入" : "等待輸入影片細節");
  syncGenerateAvailability();
}

function openVideoPromptBuilder() {
  if (busy) return;
  hideCharacterMentionMenu();
  $("video-prompt-builder-dialog").showModal();
  $("video-prompt-time").focus();
}

function hideCharacterMentionMenu() {
  const menu = $("character-mention-menu");
  menu.hidden = true;
  menu.replaceChildren();
  if (characterMentionTarget) {
    characterMentionTarget.setAttribute("aria-expanded", "false");
    characterMentionTarget.removeAttribute("aria-activedescendant");
  }
  characterMentionTarget = null;
  characterMentionStart = -1;
  characterMentionActiveIndex = 0;
}

function positionCharacterMentionMenu(target, optionCount) {
  const menu = $("character-mention-menu");
  const dialogRect = $("video-prompt-builder-dialog").getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const menuHeight = Math.min(optionCount * 50 + 14, 220);
  const availableBelow = dialogRect.bottom - targetRect.bottom - 12;
  const top = availableBelow >= Math.min(menuHeight, 150)
    ? targetRect.bottom + 6
    : Math.max(dialogRect.top + 12, targetRect.top - menuHeight - 6);
  const width = Math.min(Math.max(targetRect.width, 210), dialogRect.width - 24);
  const left = Math.min(Math.max(targetRect.left, dialogRect.left + 12), dialogRect.right - width - 12);
  Object.assign(menu.style, { top: `${top}px`, left: `${left}px`, width: `${width}px` });
}

function setCharacterMentionActive(index) {
  const options = [...$("character-mention-menu").querySelectorAll(".character-mention-option")];
  if (!options.length) return;
  characterMentionActiveIndex = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    const active = optionIndex === characterMentionActiveIndex;
    option.classList.toggle("active", active);
    option.setAttribute("aria-selected", String(active));
  });
  const active = options[characterMentionActiveIndex];
  characterMentionTarget?.setAttribute("aria-activedescendant", active.id);
  active.scrollIntoView({ block: "nearest" });
}

function selectCharacterMention(name) {
  const target = characterMentionTarget;
  if (!target || characterMentionStart < 0) return;
  const end = target.selectionStart ?? target.value.length;
  target.setRangeText(`${name} `, characterMentionStart, end, "end");
  hideCharacterMentionMenu();
  target.focus();
}

function showCharacterMentionMenu(target) {
  const caret = target.selectionStart ?? target.value.length;
  const beforeCaret = target.value.slice(0, caret);
  const hashIndex = beforeCaret.lastIndexOf("#");
  const query = hashIndex >= 0 ? beforeCaret.slice(hashIndex + 1) : "";
  const enabledCharacters = characterTemplates.filter(character => character.enabled !== false && character.name);
  if (hashIndex < 0 || /[\s#]/u.test(query) || !enabledCharacters.length) {
    hideCharacterMentionMenu();
    return;
  }
  const matches = enabledCharacters.filter(character => character.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  if (!matches.length) {
    hideCharacterMentionMenu();
    return;
  }
  characterMentionTarget = target;
  characterMentionStart = hashIndex;
  characterMentionActiveIndex = 0;
  const options = matches.map((character, index) => {
    const option = document.createElement("button");
    option.id = `character-mention-option-${index}`;
    option.className = `character-mention-option${index === 0 ? " active" : ""}`;
    option.type = "button";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(index === 0));
    const name = document.createElement("strong");
    name.textContent = character.name;
    option.append(name);
    option.addEventListener("mousedown", event => {
      event.preventDefault();
      selectCharacterMention(character.name);
    });
    option.addEventListener("click", () => selectCharacterMention(character.name));
    return option;
  });
  const menu = $("character-mention-menu");
  menu.replaceChildren(...options);
  menu.hidden = false;
  target.setAttribute("aria-expanded", "true");
  target.setAttribute("aria-controls", "character-mention-menu");
  target.setAttribute("aria-activedescendant", options[0].id);
  positionCharacterMentionMenu(target, options.length);
}

function handleCharacterMentionKeydown(event) {
  if ($("character-mention-menu").hidden) return;
  const options = [...$("character-mention-menu").querySelectorAll(".character-mention-option")];
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    setCharacterMentionActive(characterMentionActiveIndex + (event.key === "ArrowDown" ? 1 : -1));
  } else if (event.key === "Enter" && options[characterMentionActiveIndex]) {
    event.preventDefault();
    options[characterMentionActiveIndex].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  } else if (event.key === "Escape") {
    event.preventDefault();
    hideCharacterMentionMenu();
  }
}

function submitVideoPromptBuilder(event) {
  event.preventDefault();
  hideCharacterMentionMenu();
  const fields = [
    ["時間", $("video-prompt-time").value.trim()],
    ["場景", $("video-prompt-scene").value.trim()],
    ["鏡頭", $("video-prompt-camera").value.trim()],
    ["視角", $("video-prompt-view").value.trim()],
    ["燈光", $("video-prompt-lighting").value.trim()],
    ["音效", $("video-prompt-sound").value.trim()],
    ["動作", $("video-prompt-action").value.trim()],
    ["對白", $("video-prompt-dialogue").value.trim()],
  ];
  const block = fields.filter(([, value]) => value).map(([label, value]) => `${label}：${value}`).join("\n");
  if (!block) return;
  const prompt = $("video-prompt");
  prompt.value = prompt.value.trim() ? `${prompt.value.trimEnd()}\n\n${block}\n\n` : `${block}\n\n`;
  $("video-prompt-builder-form").reset();
  $("video-prompt-builder-dialog").close();
  syncDraftStatus();
  prompt.focus();
}

async function persistCharacterTemplates() {
  if (characterTemplates.length) await saveStoredValue("video-character-templates", { characters: characterTemplates, updatedAt: Date.now() });
  else await deleteStoredValue("video-character-templates");
  syncCharacterTemplateButton();
}

function createCharacterThumbnail(character, index) {
  const card = document.createElement("article");
  card.className = `character-template-item${character.enabled === false ? " disabled" : ""}`;
  const editButton = document.createElement("button");
  editButton.className = "character-template-edit";
  editButton.type = "button";
  editButton.setAttribute("aria-label", `編輯人物「${character.name || `人物 ${index + 1}`}」`);
  if (character.referenceImage) {
    const image = document.createElement("img");
    const url = URL.createObjectURL(character.referenceImage);
    characterPreviewUrls.add(url);
    image.src = url;
    image.alt = "";
    editButton.append(image);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "character-thumbnail-placeholder";
    placeholder.textContent = (character.name || "人").slice(0, 1);
    editButton.append(placeholder);
  }
  const name = document.createElement("strong");
  name.textContent = character.name || `人物 ${index + 1}`;
  editButton.append(name);
  editButton.addEventListener("click", () => openCharacterEditor(index));
  const toggle = document.createElement("button");
  toggle.className = "character-template-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", String(character.enabled !== false));
  toggle.textContent = character.enabled === false ? "啟用" : "禁用";
  toggle.addEventListener("click", () => void toggleCharacterTemplate(index));
  card.append(editButton, toggle);
  return card;
}

function syncCharacterTemplateButton() {
  const enabledCount = characterTemplates.filter(character => character.enabled !== false).length;
  $("open-character-template").textContent = characterTemplates.length
    ? `人物模板 (啟用 ${enabledCount}/${characterTemplates.length})`
    : "人物模板";
}

async function toggleCharacterTemplate(index) {
  const character = characterTemplates[index];
  if (!character) return;
  const previous = character.enabled !== false;
  character.enabled = !previous;
  renderCharacterTemplates();
  try {
    await persistCharacterTemplates();
    setStatus(`已${character.enabled ? "啟用" : "停用"}人物「${character.name}」`, "success");
  } catch {
    character.enabled = previous;
    renderCharacterTemplates();
    setStatus("人物啟用狀態無法保存到瀏覽器", "error");
  }
}

function renderCharacterTemplates() {
  characterPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  characterPreviewUrls.clear();
  $("character-template-list").replaceChildren(...characterTemplates.map(createCharacterThumbnail));
  $("character-template-empty").hidden = Boolean(characterTemplates.length);
  syncCharacterTemplateButton();
}

function showCharacterEditorReference(file) {
  const preview = $("character-reference-preview");
  editingCharacterReference = file || null;
  $("character-reference").setCustomValidity(file ? "" : "請選擇人物參考圖。");
  preview.hidden = true;
  preview.removeAttribute("src");
  $("character-reference-name").textContent = "尚未選擇圖片";
  if (!file) return;
  const url = URL.createObjectURL(file);
  characterPreviewUrls.add(url);
  preview.src = url;
  preview.hidden = false;
  $("character-reference-name").textContent = file.name || "人物參考圖";
}

function openCharacterEditor(index = -1) {
  editingCharacterIndex = index;
  const character = index >= 0 ? characterTemplates[index] : null;
  $("character-editor-title").textContent = character ? "編輯人物" : "新增人物";
  $("character-name").value = character?.name || "";
  $("character-reference").value = "";
  $("character-style").value = character?.style || "";
  $("character-tone").value = character?.tone || "";
  $("character-voice").value = character?.voice || "";
  $("character-clothing").value = character?.clothing || "";
  $("delete-character").hidden = !character;
  showCharacterEditorReference(character?.referenceImage || null);
  $("character-reference").required = !editingCharacterReference;
  $("character-editor-dialog").showModal();
  $("character-name").focus();
}

function openCharacterTemplate() {
  if (busy) return;
  $("character-template-dialog").showModal();
}

async function submitCharacterEditor(event) {
  event.preventDefault();
  const character = {
    name: $("character-name").value.trim(),
    referenceImage: editingCharacterReference,
    style: $("character-style").value.trim(),
    tone: $("character-tone").value.trim(),
    voice: $("character-voice").value.trim(),
    clothing: $("character-clothing").value.trim(),
    enabled: editingCharacterIndex >= 0 ? characterTemplates[editingCharacterIndex]?.enabled !== false : false,
  };
  if (!character.name || !character.referenceImage) {
    $("character-reference").setCustomValidity(character.referenceImage ? "" : "請選擇人物參考圖。");
    $("character-editor-form").reportValidity();
    return;
  }
  if (editingCharacterIndex >= 0) characterTemplates[editingCharacterIndex] = character;
  else characterTemplates.push(character);
  try {
    await persistCharacterTemplates();
    renderCharacterTemplates();
    $("character-editor-dialog").close();
    setStatus(`已保存人物「${character.name}」`, "success");
  } catch {
    setStatus("人物模板無法保存到瀏覽器", "error");
  }
}

async function deleteEditingCharacter() {
  if (editingCharacterIndex < 0) return;
  const character = characterTemplates[editingCharacterIndex];
  const name = character?.name || "這個人物";
  if (!window.confirm(`確定刪除「${name}」？刪除後將同步移除保存的人物模板。`)) return;
  characterTemplates.splice(editingCharacterIndex, 1);
  try {
    await persistCharacterTemplates();
    renderCharacterTemplates();
    $("character-editor-dialog").close();
    setStatus(`已刪除人物「${name}」`, "success");
  } catch {
    setStatus("人物模板刪除後無法同步保存", "error");
  }
}

async function restoreCharacterTemplates() {
  try {
    const stored = await loadStoredValue("video-character-templates");
    if (!Array.isArray(stored?.characters)) return;
    characterTemplates = stored.characters.map(character => ({ ...character, enabled: character.enabled !== false }));
    renderCharacterTemplates();
  } catch {}
}

function characterTemplateText() {
  const enabledCharacters = characterTemplates.filter(character => character.enabled !== false);
  if (!enabledCharacters.length) return "";
  return enabledCharacters.map((character, index) => {
    const fields = [
      ["名字", character.name],
      ["聲線", character.voice],
      ["口氣", character.tone],
      ["風格", character.style],
      ["服裝", character.clothing],
    ].filter(([, value]) => value).map(([label, value]) => `${label}：${value}`).join("；");
    return `人物 ${index + 1}：${fields}`;
  }).filter(line => !line.endsWith("：")).join("\n");
}

function replaceOptions(select, values, selected) {
  select.replaceChildren(...values.map(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === selected;
    return option;
  }));
}

function syncModelDetails() {
  const modelId = $("video-model").value;
  const model = VIDEO_MODELS[modelId];
  const previousResolution = $("video-resolution").value;
  replaceOptions($("video-resolution"), model.resolutions, model.resolutions.includes(previousResolution) ? previousResolution : model.defaultResolution);
  const previousDuration = Number($("video-duration").value) || 5;
  const durations = model.durations || Array.from({ length: model.maximumDuration - model.minimumDuration + 1 }, (_, index) => model.minimumDuration + index);
  const selectedDuration = durations.includes(previousDuration) ? previousDuration : durations[0];
  replaceOptions($("video-duration"), durations.map(String), String(selectedDuration));
  $("video-duration").querySelectorAll("option").forEach(option => { option.textContent = `${option.value} 秒`; });
  const ratios = model.ratios || VIDEO_RATIOS;
  const previousRatio = $("video-ratio").value;
  replaceOptions($("video-ratio"), ratios, ratios.includes(previousRatio) ? previousRatio : ratios[0]);
  $("video-api-key").textContent = getApiKey(modelId) ? "已設定" : "未設定";
  $("confirm-video-generation-message").textContent = `影片生成會消耗 ${model.apiKey} 帳戶額度，是否確定開始生成？`;
  syncResultHeading();
  syncGenerateAvailability();
}

function syncResultHeading() {
  $("result-video-resolution").textContent = $("video-resolution").value;
  $("result-video-ratio").textContent = `${$("video-ratio").value} · MP4`;
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
  if (!model || busy) return;
  $("video-api-key-dialog-title").textContent = `${model.label} API KEY`;
  $("video-api-key-help").textContent = model.provider === "minimax"
    ? "MiniMax H3 系列須使用一般 Pay-as-you-go API KEY；Token Plan／Credit Key 不支援。金鑰只會保存在目前瀏覽器。"
    : model.provider === "google"
      ? "請使用 Google AI Studio Gemini API KEY。金鑰只會保存在目前瀏覽器，並透過代理服務送至 Google。"
      : "請使用 BytePlus ModelArk API KEY。金鑰只會保存在目前瀏覽器，並透過代理服務送至 BytePlus。";
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

function setBusy(value, showLock = value) {
  busy = value;
  document.body.setAttribute("aria-busy", String(value));
  $("video-generation-lock").hidden = !showLock;
  for (const id of ["video-prompt", "open-character-template", "open-video-prompt-builder", "video-model", "video-resolution", "video-duration", "video-ratio", "video-api-key"]) $(id).disabled = value;
  $("download-video").disabled = value || (!generatedVideoBlob && !generatedVideoRemoteUrl);
  $("apply-video-background").disabled = value || !generatedVideoBlob;
  syncGenerateAvailability();
}

function apiError(body, fallback = "", provider = "minimax") {
  const rawCode = body?.base_resp?.status_code ?? body?.error?.code ?? body?.code;
  const code = Number(rawCode);
  const message = body?.error?.message
    || body?.message
    || (typeof body?.error === "string" ? body.error : "")
    || body?.base_resp?.status_msg
    || "";
  if (code === 1008 || /insufficient balance/i.test(message)) {
    return "目前 MiniMax API KEY 所屬帳戶餘額不足（1008），請充值或更換 API KEY。";
  }
  if (code === 2013 && /TokenPlan|Credit.*MiniMax-H3/i.test(message)) {
    return "目前使用的 MiniMax Token Plan／Credit Key 不支援 H3 系列（2013）。請改用一般 Pay-as-you-go API KEY，並確認帳戶有足夠餘額。";
  }
  if (provider === "google" && (code === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(message))) {
    return "Google Veo 額度或速率限制已用盡（429）。請檢查目前專案的用量與帳單設定，稍後再試或改用有可用額度的 API KEY。";
  }
  const service = provider === "byteplus" ? "BytePlus" : provider === "google" ? "Google" : "MiniMax";
  if (Number.isFinite(code) && code !== 0) return message ? `${message}（${code}）` : `${service} API 錯誤（${code}）`;
  return fallback ? message || fallback : "";
}

async function fetchJson(url, options, provider = "minimax") {
  const response = await fetch(url, options);
  let body;
  try {
    body = await response.json();
  } catch {
    const service = provider === "byteplus" ? "BytePlus" : provider === "google" ? "Google" : "MiniMax";
    if (!response.ok) throw Error(`${service} API 回傳 ${response.status}`);
    throw Error(`${service} API 回傳無法解析的資料。`);
  }
  const service = provider === "byteplus" ? "BytePlus" : provider === "google" ? "Google" : "MiniMax";
  const error = apiError(body, response.ok ? "" : `${service} API 回傳 ${response.status}`, provider);
  if (error) throw Error(error);
  return body;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function providerEndpoints(provider) {
  if (provider === "byteplus") return { create: BYTEPLUS_CREATE_VIDEO_URL, query: BYTEPLUS_QUERY_VIDEO_URL, download: BYTEPLUS_DOWNLOAD_VIDEO_URL };
  if (provider === "google") return { create: GOOGLE_CREATE_VIDEO_URL, query: GOOGLE_QUERY_VIDEO_URL, download: GOOGLE_DOWNLOAD_VIDEO_URL };
  return { create: CREATE_VIDEO_URL, query: QUERY_VIDEO_URL, download: DOWNLOAD_VIDEO_URL };
}

async function pollVideoTask(taskId, apiKey, model, signal) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT) {
    const result = await fetchJson(providerEndpoints(model.provider).query, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, taskId }),
      cache: "no-store",
      signal,
    }, model.provider);
    const task = model.provider === "byteplus" || model.provider === "google" ? result : result?.task;
    if (!task) throw Error(`${model.apiKey} 沒有回傳任務資料。`);
    if (model.provider === "google" && task.done) {
      if (task.error) throw Error(task.error.message || "Google Veo 影片生成失敗。");
      const videoUrl = task.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!videoUrl) throw Error(task.response?.generateVideoResponse?.raiMediaFilteredReasons?.[0] || "Veo 任務完成，但沒有回傳影片網址。");
      task.videoUrl = videoUrl;
      return task;
    }
    const taskState = model.provider === "google" ? "running" : String(task.status || "").toLowerCase();
    if (taskState === "succeeded") {
      const videoUrl = model.provider === "byteplus" ? task.content?.video_url : task.content?.url;
      if (!videoUrl) throw Error("影片任務完成，但沒有回傳影片網址。");
      task.videoUrl = videoUrl;
      return task;
    }
    if (["failed", "cancelled", "expired"].includes(taskState)) throw Error(task.error?.message || task.message || `影片生成${taskState === "cancelled" ? "已取消" : taskState === "expired" ? "已逾時" : "失敗"}。`);
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    $("video-generation-lock-title").textContent = taskState === "running" ? "影片生成中" : "影片任務排隊中";
    $("video-generation-lock-detail").textContent = `任務 ${taskId} · 已等待 ${elapsed} 秒`;
    setStatus(`${taskState === "running" ? "影片生成中" : "影片排隊中"} · 已等待 ${elapsed} 秒`);
    await wait(POLL_INTERVAL, signal);
  }
  throw Error(`影片生成等待超過 30 分鐘，請稍後至 ${model.apiKey} 查詢任務狀態。`);
}

function releaseVideo() {
  const video = $("generated-video");
  video.pause();
  video.removeAttribute("src");
  video.load();
  if (generatedVideoUrl) URL.revokeObjectURL(generatedVideoUrl);
  generatedVideoBlob = null;
  generatedVideoUrl = "";
  generatedVideoRemoteUrl = "";
  generatedVideoApiKey = "";
  $("retry-save-video").hidden = true;
}

function presentVideo() {
  const video = $("generated-video");
  video.src = generatedVideoUrl || generatedVideoRemoteUrl;
  video.hidden = false;
  $("empty-video-result").hidden = true;
  video.load();
  $("download-video").disabled = false;
  $("apply-video-background").disabled = !generatedVideoBlob;
}

async function restoreLastGeneratedVideo() {
  try {
    const record = await loadStoredMedia("generated-video");
    if (!record?.blob?.size || !record.blob.type?.startsWith("video/") || busy) return;
    releaseVideo();
    generatedVideoBlob = record.blob;
    generatedVideoUrl = URL.createObjectURL(generatedVideoBlob);
    presentVideo();
    setStatus("已載入上次生成結果", "success");
  } catch {}
}

async function showVideoResult(remoteUrl, provider = generatedVideoProvider, expandResult = false, apiKey = "") {
  releaseVideo();
  generatedVideoRemoteUrl = remoteUrl;
  generatedVideoProvider = provider;
  generatedVideoApiKey = apiKey;
  try {
    const response = await fetch(providerEndpoints(provider).download, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: remoteUrl, ...(provider === "google" ? { apiKey } : {}) }),
      cache: "no-store",
    });
    if (!response.ok) throw Error(`影片下載回傳 ${response.status}`);
    const blob = await response.blob();
    if (!blob.size) throw Error("影片檔案內容為空。");
    generatedVideoBlob = new Blob([blob], { type: blob.type || "video/mp4" });
    generatedVideoUrl = URL.createObjectURL(generatedVideoBlob);
    const cachedFile = new File([generatedVideoBlob], videoFilename(), { type: generatedVideoBlob.type || "video/mp4", lastModified: Date.now() });
    await saveStoredMedia("generated-video", cachedFile).catch(() => {
      showError("影片已生成，但瀏覽器無法保存最後一次生成結果。");
    });
    $("retry-save-video").hidden = true;
  } catch {
    showError("影片已生成，但下載代理無法讀取影片檔案；仍可播放或開啟下載網址。保存與套用背景功能暫時無法使用。");
    $("retry-save-video").hidden = false;
  }
  presentVideo();
  if (expandResult) $("video-result-panel").open = true;
}

function videoFilename(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `video_${day}_${time}.mp4`;
}

async function generateVideo() {
  const videoDetails = $("video-prompt").value.trim();
  const prompt = [videoDetails, characterTemplateText()].filter(Boolean).join("\n\n");
  const modelId = $("video-model").value;
  const model = VIDEO_MODELS[modelId];
  const apiKey = getApiKey(modelId)?.value || "";
  if (!videoDetails || !apiKey || busy) return;
  showError();
  setBusy(true);
  generationAbort = new AbortController();
  $("video-generation-lock-title").textContent = "正在建立影片生成任務";
  $("video-generation-lock-detail").textContent = "請保持此頁面開啟，完成時間依服務狀態而定。";
  try {
    setStatus(`正在建立 ${model.apiKey} 影片任務…`);
    const payload = model.provider === "google" ? {
      model: modelId,
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        resolution: $("video-resolution").value,
        durationSeconds: Number($("video-duration").value),
        aspectRatio: $("video-ratio").value,
      },
    } : {
      model: modelId,
      content: [{ type: "text", text: prompt }],
      resolution: $("video-resolution").value,
      duration: Number($("video-duration").value),
      ratio: $("video-ratio").value,
    };
    if (model.provider === "byteplus") {
      payload.generate_audio = true;
      payload.watermark = false;
    }
    const created = await fetchJson(providerEndpoints(model.provider).create, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        payload,
      }),
      cache: "no-store",
      signal: generationAbort.signal,
    }, model.provider);
    const taskId = model.provider === "byteplus" ? created?.id : model.provider === "google" ? created?.name : created?.task_id;
    if (!taskId) throw Error(`${model.apiKey} 沒有回傳影片任務 ID。`);
    const task = await pollVideoTask(taskId, apiKey, model, generationAbort.signal);
    $("video-generation-lock-title").textContent = "影片已完成，正在載入結果";
    $("video-generation-lock-detail").textContent = "正在準備預覽與下載檔案…";
    await showVideoResult(task.videoUrl, model.provider, true, apiKey);
    setStatus(`生成完成 · ${task.resolution || $("video-resolution").value} · ${task.duration || $("video-duration").value} 秒`, "success");
  } catch (error) {
    if (error?.name !== "AbortError") {
      const message = error instanceof TypeError
        ? "瀏覽器無法連線至影片生成服務，請稍後再試。"
        : error.message || "影片生成失敗。";
      showError(message);
      setStatus("影片生成失敗", "error");
    }
  } finally {
    generationAbort = null;
    setBusy(false);
  }
}

function openGenerateConfirmation() {
  if ($("generate-video").disabled || busy) return;
  $("confirm-video-generation-dialog").showModal();
}

function confirmVideoGeneration(event) {
  event.preventDefault();
  $("confirm-video-generation-dialog").close();
  void generateVideo();
}

$("video-prompt").addEventListener("input", syncDraftStatus);
$("open-character-template").addEventListener("click", openCharacterTemplate);
$("add-character").addEventListener("click", () => openCharacterEditor());
$("close-character-template").addEventListener("click", () => $("character-template-dialog").close());
$("character-reference").addEventListener("change", event => showCharacterEditorReference(event.currentTarget.files?.[0] || null));
$("character-editor-form").addEventListener("submit", submitCharacterEditor);
$("cancel-character-editor").addEventListener("click", () => $("character-editor-dialog").close());
$("delete-character").addEventListener("click", deleteEditingCharacter);
$("open-video-prompt-builder").addEventListener("click", openVideoPromptBuilder);
$("video-prompt-builder-form").addEventListener("submit", submitVideoPromptBuilder);
$("cancel-video-prompt-builder").addEventListener("click", () => {
  hideCharacterMentionMenu();
  $("video-prompt-builder-dialog").close();
});
$("video-prompt-builder-dialog").addEventListener("close", hideCharacterMentionMenu);
$("video-prompt-builder-dialog").addEventListener("pointerdown", event => {
  if (characterMentionTarget && !$("character-mention-menu").contains(event.target) && event.target !== characterMentionTarget) hideCharacterMentionMenu();
});
$("video-prompt-builder-dialog").addEventListener("scroll", () => {
  if (characterMentionTarget) positionCharacterMentionMenu(characterMentionTarget, $("character-mention-menu").childElementCount);
});
document.querySelectorAll(".video-prompt-builder-fields .text-input").forEach(field => {
  field.setAttribute("aria-autocomplete", "list");
  field.setAttribute("aria-expanded", "false");
  field.addEventListener("input", event => showCharacterMentionMenu(event.currentTarget));
  field.addEventListener("keydown", handleCharacterMentionKeydown);
});
$("video-model").addEventListener("change", syncModelDetails);
$("video-resolution").addEventListener("change", syncResultHeading);
$("video-ratio").addEventListener("change", syncResultHeading);
$("video-api-key").addEventListener("click", openApiKeyDialog);
$("video-api-key-source").addEventListener("change", copyApiKeyFromSource);
$("video-api-key-form").addEventListener("submit", submitApiKey);
$("cancel-video-api-key").addEventListener("click", () => $("video-api-key-dialog").close());
$("generate-video").addEventListener("click", openGenerateConfirmation);
$("confirm-video-generation-form").addEventListener("submit", confirmVideoGeneration);
$("cancel-video-generation").addEventListener("click", () => $("confirm-video-generation-dialog").close());
$("video-settings-panel").addEventListener("toggle", () => {
  if ($("video-settings-panel").open) $("video-description-panel").open = false;
});

$("download-video").addEventListener("click", () => {
  if (busy || (!generatedVideoBlob && !generatedVideoRemoteUrl)) return;
  const link = document.createElement("a");
  link.href = generatedVideoUrl || generatedVideoRemoteUrl;
  link.download = generatedVideoBlob ? videoFilename() : "";
  if (!generatedVideoBlob) link.target = "_blank";
  link.rel = "noopener";
  link.click();
});

$("retry-save-video").addEventListener("click", async () => {
  if (!generatedVideoRemoteUrl || busy) return;
  const retryUrl = generatedVideoRemoteUrl;
  const retryProvider = generatedVideoProvider;
  const retryApiKey = generatedVideoApiKey;
  setBusy(true, false);
  showError();
  setStatus("正在重新下載並保存影片…");
  await showVideoResult(retryUrl, retryProvider, false, retryApiKey);
  setStatus(generatedVideoBlob ? "影片已保存到瀏覽器" : "影片保存失敗", generatedVideoBlob ? "success" : "error");
  setBusy(false);
});

$("apply-video-background").addEventListener("click", async () => {
  if (!generatedVideoBlob || busy) return;
  setBusy(true);
  setStatus("正在保存為主畫面背景…");
  try {
    const file = new File([generatedVideoBlob], videoFilename(), { type: generatedVideoBlob.type || "video/mp4", lastModified: Date.now() });
    await saveStoredMedia("image", file);
    await deleteStoredValue("image-video-project").catch(() => {});
    window.location.href = "./";
  } catch (error) {
    showError(error.message || "無法保存影片到瀏覽器。");
    setStatus("背景套用失敗", "error");
    setBusy(false);
  }
});

window.addEventListener("pagehide", () => {
  generationAbort?.abort();
  releaseVideo();
  characterPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  characterPreviewUrls.clear();
});

syncModelDetails();
syncDraftStatus();
void restoreCharacterTemplates();
void restoreLastGeneratedVideo();
