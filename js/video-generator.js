import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { deleteStoredValue, loadStoredMedia, loadStoredValue, saveStoredValue } from "./media-store.js";
import { getApiKey, saveAccountCredits, saveApiKey, usesAccountCredits } from "./api-keys.js";
import { formatResourceSize, nextResourceReference, resourceKind, resourceTypeLabel } from "./video-resources.js";
import { createVideoProjectFile, readVideoProjectFile } from "./video-project-file.js";
import { createStoryboardReportPdf } from "./pdf-export.js";
import { createStoryboardCardsPdf } from "./storyboard-pdf.js";
import { clientIdentityHeaders } from "./client-identity.js";
import { parseStoryboardPrompt, referencedResourceNames } from "./video-prompt-mode.js";
import { convertMediaFile } from "./converter-core.js";
import { getCurrentSession, onAuthStateChange } from "./auth.js";
import { fetchMemberAccount, fetchVideoBillingSettings } from "./member-api.js";
import { estimateVideoGenerationCost, hasSufficientVideoCredit } from "./video-billing.js";
import { providerBillingUrl } from "./provider-billing.js";

const VIDEO_PROXY_URL = "https://model-proxy.the-music.app/minimax/video";
const CREATE_VIDEO_URL = `${VIDEO_PROXY_URL}/generate`;
const QUERY_VIDEO_URL = `${VIDEO_PROXY_URL}/query`;
const DOWNLOAD_VIDEO_URL = `${VIDEO_PROXY_URL}/download`;
const BYTEPLUS_VIDEO_PROXY_URL = "https://model-proxy.the-music.app/byteplus/video";
const BYTEPLUS_CREATE_VIDEO_URL = `${BYTEPLUS_VIDEO_PROXY_URL}/generate`;
const BYTEPLUS_QUERY_VIDEO_URL = `${BYTEPLUS_VIDEO_PROXY_URL}/query`;
const BYTEPLUS_DOWNLOAD_VIDEO_URL = `${BYTEPLUS_VIDEO_PROXY_URL}/download`;
const GOOGLE_VIDEO_PROXY_URL = "https://model-proxy.the-music.app/google/video";
const GOOGLE_CREATE_VIDEO_URL = `${GOOGLE_VIDEO_PROXY_URL}/generate`;
const GOOGLE_QUERY_VIDEO_URL = `${GOOGLE_VIDEO_PROXY_URL}/query`;
const GOOGLE_DOWNLOAD_VIDEO_URL = `${GOOGLE_VIDEO_PROXY_URL}/download`;
const RESOURCE_UPLOAD_URL = "https://model-proxy.the-music.app/resources/upload";
// 分鏡 AI 分析有兩套後端：主要引擎退回原本的 storyboard-checker Worker（Cloudflare
// Workers AI，@cf/zai-org/glm-4.7-flash）；inspiration-chat Worker（改代理 OpenRouter
// 的 nex-agi/nex-n2.5-pro:free——這顆 Worker 原本是「靈感激發」聊天頁面的後端，頁面
// 下架後程式碼保留下來能做同一件事）先保留當備用，之後有需要再切回來當主要引擎。
// 兩邊的請求／回應 JSON 合約刻意做成一致，才能無腦切換，見 inspiration-chat/AGENTS.md。
const STORYBOARD_PRIMARY_URL = "https://storyboard-checker.the-music.app/api/storyboard/check";
const STORYBOARD_FALLBACK_URL = "https://inspiration-chat.the-music.app/api/storyboard/check";
const STORYBOARD_CHECKER_POLL_INTERVAL = 3000;
const STORYBOARD_CHECKER_TIMEOUT = 10 * 60 * 1000;
const POLL_INTERVAL = 5000;
const POLL_TIMEOUT = 30 * 60 * 1000;
const VIDEO_HISTORY_LIMIT = 10;
const $ = id => document.getElementById(id);
const VIDEO_MODELS = Object.freeze({
  "MiniMax-H3": Object.freeze({ label: "MiniMax H3", provider: "minimax", apiKey: "MiniMax", resolutions: ["768P", "2K"], defaultResolution: "768P", minimumDuration: 4, maximumDuration: 15, billingId: "minimax-h3" }),
  "dreamina-seedance-2-0-260128": Object.freeze({ label: "Seedance 2.0", provider: "byteplus", apiKey: "BytePlus", resolutions: ["480p", "720p", "1080p", "4k"], defaultResolution: "480p", minimumDuration: 4, maximumDuration: 15, billingId: "seedance-2-0" }),
  "dreamina-seedance-2-5-260628": Object.freeze({ label: "Seedance 2.5", provider: "byteplus", apiKey: "BytePlus", resolutions: ["480p", "720p"], defaultResolution: "480p", minimumDuration: 4, maximumDuration: 30, billingId: "seedance-2-5" }),
  "veo-3.1-generate-preview": Object.freeze({ label: "Veo 3.1", provider: "google", apiKey: "Google AI Studio", resolutions: ["720p", "1080p"], defaultResolution: "720p", durations: [4, 6, 8], ratios: ["16:9", "9:16"], billingId: "veo-3-1" }),
});
const VIDEO_RATIOS = Object.freeze(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
const STORYBOARD_ACTIONS = Object.freeze({
  movement: Object.freeze(["站立", "坐下", "起身", "向前走", "向後退", "奔跑", "跳躍", "蹲下", "轉身", "停下", "進入畫面", "離開畫面"]),
  gaze: Object.freeze(["抬頭", "低頭", "回頭", "點頭", "搖頭", "看向鏡頭", "看向另一名角色", "看向遠方", "閉上眼睛", "睜開眼睛", "眨眼"]),
  expression: Object.freeze(["微笑", "大笑", "哭泣", "露出驚訝表情", "露出憤怒表情", "顯得緊張", "顯得害羞", "保持面無表情", "表情逐漸轉變"]),
  gesture: Object.freeze(["揮手", "指向目標", "伸手", "握拳", "張開雙臂", "鼓掌", "擁抱", "鞠躬", "跳舞", "旋轉身體", "跌倒", "起身"]),
  object: Object.freeze(["拿起物品", "放下物品", "打開物品", "關閉物品", "推動物品", "拉動物品", "拋出物品", "接住物品", "書寫", "閱讀", "喝水", "彈奏樂器", "使用手機", "駕駛車輛"]),
  interaction: Object.freeze(["走向另一名角色", "牽手", "握手", "擁抱另一名角色", "追逐", "閃避", "推開另一名角色", "打鬥", "並肩行走", "面對面交談", "將物品交給對方"]),
  environment: Object.freeze(["頭髮隨風飄動", "衣物隨風擺動", "被雨淋濕", "踩出水花", "被強光照亮", "因衝擊後退", "在煙霧中前進", "在水面漂浮", "緩慢下沉"]),
});
const EMPTY_FILM_STYLE = Object.freeze({ primary: "", primaryCustom: "", era: "", color: "", texture: "", framing: "", narratorVoice: "", narratorCustom: "", notes: "" });

const settings = loadSettings();
applyTheme(settings.mode, settings.theme);
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

let busy = false;
let memberSignedIn = false;
let promptBuilderMinimized = false;
let editingStoryboardId = "";
let filmStyle = { ...EMPTY_FILM_STYLE };
let finalStoryboard = null;
const storyboards = new Map();
let generatedVideoBlob = null;
let lastGeneratedVideoRestored = false;
let generatedVideoUrl = "";
let generatedVideoRemoteUrl = "";
let generatedVideoProvider = "minimax";
let generatedVideoApiKey = "";
let generationAbort = null;
let generatedVideoMetadata = null;
let generationHistory = [];
let videoHistorySelection = new Set();
const historyPreviewUrls = new Set();
const comparisonPreviewUrls = new Set();
let characterTemplates = [];
const characterPreviewUrls = new Set();
let editingCharacterIndex = -1;
let editingCharacterReference = null;
let characterMentionTarget = null;
let characterMentionMatch = null;
let characterMentionActiveIndex = 0;
let videoResources = [];
let resourceCounters = { image: 0, audio: 0, video: 0 };
const resourcePreviewUrls = new Set();
const initializedResourceEditors = new WeakSet();
let activeResourcePreviewUrl = "";
let resourceMentionTarget = null;
let resourceMentionMatch = null;
let resourceMentionActiveIndex = 0;
const uploadedResourceCache = new WeakMap();
let pendingVideoProject = null;
let autoDraftReady = false;
let autoDraftTouched = false;
let autoDraftTimer = 0;
let autoDraftResourcesDirty = false;
let autoDraftSavePromise = Promise.resolve();
let lastStoryboardAiReport = null;
let storyboardAiPdfWindow = null;
let promptEditorMode = "storyboard";
let promptModeSource = "";

function isPromptMode() { return promptEditorMode === "prompt"; }
function activePromptEditor() { return $(isPromptMode() ? "video-prompt-text" : "video-prompt"); }

const MINIMIZABLE_DIALOGS = Object.freeze({
  promptPreview: Object.freeze({ dialog: "video-prompt-preview-dialog", restore: "restore-video-prompt-preview", focus: "video-prompt-preview-text" }),
});

function minimizeDialog(name) {
  const config = MINIMIZABLE_DIALOGS[name];
  if (!config) return;
  hideCharacterMentionMenu();
  hideResourceMentionMenu();
  $(config.dialog).close("minimized");
}

function restoreMinimizedDialog(name) {
  const config = MINIMIZABLE_DIALOGS[name];
  if (!config || busy || $(config.restore).hidden) return false;
  $(config.restore).hidden = true;
  $(config.dialog).returnValue = "";
  $(config.dialog).showModal();
  $(config.focus)?.focus();
  return true;
}

function syncMinimizedDialog(name) {
  const config = MINIMIZABLE_DIALOGS[name];
  $(config.restore).hidden = $(config.dialog).returnValue !== "minimized";
}

function editorText(editor) {
  if (editor?.matches?.("input, textarea")) return String(editor.value || "").replace(/\u00a0/g, " ").trim();
  return String(editor?.innerText || editor?.textContent || "").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function clearEditor(editor) {
  editor.replaceChildren();
}

function triggerAtCaret(editor, trigger) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed || !editor.contains(selection.anchorNode)) return null;
  const node = selection.anchorNode;
  if (node?.nodeType !== Node.TEXT_NODE) return null;
  const end = selection.anchorOffset;
  const start = node.data.lastIndexOf(trigger, end - 1);
  if (start < 0) return null;
  const query = node.data.slice(start + 1, end);
  if (/\s/u.test(query)) return null;
  return { node, start, end, query };
}

function replaceMentionText(match, replacement) {
  const range = document.createRange();
  range.setStart(match.node, match.start);
  range.setEnd(match.node, match.end);
  range.deleteContents();
  range.insertNode(replacement);
  const spacer = document.createTextNode(" ");
  replacement.after(spacer);
  range.setStartAfter(spacer);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

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
  const prompt = editorText(activePromptEditor());
  const modelId = $("video-model").value;
  const accountCredits = usesAccountCredits(modelId);
  const hasKey = accountCredits ? memberSignedIn : Boolean(getApiKey(VIDEO_MODELS[modelId]?.provider));
  $("generate-video").disabled = busy || !prompt || !hasKey;
}

function hasClearableWorkspace() {
  return Boolean(editorText($("video-prompt-text")) || storyboards.size || finalStoryboard || videoResources.length || filmStyleText());
}

function syncClearWorkspaceAvailability() {
  $("clear-video-resources").disabled = busy || !autoDraftReady || !hasClearableWorkspace();
}

function syncStoryboardPdfAvailability() {
  $("export-storyboard-pdf").disabled = busy || (!isPromptMode() && !storyboards.size && !finalStoryboard) || (isPromptMode() && !editorText($("video-prompt-text")));
}

function fillPromptEditor(text) {
  const editor = $("video-prompt-text");
  editor.replaceChildren();
  const resources = [...videoResources].sort((a, b) => b.referenceName.length - a.referenceName.length);
  const names = resources.map(resource => resource.referenceName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  if (!names.length) { editor.textContent = text; return; }
  const matcher = new RegExp(`@(${names.join("|")})(?![\\p{L}\\p{N}_-])`, "gu");
  let offset = 0;
  for (const match of text.matchAll(matcher)) {
    editor.append(document.createTextNode(text.slice(offset, match.index)));
    const resource = resources.find(item => item.referenceName === match[1]);
    editor.append(resource ? createResourceMention(resource) : document.createTextNode(match[0]));
    offset = match.index + match[0].length;
  }
  editor.append(document.createTextNode(text.slice(offset)));
}

function syncPromptModeUi() {
  const promptMode = isPromptMode();
  $("video-prompt").hidden = promptMode;
  $("video-prompt-text").hidden = !promptMode;
  $("storyboard-prompt-mode").setAttribute("aria-pressed", String(!promptMode));
  $("plain-prompt-mode").setAttribute("aria-pressed", String(promptMode));
  for (const id of ["open-film-style", "open-final-storyboard", "inspect-storyboards", "open-video-prompt-builder"])
    $(id).disabled = busy || promptMode || (id === "open-video-prompt-builder" && promptBuilderMinimized);
  syncStoryboardPdfAvailability();
  syncGenerateAvailability();
}

function selectPromptMode(mode) {
  if (busy || mode === promptEditorMode) return;
  if (mode === "prompt") {
    promptModeSource = completeVideoPrompt();
    fillPromptEditor(promptModeSource);
    promptEditorMode = "prompt";
  } else {
    const current = editorText($("video-prompt-text"));
    if (current !== promptModeSource && !parseStoryboardPrompt(current)
      && !window.confirm("此操作會清除所有輸入內容，是否繼續？")) return;
    if (current !== promptModeSource) {
      storyboards.clear();
      $("video-prompt").replaceChildren();
      finalStoryboard = null;
      filmStyle = { ...EMPTY_FILM_STYLE };
      renderFinalStoryboardCard();
    }
    promptEditorMode = "storyboard";
  }
  syncPromptModeUi();
  syncDraftStatus();
}

function syncDraftStatus(saveDraft = true) {
  if (!busy) setStatus(editorText(activePromptEditor()) ? "影片細節已輸入" : "等待輸入影片細節");
  syncGenerateAvailability();
  syncClearWorkspaceAvailability();
  syncStoryboardPdfAvailability();
  if (saveDraft) scheduleAutoDraft();
}

function showVideoPromptBuilder() {
  hideCharacterMentionMenu();
  hideResourceMentionMenu();
  promptBuilderMinimized = false;
  $("restore-video-prompt-builder").hidden = true;
  $("open-video-prompt-builder").disabled = true;
  $("video-prompt-builder-dialog").returnValue = "";
  $("video-prompt-builder-dialog").showModal();
  $("video-prompt-start").focus();
}

function resetVideoPromptBuilder() {
  $("video-prompt-builder-form").reset();
  document.querySelectorAll("#video-prompt-builder-dialog .resource-editor").forEach(clearEditor);
  renderStoryboardCharacterControls([], "", "");
  renderDialogueRows();
  syncCameraControls();
  syncViewControls();
  syncActionControls();
  syncLightingControls();
  editingStoryboardId = "";
  $("submit-video-prompt-builder").textContent = "加入分鏡";
}

function arrangeVideoPromptBuilderFields() {
  const fields = $("video-prompt-builder-dialog").querySelector(".video-prompt-builder-fields");
  const left = document.createElement("div");
  const right = document.createElement("div");
  left.className = "video-prompt-builder-column video-prompt-builder-column-left";
  right.className = "video-prompt-builder-column video-prompt-builder-column-right";
  left.append(
    fields.querySelector(".video-prompt-time-fields"),
    fields.querySelector(".video-prompt-camera-field"),
    fields.querySelector(".video-prompt-view-field"),
    fields.querySelector(".video-prompt-lighting-field"),
  );
  right.append(
    $("video-prompt-scene").closest("label"),
    fields.querySelector(".video-prompt-action-field"),
    $("video-prompt-sound").closest("label"),
  );
  fields.prepend(fields.querySelector(".video-storyboard-summary-field"), left, right);
}

function openVideoPromptBuilder() {
  if (busy) return;
  resetVideoPromptBuilder();
  $("video-prompt-start").value = nextStoryboardStart();
  showVideoPromptBuilder();
}

function syncFilmStyleCustom(focus = false) {
  const custom = $("film-style-primary").value === "custom";
  $("film-style-primary-custom-wrap").hidden = !custom;
  if (custom && focus) $("film-style-primary-custom").focus();
}

function syncNarratorVoiceCustom(focus = false) {
  const custom = $("film-style-narrator-voice").value === "custom";
  $("film-style-narrator-custom-wrap").hidden = !custom;
  if (custom && focus) $("film-style-narrator-custom").focus();
}

function openFilmStyle() {
  if (busy) return;
  $("film-style-primary").value = filmStyle.primary;
  $("film-style-primary-custom").value = filmStyle.primaryCustom;
  $("film-style-era").value = filmStyle.era;
  $("film-style-color").value = filmStyle.color;
  $("film-style-texture").value = filmStyle.texture;
  $("film-style-framing").value = filmStyle.framing;
  $("film-style-narrator-voice").value = filmStyle.narratorVoice;
  $("film-style-narrator-custom").value = filmStyle.narratorCustom;
  $("film-style-notes").value = filmStyle.notes;
  syncFilmStyleCustom();
  syncNarratorVoiceCustom();
  $("film-style-dialog").returnValue = "";
  $("film-style-dialog").showModal();
  $("film-style-primary").focus();
}

function applyFilmStyle() {
  filmStyle = {
    primary: $("film-style-primary").value,
    primaryCustom: $("film-style-primary-custom").value.trim(),
    era: $("film-style-era").value,
    color: $("film-style-color").value,
    texture: $("film-style-texture").value,
    framing: $("film-style-framing").value,
    narratorVoice: $("film-style-narrator-voice").value,
    narratorCustom: $("film-style-narrator-custom").value.trim(),
    notes: $("film-style-notes").value.trim(),
  };
  const configured = Boolean(filmStyleText());
  $("open-film-style").classList.toggle("configured", configured);
  $("open-film-style").textContent = configured ? "全片風格（已設定）" : "全片風格";
  $("film-style-dialog").close();
  syncClearWorkspaceAvailability();
  scheduleAutoDraft();
}

function cloneSelectOptions(sourceId, targetId) {
  $(targetId).replaceChildren(...[...$(sourceId).children].map(option => option.cloneNode(true)));
}

function finalStoryboardCharacterSelect(selected = "") {
  const select = document.createElement("select");
  select.className = "setting-select final-storyboard-action-character";
  select.setAttribute("aria-label", "最終分鏡執行角色");
  const choices = [
    ["", "未指定執行角色"],
    ["__all__", "所有畫面人物"],
    ...characterTemplates.filter(character => character.enabled !== false && character.name).map(character => [character.name, character.name]),
  ];
  if (selected && !choices.some(([value]) => value === selected)) choices.push([selected, `${selected}（目前未啟用）`]);
  select.append(...choices.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  select.value = selected;
  return select;
}

function syncFinalStoryboardAction(row, selectedAction = "", focusCustom = false) {
  const category = row.querySelector(".final-storyboard-action-category").value;
  const actionSelect = row.querySelector(".final-storyboard-action-type");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = category ? "選擇動作內容" : "請先選擇動作類別";
  const options = (STORYBOARD_ACTIONS[category] || []).map(action => {
    const option = document.createElement("option");
    option.value = action;
    option.textContent = action;
    return option;
  });
  if (category) {
    const custom = document.createElement("option");
    custom.value = "custom";
    custom.textContent = "自訂動作（開放輸入）";
    options.push(custom);
  }
  actionSelect.replaceChildren(placeholder, ...options);
  actionSelect.disabled = !category;
  actionSelect.value = options.some(option => option.value === selectedAction) ? selectedAction : "";
  const customEditor = row.querySelector(".final-storyboard-action-custom");
  customEditor.hidden = actionSelect.value !== "custom";
  if (!customEditor.hidden && focusCustom) customEditor.focus();
}

function createFinalStoryboardAction(action = {}) {
  const row = document.createElement("div");
  row.className = "final-storyboard-action-row";
  const selects = document.createElement("div");
  selects.className = "video-action-selects final-storyboard-action-selects";
  const character = finalStoryboardCharacterSelect(action.actionCharacter || "");
  const category = document.createElement("select");
  category.className = "setting-select final-storyboard-action-category";
  category.setAttribute("aria-label", "最終分鏡動作類別");
  category.append(...[...$("video-prompt-action-category").children].map(option => option.cloneNode(true)));
  category.value = action.actionCategory || "";
  const type = document.createElement("select");
  type.className = "setting-select final-storyboard-action-type";
  type.setAttribute("aria-label", "最終分鏡動作內容");
  const style = document.createElement("select");
  style.className = "setting-select final-storyboard-action-style";
  style.setAttribute("aria-label", "最終分鏡動作速度或力度");
  style.append(...[...$("video-prompt-action-style").children].map(option => option.cloneNode(true)));
  style.value = action.actionStyle || "";
  selects.append(character, category, type, style);
  const createEditor = (kind, label, placeholder, value = "") => {
    const editor = document.createElement("div");
    editor.className = `text-input resource-editor resource-editor-single final-storyboard-action-${kind}`;
    editor.contentEditable = "true";
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-label", label);
    editor.dataset.placeholder = placeholder;
    editor.innerHTML = value;
    setupResourceEditor(editor);
    return editor;
  };
  const custom = createEditor("custom", "最終分鏡自訂動作", "輸入自訂動作，也可使用 @ 資源或 # 人物", action.actionCustom);
  const target = createEditor("target", "最終分鏡動作目標或物件", "目標／物件，可使用 @ 資源或 # 人物", action.actionTarget);
  const detail = createEditor("detail", "最終分鏡動作補充", "補充連續動作或細節", action.actionDetail);
  const targetCaption = document.createElement("span");
  targetCaption.className = "video-action-caption";
  targetCaption.textContent = "目標／物件";
  const detailCaption = document.createElement("span");
  detailCaption.className = "video-action-caption";
  detailCaption.textContent = "動作補充";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "final-storyboard-action-remove";
  remove.setAttribute("aria-label", "刪除動作");
  remove.textContent = "−";
  remove.addEventListener("click", () => row.remove());
  row.append(selects, remove, custom, targetCaption, target, detailCaption, detail);
  category.addEventListener("change", () => syncFinalStoryboardAction(row));
  type.addEventListener("change", () => syncFinalStoryboardAction(row, type.value, true));
  syncFinalStoryboardAction(row, action.actionType || "");
  return row;
}

function renderFinalStoryboardActions(actions = []) {
  const values = actions.length ? actions : [""];
  $("final-storyboard-actions").replaceChildren(...values.map(createFinalStoryboardAction));
}

function resetFinalStoryboardEditor() {
  for (const field of ["scene", "camera-custom", "view-custom", "sound"]) clearEditor($(`final-storyboard-${field}`));
  $("final-storyboard-duration").value = "2";
  $("final-storyboard-actions").replaceChildren();
}

function finalStoryboardDuration(draft = finalStoryboard) {
  const duration = Number(draft?.duration ?? $("final-storyboard-duration")?.value ?? 2);
  return [1, 2, 3].includes(duration) ? duration : 2;
}

function selectedFinalStoryboardSubjects() {
  return [...$("final-storyboard-view-subjects").querySelectorAll("input:checked")].map(input => input.value);
}

function renderFinalStoryboardCharacterControls(selectedSubjects = [], viewpoint = "") {
  const enabled = characterTemplates.filter(character => character.enabled !== false && character.name);
  const subjects = $("final-storyboard-view-subjects");
  subjects.replaceChildren(...(enabled.length ? enabled.map(character => {
    const label = document.createElement("label");
    label.className = "video-view-subject";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = character.name;
    input.checked = selectedSubjects.includes(character.name);
    const text = document.createElement("span");
    text.textContent = character.name;
    label.append(input, text);
    return label;
  }) : [Object.assign(document.createElement("span"), { className: "video-view-subjects-empty", textContent: "尚無已啟用人物" })]));
  const select = $("final-storyboard-viewpoint-character");
  select.replaceChildren(...[["", "選擇視點角色（選填）"], ...enabled.map(character => [character.name, character.name])].map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  select.value = enabled.some(character => character.name === viewpoint) ? viewpoint : "";
}

function syncFinalStoryboardCamera(focusCustom = false) {
  const camera = $("final-storyboard-camera").value;
  $("final-storyboard-camera-speed").disabled = !camera;
  $("final-storyboard-camera-custom").hidden = camera !== "custom";
  if (camera === "custom" && focusCustom) $("final-storyboard-camera-custom").focus();
}

function syncFinalStoryboardView(focusCustom = false) {
  const angle = $("final-storyboard-view-angle").value;
  $("final-storyboard-view-custom").hidden = angle !== "custom";
  const needsViewpoint = ["第一人稱視角", "越肩視角"].includes(angle);
  $("final-storyboard-viewpoint-wrap").hidden = !needsViewpoint;
  if (!needsViewpoint) $("final-storyboard-viewpoint-character").value = "";
  if (angle === "custom" && focusCustom) $("final-storyboard-view-custom").focus();
}

function openFinalStoryboard() {
  if (busy) return;
  restoreEditorHtml("final-storyboard-scene", finalStoryboard?.scene || "");
  restoreEditorHtml("final-storyboard-sound", finalStoryboard?.sound || "");
  $("final-storyboard-duration").value = String(finalStoryboardDuration());
  $("final-storyboard-camera").value = finalStoryboard?.camera || "";
  $("final-storyboard-camera-speed").value = finalStoryboard?.cameraSpeed || "";
  restoreEditorHtml("final-storyboard-camera-custom", finalStoryboard?.cameraCustom || "");
  $("final-storyboard-shot-size").value = finalStoryboard?.shotSize || "";
  $("final-storyboard-view-angle").value = finalStoryboard?.viewAngle || "";
  restoreEditorHtml("final-storyboard-view-custom", finalStoryboard?.viewCustom || "");
  renderFinalStoryboardCharacterControls(finalStoryboard?.viewSubjects || [], finalStoryboard?.viewpointCharacter || "");
  renderFinalStoryboardActions(finalStoryboard?.actions || []);
  syncFinalStoryboardCamera();
  syncFinalStoryboardView();
  $("final-storyboard-dialog").returnValue = "";
  $("final-storyboard-dialog").showModal();
  $("final-storyboard-scene").focus();
}

function submitFinalStoryboard(event) {
  event.preventDefault();
  hideCharacterMentionMenu();
  hideResourceMentionMenu();
  const start = Number(nextStoryboardStart());
  const duration = finalStoryboardDuration(null);
  const draft = {
    start: roundedStoryboardTime(start),
    end: roundedStoryboardTime(start + duration),
    duration,
    scene: editorSnapshot("final-storyboard-scene"),
    camera: $("final-storyboard-camera").value,
    cameraSpeed: $("final-storyboard-camera-speed").value,
    cameraCustom: editorSnapshot("final-storyboard-camera-custom"),
    shotSize: $("final-storyboard-shot-size").value,
    viewAngle: $("final-storyboard-view-angle").value,
    viewCustom: editorSnapshot("final-storyboard-view-custom"),
    viewSubjects: selectedFinalStoryboardSubjects(),
    viewpointCharacter: $("final-storyboard-viewpoint-character").value,
    sound: editorSnapshot("final-storyboard-sound"),
    actions: [...$("final-storyboard-actions").querySelectorAll(".final-storyboard-action-row")].map(row => ({
      actionCharacter: row.querySelector(".final-storyboard-action-character").value,
      actionCategory: row.querySelector(".final-storyboard-action-category").value,
      actionType: row.querySelector(".final-storyboard-action-type").value,
      actionStyle: row.querySelector(".final-storyboard-action-style").value,
      actionCustom: row.querySelector(".final-storyboard-action-custom").innerHTML,
      actionTarget: row.querySelector(".final-storyboard-action-target").innerHTML,
      actionDetail: row.querySelector(".final-storyboard-action-detail").innerHTML,
    })).filter(action => actionPromptField(action)[0]),
  };
  if (!finalStoryboardFields(draft).some(([label]) => label !== "時間")) return;
  finalStoryboard = draft;
  $("final-storyboard-dialog").close();
  resetFinalStoryboardEditor();
  renderFinalStoryboardCard();
  syncDraftStatus();
  document.getElementById("final-storyboard-card")?.focus();
}

function minimizeVideoPromptBuilder() {
  hideCharacterMentionMenu();
  hideResourceMentionMenu();
  promptBuilderMinimized = true;
  $("video-prompt-builder-dialog").close("minimized");
}

function restoreVideoPromptBuilder() {
  if (busy || !promptBuilderMinimized) return;
  showVideoPromptBuilder();
}

function syncCameraControls(focusCustom = false) {
  const custom = $("video-prompt-camera").value === "custom";
  $("video-prompt-camera-speed").disabled = !$("video-prompt-camera").value;
  $("video-prompt-camera-custom").hidden = !custom;
  if (custom && focusCustom) $("video-prompt-camera-custom").focus();
}

function selectedStoryboardSubjects() {
  return [...$("video-prompt-view-subjects").querySelectorAll("input:checked")].map(input => input.value);
}

function renderStoryboardCharacterControls(selectedSubjects = selectedStoryboardSubjects(), viewpoint = $("video-prompt-viewpoint-character").value, actionCharacter = $("video-prompt-action-character").value) {
  const enabledCharacters = characterTemplates.filter(character => character.enabled !== false && character.name);
  const subjects = $("video-prompt-view-subjects");
  if (!enabledCharacters.length) {
    const empty = document.createElement("span");
    empty.className = "video-view-subjects-empty";
    empty.textContent = "尚無已啟用人物";
    subjects.replaceChildren(empty);
  } else {
    subjects.replaceChildren(...enabledCharacters.map(character => {
      const label = document.createElement("label");
      label.className = "video-view-subject";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = character.name;
      input.checked = selectedSubjects.includes(character.name);
      const text = document.createElement("span");
      text.textContent = character.name;
      label.append(input, text);
      return label;
    }));
  }
  const viewpointSelect = $("video-prompt-viewpoint-character");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "選擇視點角色（選填）";
  viewpointSelect.replaceChildren(placeholder, ...enabledCharacters.map(character => {
    const option = document.createElement("option");
    option.value = character.name;
    option.textContent = character.name;
    return option;
  }));
  viewpointSelect.value = enabledCharacters.some(character => character.name === viewpoint) ? viewpoint : "";

  const actionSelect = $("video-prompt-action-character");
  const unspecified = document.createElement("option");
  unspecified.value = "";
  unspecified.textContent = "未指定執行角色";
  const everyone = document.createElement("option");
  everyone.value = "__all__";
  everyone.textContent = "所有畫面人物";
  actionSelect.replaceChildren(unspecified, everyone, ...enabledCharacters.map(character => {
    const option = document.createElement("option");
    option.value = character.name;
    option.textContent = character.name;
    return option;
  }));
  actionSelect.value = actionCharacter === "__all__" || enabledCharacters.some(character => character.name === actionCharacter) ? actionCharacter : "";
}

function dialogueSpeakerSelect(selected = "") {
  const select = document.createElement("select");
  select.className = "setting-select video-dialogue-speaker";
  select.setAttribute("aria-label", "說話者");
  const choices = [
    ["", "選擇說話者"],
    ["__narrator__", "旁白"],
    ...characterTemplates.filter(character => character.enabled !== false && character.name).map(character => [character.name, character.name]),
  ];
  if (selected && !choices.some(([value]) => value === selected)) choices.push([selected, `${selected}（目前未啟用）`]);
  select.append(...choices.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  select.value = selected;
  return select;
}

function dialogueAction(label, text, handler, kind = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `video-dialogue-action ${kind}`.trim();
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = text;
  button.addEventListener("click", handler);
  return button;
}

function syncDialogueOrderButtons() {
  const rows = [...$("video-dialogue-list").querySelectorAll(".video-dialogue-row")];
  rows.forEach((row, index) => {
    row.querySelector('[data-dialogue-action="up"]').disabled = index === 0;
    row.querySelector('[data-dialogue-action="down"]').disabled = index === rows.length - 1;
  });
}

function createDialogueRow(dialogue = {}) {
  const row = document.createElement("div");
  row.className = "video-dialogue-row";
  const speaker = dialogueSpeakerSelect(dialogue.speaker || "");
  const emotion = document.createElement("input");
  emotion.type = "text";
  emotion.className = "text-input video-dialogue-emotion";
  emotion.placeholder = "口氣／情緒（選填）";
  emotion.setAttribute("aria-label", "口氣或情緒");
  emotion.value = dialogue.emotion || "";
  const text = document.createElement("input");
  text.type = "text";
  text.className = "text-input video-dialogue-text";
  text.setAttribute("aria-label", "對話內容");
  text.placeholder = "輸入對話";
  text.value = htmlText(dialogue.text || "");
  const actions = document.createElement("div");
  actions.className = "video-dialogue-actions";
  const moveUp = dialogueAction("向上移動對話", "↑", () => {
    const previous = row.previousElementSibling;
    if (previous) row.parentElement.insertBefore(row, previous);
    syncDialogueOrderButtons();
  });
  moveUp.dataset.dialogueAction = "up";
  const moveDown = dialogueAction("向下移動對話", "↓", () => {
    const next = row.nextElementSibling;
    if (next) row.parentElement.insertBefore(next, row);
    syncDialogueOrderButtons();
  });
  moveDown.dataset.dialogueAction = "down";
  const remove = dialogueAction("刪除對話", "×", () => {
    row.remove();
    syncDialogueEmptyState();
  }, "remove");
  actions.append(moveUp, moveDown, remove);
  row.append(speaker, emotion, text, actions);
  return row;
}

function syncDialogueEmptyState() {
  const list = $("video-dialogue-list");
  let empty = list.querySelector(".video-dialogue-empty");
  if (list.querySelector(".video-dialogue-row")) {
    empty?.remove();
    syncDialogueOrderButtons();
    return;
  }
  if (!empty) {
    empty = document.createElement("div");
    empty.className = "video-dialogue-empty";
    empty.textContent = "尚未加入人物對話或旁白。";
    list.append(empty);
  }
}

function renderDialogueRows(dialogues = []) {
  const rows = dialogues.map(createDialogueRow);
  $("video-dialogue-list").replaceChildren(...rows);
  syncDialogueEmptyState();
}

function escapedTextHtml(text) {
  const holder = document.createElement("div");
  holder.textContent = text || "";
  return holder.innerHTML;
}

function collectDialogueRows() {
  return [...$("video-dialogue-list").querySelectorAll(".video-dialogue-row")].map(row => ({
    speaker: row.querySelector(".video-dialogue-speaker").value,
    emotion: row.querySelector(".video-dialogue-emotion").value.trim(),
    text: escapedTextHtml(row.querySelector(".video-dialogue-text").value),
  })).filter(dialogue => htmlText(dialogue.text));
}

function syncViewControls(focusCustom = false) {
  const angle = $("video-prompt-view-angle").value;
  const custom = angle === "custom";
  const needsViewpoint = ["第一人稱視角", "越肩視角"].includes(angle);
  $("video-prompt-view-custom").hidden = !custom;
  $("video-prompt-viewpoint-wrap").hidden = !needsViewpoint;
  if (!needsViewpoint) $("video-prompt-viewpoint-character").value = "";
  if (custom && focusCustom) $("video-prompt-view-custom").focus();
}

function syncActionControls(selectedAction = "", focusCustom = false) {
  const category = $("video-prompt-action-category").value;
  const actionSelect = $("video-prompt-action-type");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = category ? "選擇動作內容" : "請先選擇動作類別";
  const options = (STORYBOARD_ACTIONS[category] || []).map(action => {
    const option = document.createElement("option");
    option.value = action;
    option.textContent = action;
    return option;
  });
  if (category) {
    const custom = document.createElement("option");
    custom.value = "custom";
    custom.textContent = "自訂動作（開放輸入）";
    options.push(custom);
  }
  actionSelect.replaceChildren(placeholder, ...options);
  actionSelect.disabled = !category;
  actionSelect.value = options.some(option => option.value === selectedAction) ? selectedAction : "";
  const custom = actionSelect.value === "custom";
  $("video-prompt-action-custom").hidden = !custom;
  if (custom && focusCustom) $("video-prompt-action-custom").focus();
}

function cameraPromptField() {
  const motion = $("video-prompt-camera").value;
  if (!motion) return ["", null];
  const speed = $("video-prompt-camera-speed").value;
  if (motion !== "custom") return [`${speed}${motion}`, null];
  const editor = $("video-prompt-camera-custom");
  const value = editorText(editor);
  if (!value) return ["", null];
  const nodes = [...editor.childNodes];
  if (speed) nodes.unshift(document.createTextNode(`${speed} `));
  return [`${speed}${speed ? " " : ""}${value}`, nodes];
}

function syncLightingControls(focusCustom = false) {
  const lighting = $("video-prompt-lighting").value;
  const custom = lighting === "custom";
  $("video-prompt-lighting-temperature").disabled = !lighting;
  $("video-prompt-lighting-intensity").disabled = !lighting;
  $("video-prompt-lighting-custom").hidden = !custom;
  if (custom && focusCustom) $("video-prompt-lighting-custom").focus();
}

function lightingPromptField() {
  const lighting = $("video-prompt-lighting").value;
  if (!lighting) return ["", null];
  const temperature = $("video-prompt-lighting-temperature").value;
  const intensity = $("video-prompt-lighting-intensity").value;
  const prefix = `${intensity}${temperature}`;
  if (lighting !== "custom") return [`${prefix}${lighting}`, null];
  const editor = $("video-prompt-lighting-custom");
  const value = editorText(editor);
  if (!value) return ["", null];
  const nodes = [...editor.childNodes];
  if (prefix) nodes.unshift(document.createTextNode(`${prefix} `));
  return [`${prefix}${prefix ? " " : ""}${value}`, nodes];
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
  characterMentionMatch = null;
  characterMentionActiveIndex = 0;
}

function positionCharacterMentionMenu(target, optionCount) {
  const menu = $("character-mention-menu");
  const dialog = target.closest("dialog");
  const boundary = dialog?.getBoundingClientRect() || { top: 0, right: window.innerWidth, bottom: window.innerHeight, left: 0, width: window.innerWidth };
  const targetRect = target.getBoundingClientRect();
  const menuHeight = Math.min(optionCount * 50 + 14, 220);
  const availableBelow = boundary.bottom - targetRect.bottom - 12;
  const top = availableBelow >= Math.min(menuHeight, 150)
    ? targetRect.bottom + 6
    : Math.max(boundary.top + 12, targetRect.top - menuHeight - 6);
  const width = Math.min(Math.max(targetRect.width, 210), boundary.width - 24);
  const left = Math.min(Math.max(targetRect.left, boundary.left + 12), boundary.right - width - 12);
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
  if (!target || !characterMentionMatch) return;
  replaceMentionText(characterMentionMatch, document.createTextNode(name));
  hideCharacterMentionMenu();
  target.focus();
}

function showCharacterMentionMenu(target) {
  const match = triggerAtCaret(target, "#");
  const enabledCharacters = characterTemplates.filter(character => character.enabled !== false && character.name);
  if (!match || !enabledCharacters.length) {
    hideCharacterMentionMenu();
    return;
  }
  const matches = enabledCharacters.filter(character => character.name.toLocaleLowerCase().includes(match.query.toLocaleLowerCase()));
  if (!matches.length) {
    hideCharacterMentionMenu();
    return;
  }
  characterMentionTarget = target;
  characterMentionMatch = match;
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
  const menuHost = target.closest("dialog") || document.body;
  if (menu.parentElement !== menuHost) menuHost.append(menu);
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

function hideResourceMentionMenu() {
  const menu = $("resource-mention-menu");
  menu.hidden = true;
  menu.replaceChildren();
  resourceMentionTarget?.setAttribute("aria-expanded", "false");
  resourceMentionTarget?.removeAttribute("aria-activedescendant");
  resourceMentionTarget = null;
  resourceMentionMatch = null;
  resourceMentionActiveIndex = 0;
}

function resourceIcon(kind) {
  return kind === "image" ? "▧" : kind === "audio" ? "♪" : "▶";
}

function positionResourceMentionMenu(target, optionCount) {
  const rect = target.getBoundingClientRect();
  const width = Math.min(Math.max(rect.width * .6, 280), 440);
  const menuHeight = Math.min(optionCount * 54 + 14, 248);
  const below = window.innerHeight - rect.bottom;
  const top = below > Math.min(menuHeight, 160) ? rect.bottom + 6 : Math.max(10, rect.top - menuHeight - 6);
  const left = Math.min(Math.max(10, rect.left), window.innerWidth - width - 10);
  Object.assign($("resource-mention-menu").style, { top: `${top}px`, left: `${left}px`, width: `${width}px` });
}

function setResourceMentionActive(index) {
  const options = [...$("resource-mention-menu").querySelectorAll(".resource-mention-option")];
  if (!options.length) return;
  resourceMentionActiveIndex = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    const active = optionIndex === resourceMentionActiveIndex;
    option.classList.toggle("active", active);
    option.setAttribute("aria-selected", String(active));
  });
  resourceMentionTarget?.setAttribute("aria-activedescendant", options[resourceMentionActiveIndex].id);
  options[resourceMentionActiveIndex].scrollIntoView({ block: "nearest" });
}

function createResourceMention(resource) {
  const mention = document.createElement("span");
  mention.className = "resource-token";
  mention.contentEditable = "false";
  mention.tabIndex = 0;
  mention.setAttribute("role", "button");
  mention.dataset.resourceId = resource.id;
  mention.title = `預覽 ${resource.referenceName}；按 Backspace 或 Delete 移除引用`;
  mention.textContent = `@${resource.referenceName}`;
  return mention;
}

function removeResourceMention(token, editor = token.closest(".resource-editor")) {
  if (!editor || !token.matches(".resource-token")) return false;
  const storyboardBlock = token.closest(".storyboard-block");
  const storyboardField = token.closest(".storyboard-field")?.dataset.field;
  const storyboardProperty = token.dataset.storyboardProperty;
  const storyboardDialogueIndex = token.dataset.storyboardDialogueIndex;
  const resourceId = token.dataset.resourceId;
  const parent = token.parentNode;
  const tokenIndex = [...parent.childNodes].indexOf(token);
  const spacer = token.nextSibling;
  if (spacer?.nodeType === Node.TEXT_NODE && spacer.data.startsWith(" ")) spacer.deleteData(0, 1);
  if (spacer?.nodeType === Node.TEXT_NODE && !spacer.data) spacer.remove();
  token.remove();
  if (storyboardBlock && storyboardField) removeStoredStoryboardReference(storyboardBlock.dataset.storyboardId, storyboardField, resourceId, storyboardProperty, storyboardDialogueIndex);

  editor.focus();
  const range = document.createRange();
  range.setStart(parent, Math.min(tokenIndex, parent.childNodes.length));
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function resourceMentionBesideCaret(editor, direction) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed || !editor.contains(selection.anchorNode)) return null;
  const node = selection.anchorNode;
  const offset = selection.anchorOffset;
  let candidate = null;
  if (node === editor || node?.nodeType === Node.ELEMENT_NODE) {
    candidate = direction < 0 ? node.childNodes[offset - 1] : node.childNodes[offset];
  } else if (node?.nodeType === Node.TEXT_NODE) {
    const nearbyText = direction < 0 ? node.data.slice(0, offset) : node.data.slice(offset);
    if (!nearbyText.trim()) candidate = direction < 0 ? node.previousSibling : node.nextSibling;
  }
  return candidate?.nodeType === Node.ELEMENT_NODE && candidate.matches(".resource-token") ? candidate : null;
}

function removeResourceMentionAtCaret(event, editor) {
  if (!event.isComposing && ["Backspace", "Delete"].includes(event.key)) {
    const token = resourceMentionBesideCaret(editor, event.key === "Backspace" ? -1 : 1);
    if (token) {
      event.preventDefault();
      return removeResourceMention(token, editor);
    }
  }
  return false;
}

function selectResourceMention(resource) {
  if (!resourceMentionTarget || !resourceMentionMatch) return;
  replaceMentionText(resourceMentionMatch, createResourceMention(resource));
  const target = resourceMentionTarget;
  hideResourceMentionMenu();
  target.focus();
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function showResourceMentionMenu(target) {
  const match = triggerAtCaret(target, "@");
  if (!match || !videoResources.length) {
    hideResourceMentionMenu();
    return false;
  }
  const query = match.query.toLocaleLowerCase();
  const matches = videoResources.filter(resource => resource.referenceName.toLocaleLowerCase().includes(query));
  if (!matches.length) {
    hideResourceMentionMenu();
    return false;
  }
  hideCharacterMentionMenu();
  resourceMentionTarget = target;
  resourceMentionMatch = match;
  resourceMentionActiveIndex = 0;
  const options = matches.map((resource, index) => {
    const option = document.createElement("button");
    option.id = `resource-mention-option-${index}`;
    option.type = "button";
    option.className = `resource-mention-option${index === 0 ? " active" : ""}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(index === 0));
    const icon = document.createElement("span");
    icon.className = "resource-option-icon";
    icon.textContent = resourceIcon(resource.kind);
    const detail = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = resource.referenceName;
    const original = document.createElement("small");
    original.textContent = resource.originalName;
    detail.append(name, original);
    option.append(icon, detail);
    option.addEventListener("mousedown", event => {
      event.preventDefault();
      selectResourceMention(resource);
    });
    return option;
  });
  const menu = $("resource-mention-menu");
  const menuHost = target.closest("dialog") || document.body;
  if (menu.parentElement !== menuHost) menuHost.append(menu);
  menu.replaceChildren(...options);
  menu.hidden = false;
  target.setAttribute("aria-expanded", "true");
  target.setAttribute("aria-controls", "resource-mention-menu");
  target.setAttribute("aria-activedescendant", options[0].id);
  positionResourceMentionMenu(target, options.length);
  return true;
}

function handleResourceMentionKeydown(event) {
  const menu = $("resource-mention-menu");
  if (!menu.hidden) {
    const options = [...menu.querySelectorAll(".resource-mention-option")];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setResourceMentionActive(resourceMentionActiveIndex + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Enter" && options[resourceMentionActiveIndex]) {
      event.preventDefault();
      options[resourceMentionActiveIndex].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hideResourceMentionMenu();
      return;
    }
  }
}

function handleResourceEditorInput(event) {
  const target = event.currentTarget;
  if (!editorText(target) && target.childNodes.length) target.replaceChildren();
  if (showResourceMentionMenu(target)) return;
  showCharacterMentionMenu(target);
  if (["video-prompt", "video-prompt-text"].includes(target.id)) syncDraftStatus();
}

function handlePlainTextPaste(event) {
  event.preventDefault();
  document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") || "");
}

function setupResourceEditor(editor) {
  if (initializedResourceEditors.has(editor)) return;
  initializedResourceEditors.add(editor);
  editor.setAttribute("aria-autocomplete", "list");
  editor.setAttribute("aria-expanded", "false");
  editor.addEventListener("input", handleResourceEditorInput);
  editor.addEventListener("keydown", event => {
    if (removeResourceMentionAtCaret(event, editor)) return;
    if (!$("resource-mention-menu").hidden) handleResourceMentionKeydown(event);
    else handleCharacterMentionKeydown(event);
    if (!event.defaultPrevented && editor.classList.contains("resource-editor-single") && event.key === "Enter") event.preventDefault();
  });
  editor.addEventListener("paste", handlePlainTextPaste);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function readMediaDuration(file, kind) {
  if (kind === "image") return Promise.resolve(null);
  return new Promise(resolve => {
    const media = document.createElement(kind === "audio" ? "audio" : "video");
    const url = URL.createObjectURL(file);
    let completed = false;
    const finish = value => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) ? value : null);
    };
    const timeout = setTimeout(() => finish(null), 5000);
    media.preload = "metadata";
    media.onloadedmetadata = () => finish(media.duration);
    media.onerror = () => finish(null);
    media.src = url;
  });
}

function releaseResourceUrls() {
  resourcePreviewUrls.forEach(url => URL.revokeObjectURL(url));
  resourcePreviewUrls.clear();
}

function createResourceCard(resource) {
  const card = document.createElement("article");
  card.className = "video-resource-card";
  const preview = document.createElement("button");
  preview.type = "button";
  preview.className = "video-resource-card-preview";
  preview.setAttribute("aria-label", `預覽 ${resource.referenceName}`);
  if (resource.kind === "image") {
    const image = document.createElement("img");
    const url = URL.createObjectURL(resource.file);
    resourcePreviewUrls.add(url);
    image.src = url;
    image.alt = "";
    preview.append(image);
  } else {
    const icon = document.createElement("span");
    icon.textContent = resourceIcon(resource.kind);
    preview.append(icon);
  }
  const details = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = resource.referenceName;
  const original = document.createElement("small");
  original.textContent = resource.originalName;
  const meta = document.createElement("small");
  meta.textContent = [resourceTypeLabel(resource.kind), formatResourceSize(resource.file?.size), formatDuration(resource.duration)].filter(Boolean).join(" · ");
  details.append(name, original, meta);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "video-resource-remove";
  remove.textContent = "刪除";
  remove.addEventListener("click", () => void deleteVideoResource(resource.id));
  preview.addEventListener("click", () => openResourcePreview(resource.id));
  card.append(preview, details, remove);
  return card;
}

function renderVideoResources() {
  releaseResourceUrls();
  $("video-resource-list").replaceChildren(...videoResources.map(createResourceCard));
  $("video-resource-empty").hidden = Boolean(videoResources.length);
  syncClearWorkspaceAvailability();
}

async function addVideoResources(files) {
  const unsupported = [];
  let added = 0;
  for (const file of files) {
    const kind = resourceKind(file);
    if (!kind) {
      unsupported.push(file.name);
      continue;
    }
    const next = nextResourceReference(videoResources, kind, resourceCounters);
    resourceCounters[kind] = next.nextNumber;
    videoResources.push({
      id: globalThis.crypto?.randomUUID?.() || `resource-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind,
      referenceName: next.referenceName,
      originalName: file.name || next.referenceName,
      mimeType: file.type || "",
      file,
      duration: await readMediaDuration(file, kind),
      createdAt: Date.now(),
    });
    added += 1;
  }
  $("video-resource-input").value = "";
  renderVideoResources();
  scheduleAutoDraft({ resources: true });
  if (unsupported.length) setStatus(`${added ? `已加入 ${added} 個資源；` : ""}${unsupported.length} 個檔案格式不支援`, "error");
  else setStatus(`已加入 ${added} 個資源`, "success");
}

function resourceReferenceCount(id) {
  return [...document.querySelectorAll(".resource-token")].filter(token => token.dataset.resourceId === id).length;
}

async function deleteVideoResource(id) {
  const resource = videoResources.find(item => item.id === id);
  if (!resource) return;
  const references = resourceReferenceCount(id);
  const message = references
    ? `${resource.referenceName} 已被引用 ${references} 次，刪除後引用將標示為資源不存在，是否刪除？`
    : `確定刪除 ${resource.referenceName}？`;
  if (!window.confirm(message)) return;
  videoResources = videoResources.filter(item => item.id !== id);
  document.querySelectorAll(".resource-token").forEach(token => {
    if (token.dataset.resourceId !== id) return;
    token.classList.add("missing");
    token.title = "資源不存在";
  });
  renderVideoResources();
  scheduleAutoDraft({ resources: true });
}

function stopResourcePreview() {
  for (const id of ["video-resource-preview-audio", "video-resource-preview-video"]) {
    const media = $(id);
    media.pause();
    media.removeAttribute("src");
    media.hidden = true;
  }
  const image = $("video-resource-preview-image");
  image.removeAttribute("src");
  image.hidden = true;
  if (activeResourcePreviewUrl) URL.revokeObjectURL(activeResourcePreviewUrl);
  activeResourcePreviewUrl = "";
}

function openResourcePreview(id) {
  const resource = videoResources.find(item => item.id === id);
  if (!resource) {
    setStatus("引用的資源已不存在", "error");
    return;
  }
  stopResourcePreview();
  activeResourcePreviewUrl = URL.createObjectURL(resource.file);
  $("video-resource-preview-title").textContent = resource.referenceName;
  $("video-resource-preview-meta").textContent = [resource.originalName, resourceTypeLabel(resource.kind), formatResourceSize(resource.file.size), formatDuration(resource.duration)].filter(Boolean).join(" · ");
  const target = resource.kind === "image" ? $("video-resource-preview-image") : resource.kind === "audio" ? $("video-resource-preview-audio") : $("video-resource-preview-video");
  target.src = activeResourcePreviewUrl;
  target.hidden = false;
  $("video-resource-preview-dialog").showModal();
}

function htmlNodes(html) {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  return [...template.content.childNodes];
}

function htmlText(html) {
  const holder = document.createElement("div");
  holder.append(...htmlNodes(html));
  return editorText(holder);
}

function editorSnapshot(id) {
  return $(id).innerHTML;
}

function prefixedNodes(prefix, html) {
  const nodes = htmlNodes(html);
  if (prefix) nodes.unshift(document.createTextNode(`${prefix} `));
  return nodes;
}

function removeStoredStoryboardReference(storyboardId, field, resourceId, storedProperty = "", dialogueIndex = "") {
  const draft = storyboards.get(storyboardId);
  if (!draft) return;
  const property = storedProperty || (field === "camera" ? "cameraCustom" : field === "view" ? "viewCustom" : field === "lighting" ? "lightingCustom" : field);
  if (!(property in draft)) return;
  const removeFromHtml = html => {
    const template = document.createElement("template");
    template.innerHTML = html || "";
    template.content.querySelectorAll(".resource-token").forEach(token => {
      if (token.dataset.resourceId !== resourceId) return;
      const spacer = token.nextSibling;
      if (spacer?.nodeType === Node.TEXT_NODE && spacer.data.startsWith(" ")) spacer.deleteData(0, 1);
      token.remove();
    });
    return template.innerHTML;
  };
  if (property === "dialogues" && Array.isArray(draft.dialogues)) {
    const index = Number(dialogueIndex);
    if (Number.isInteger(index) && draft.dialogues[index]) draft.dialogues[index].text = removeFromHtml(draft.dialogues[index].text);
    return;
  }
  draft[property] = removeFromHtml(draft[property]);
}

function collectStoryboardDraft() {
  return {
    id: editingStoryboardId || globalThis.crypto?.randomUUID?.() || `storyboard-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    start: $("video-prompt-start").value,
    end: $("video-prompt-end").value,
    summary: $("video-prompt-summary").value.trim(),
    scene: editorSnapshot("video-prompt-scene"),
    shotSize: $("video-prompt-shot-size").value,
    viewAngle: $("video-prompt-view-angle").value,
    viewCustom: editorSnapshot("video-prompt-view-custom"),
    viewSubjects: selectedStoryboardSubjects(),
    viewpointCharacter: $("video-prompt-viewpoint-character").value,
    sound: editorSnapshot("video-prompt-sound"),
    actionCharacter: $("video-prompt-action-character").value,
    actionCategory: $("video-prompt-action-category").value,
    actionType: $("video-prompt-action-type").value,
    actionStyle: $("video-prompt-action-style").value,
    actionCustom: editorSnapshot("video-prompt-action-custom"),
    actionTarget: editorSnapshot("video-prompt-action-target"),
    actionDetail: editorSnapshot("video-prompt-action-detail"),
    dialogues: collectDialogueRows(),
    camera: $("video-prompt-camera").value,
    cameraSpeed: $("video-prompt-camera-speed").value,
    cameraCustom: editorSnapshot("video-prompt-camera-custom"),
    lighting: $("video-prompt-lighting").value,
    lightingTemperature: $("video-prompt-lighting-temperature").value,
    lightingIntensity: $("video-prompt-lighting-intensity").value,
    lightingCustom: editorSnapshot("video-prompt-lighting-custom"),
  };
}

function nextStoryboardStart() {
  const blocks = document.querySelectorAll("#video-prompt .storyboard-block:not(.final-storyboard-block)");
  const last = blocks[blocks.length - 1];
  return last ? storyboards.get(last.dataset.storyboardId)?.end || "0" : "0";
}

function formatStoryboardTime(start, end) {
  return `${Number(start)}-${Number(end)}s`;
}

function roundedStoryboardTime(value) {
  return String(Math.round(Number(value) * 10) / 10);
}

function viewPromptField(draft) {
  const customText = htmlText(draft.viewCustom);
  const angle = draft.viewAngle === "custom" ? customText : draft.viewAngle;
  const parts = [
    draft.shotSize,
    angle,
    draft.viewpointCharacter ? `視點角色：${draft.viewpointCharacter}` : "",
    draft.viewSubjects?.length ? `畫面主體：${draft.viewSubjects.join("、")}` : "",
  ].filter(Boolean);
  const value = parts.join("、");
  if (draft.viewAngle !== "custom" || !customText) return [value, null];
  const prefix = [draft.shotSize].filter(Boolean).join("、");
  const suffix = [
    draft.viewpointCharacter ? `視點角色：${draft.viewpointCharacter}` : "",
    draft.viewSubjects?.length ? `畫面主體：${draft.viewSubjects.join("、")}` : "",
  ].filter(Boolean).join("、");
  const nodes = htmlNodes(draft.viewCustom);
  if (prefix) nodes.unshift(document.createTextNode(`${prefix}、`));
  if (suffix) nodes.push(document.createTextNode(`、${suffix}`));
  return [value, nodes];
}

function tagStoryboardProperty(nodes, property, dialogueIndex = -1) {
  nodes.forEach(node => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tokens = node.matches(".resource-token") ? [node] : [...node.querySelectorAll?.(".resource-token") || []];
    tokens.forEach(token => {
      token.dataset.storyboardProperty = property;
      if (dialogueIndex >= 0) token.dataset.storyboardDialogueIndex = String(dialogueIndex);
    });
  });
  return nodes;
}

function appendStoryboardSegment(target, nodes) {
  if (!nodes.length) return;
  if (target.length) target.push(document.createTextNode("，"));
  target.push(...nodes);
}

function actionPromptField(draft) {
  const actor = draft.actionCharacter === "__all__" ? "所有畫面人物" : draft.actionCharacter;
  const customText = htmlText(draft.actionCustom);
  const action = draft.actionType === "custom" ? customText : draft.actionType;
  const targetText = htmlText(draft.actionTarget);
  const detailText = htmlText(draft.actionDetail);
  const head = action ? `${actor || ""}${draft.actionStyle || ""}${action}` : "";
  const value = [head, targetText ? `目標或物件：${targetText}` : "", detailText].filter(Boolean).join("，");
  const nodes = [];
  if (draft.actionType === "custom" && customText) {
    const customNodes = tagStoryboardProperty(htmlNodes(draft.actionCustom), "actionCustom");
    if (actor || draft.actionStyle) customNodes.unshift(document.createTextNode(`${actor || ""}${draft.actionStyle || ""}`));
    appendStoryboardSegment(nodes, customNodes);
  } else if (head) appendStoryboardSegment(nodes, [document.createTextNode(head)]);
  if (targetText) appendStoryboardSegment(nodes, [document.createTextNode("目標或物件："), ...tagStoryboardProperty(htmlNodes(draft.actionTarget), "actionTarget")]);
  if (detailText) appendStoryboardSegment(nodes, tagStoryboardProperty(htmlNodes(draft.actionDetail), "actionDetail"));
  return [value, nodes.length ? nodes : null];
}

function dialoguePromptField(dialogues = []) {
  const lines = dialogues.map((dialogue, index) => {
    const content = htmlText(dialogue.text);
    if (!content) return null;
    const speaker = dialogue.speaker === "__narrator__" ? "旁白" : dialogue.speaker || "未指定人物";
    const prefix = `${speaker}${dialogue.emotion ? `（${dialogue.emotion}）` : ""}：「`;
    const nodes = [document.createTextNode(prefix), ...tagStoryboardProperty(htmlNodes(dialogue.text), "dialogues", index), document.createTextNode("」")];
    return { text: `${prefix}${content}」`, nodes };
  }).filter(Boolean);
  const nodes = [];
  lines.forEach((line, index) => {
    if (index) nodes.push(document.createElement("br"));
    nodes.push(...line.nodes);
  });
  return [lines.map(line => line.text).join("\n"), nodes.length ? nodes : null];
}

function storyboardFields(draft) {
  const cameraPrefix = draft.cameraSpeed || "";
  const cameraCustomText = htmlText(draft.cameraCustom);
  const cameraText = draft.camera === "custom" ? `${cameraPrefix}${cameraPrefix ? " " : ""}${cameraCustomText}` : draft.camera ? `${cameraPrefix}${draft.camera}` : "";
  const cameraNodes = draft.camera === "custom" && cameraCustomText ? prefixedNodes(cameraPrefix, draft.cameraCustom) : null;
  const lightingPrefix = `${draft.lightingIntensity || ""}${draft.lightingTemperature || ""}`;
  const lightingCustomText = htmlText(draft.lightingCustom);
  const lightingText = draft.lighting === "custom" ? `${lightingPrefix}${lightingPrefix ? " " : ""}${lightingCustomText}` : draft.lighting ? `${lightingPrefix}${draft.lighting}` : "";
  const lightingNodes = draft.lighting === "custom" && lightingCustomText ? prefixedNodes(lightingPrefix, draft.lightingCustom) : null;
  const [viewText, viewNodes] = viewPromptField(draft);
  const [actionText, actionNodes] = actionPromptField(draft);
  const [dialogueText, dialogueNodes] = dialoguePromptField(draft.dialogues || []);
  return [
    ["時間", draft.start !== "" && draft.end !== "" ? formatStoryboardTime(draft.start, draft.end) : ""],
    ["場景", htmlText(draft.scene), htmlNodes(draft.scene)],
    ["鏡頭", cameraText, cameraNodes],
    ["視角", viewText, viewNodes],
    ["燈光", lightingText, lightingNodes],
    ["音效", htmlText(draft.sound), htmlNodes(draft.sound)],
    ["動作", actionText, actionNodes],
    ["人物與對話", dialogueText, dialogueNodes],
  ].filter(([, value]) => value);
}

function finalStoryboardFields(draft) {
  if (!draft) return [];
  const cameraPrefix = draft.cameraSpeed || "";
  const cameraCustomText = htmlText(draft.cameraCustom);
  const cameraText = draft.camera === "custom" ? `${cameraPrefix}${cameraPrefix ? " " : ""}${cameraCustomText}` : draft.camera ? `${cameraPrefix}${draft.camera}` : "";
  const cameraNodes = draft.camera === "custom" && cameraCustomText ? prefixedNodes(cameraPrefix, draft.cameraCustom) : null;
  const [viewText, viewNodes] = viewPromptField(draft);
  const actionRows = (draft.actions || []).map(actionPromptField).filter(([value]) => value);
  const actionNodes = [];
  actionRows.forEach(([value, nodes]) => {
    if (actionNodes.length) actionNodes.push(document.createElement("br"));
    actionNodes.push(...(nodes || [document.createTextNode(value)]));
  });
  return [
    ["時間", formatStoryboardTime(draft.start, draft.end)],
    ["場景", htmlText(draft.scene), htmlNodes(draft.scene)],
    ["鏡頭", cameraText, cameraNodes],
    ["視角", viewText, viewNodes],
    ["音效", htmlText(draft.sound), htmlNodes(draft.sound)],
    ["動作", actionRows.map(([value]) => value).join("\n"), actionNodes],
  ].filter(([, value]) => value);
}

function removeFinalStoryboard() {
  if (busy || !finalStoryboard || !window.confirm("確定移除最終分鏡？")) return;
  finalStoryboard = null;
  resetFinalStoryboardEditor();
  renderFinalStoryboardCard();
  syncDraftStatus();
  setStatus("已移除最終分鏡", "success");
}

function renderFinalStoryboardCard() {
  document.getElementById("final-storyboard-card")?.remove();
  const configured = Boolean(finalStoryboard);
  $("open-final-storyboard").classList.toggle("configured", configured);
  $("open-final-storyboard").textContent = configured ? "最終分鏡（已設定）" : "最終分鏡";
  if (!configured) return;
  const start = Number(nextStoryboardStart());
  const duration = finalStoryboardDuration(finalStoryboard);
  finalStoryboard.start = roundedStoryboardTime(start);
  finalStoryboard.end = roundedStoryboardTime(start + duration);
  finalStoryboard.duration = duration;
  const block = document.createElement("article");
  block.id = "final-storyboard-card";
  block.className = "storyboard-block final-storyboard-block";
  block.setAttribute("contenteditable", "false");
  block.setAttribute("role", "group");
  block.setAttribute("aria-label", "編輯最終分鏡");
  block.tabIndex = 0;
  const heading = document.createElement("div");
  heading.className = "storyboard-card-heading";
  const title = document.createElement("strong");
  title.className = "storyboard-card-title";
  title.textContent = "最終分鏡";
  heading.append(title);
  const actions = document.createElement("div");
  actions.className = "storyboard-card-actions";
  actions.append(
    storyboardAction("edit", "編輯最終分鏡", openFinalStoryboard),
    storyboardAction("delete", "移除最終分鏡", removeFinalStoryboard),
  );
  block.append(heading);
  for (const [label, value, nodes] of finalStoryboardFields(finalStoryboard)) {
    const row = document.createElement("div");
    row.className = "storyboard-field";
    const fieldLabel = document.createElement("span");
    fieldLabel.className = "storyboard-field-label";
    fieldLabel.textContent = `${label}：`;
    row.append(fieldLabel, ...(nodes?.length ? nodes.map(node => node.cloneNode(true)) : [document.createTextNode(value)]));
    block.append(row);
  }
  block.append(actions);
  block.addEventListener("click", event => {
    if (event.target.closest(".resource-token, .storyboard-card-action")) return;
    openFinalStoryboard();
  });
  block.addEventListener("keydown", event => {
    if (["Enter", " "].includes(event.key) && event.target === block) {
      event.preventDefault();
      openFinalStoryboard();
    }
  });
  $("video-prompt").append(block);
}

function storyboardAction(kind, label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `storyboard-card-action ${kind}`;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", event => {
    event.stopPropagation();
    handler();
  });
  return button;
}

function refreshStoryboardLabels() {
  const blocks = [...document.querySelectorAll("#video-prompt .storyboard-block:not(.final-storyboard-block)")];
  blocks.forEach((block, index) => {
    block.querySelector(".storyboard-card-title").textContent = `分鏡 ${index + 1}`;
    block.setAttribute("aria-label", `編輯分鏡 ${index + 1}`);
    block.querySelector(".storyboard-card-action.up").disabled = index === 0;
    block.querySelector(".storyboard-card-action.down").disabled = index === blocks.length - 1;
  });
  renderFinalStoryboardCard();
}

function moveStoryboard(id, direction) {
  if (busy || promptBuilderMinimized) return;
  const block = document.querySelector(`[data-storyboard-id="${CSS.escape(id)}"]`);
  const sibling = direction < 0 ? block?.previousElementSibling : block?.nextElementSibling;
  if (!block || !sibling?.matches(".storyboard-block")) return;
  if (direction < 0) sibling.before(block);
  else sibling.after(block);
  refreshStoryboardLabels();
  syncDraftStatus();
}

function redrawStoryboard(id) {
  const block = document.querySelector(`[data-storyboard-id="${CSS.escape(id)}"]`);
  const draft = storyboards.get(id);
  if (block && draft) block.replaceWith(createStoryboardBlock(draft));
}

function reflowStoryboardTimes() {
  const entries = orderedStoryboardEntries();
  if (!entries.length || busy || !window.confirm("將依目前排序從 0 秒開始，重新接續所有分鏡時間，是否繼續？")) return;
  let cursor = 0;
  for (const { draft } of entries) {
    const duration = Math.max(.1, Number(draft.end) - Number(draft.start) || .1);
    draft.start = roundedStoryboardTime(cursor);
    cursor += duration;
    draft.end = roundedStoryboardTime(cursor);
    redrawStoryboard(draft.id);
  }
  refreshStoryboardLabels();
  renderStoryboardInspection(inspectStoryboardProject());
  syncDraftStatus();
  setStatus(`已重新接續 ${entries.length} 個分鏡時間`, "success");
}

function createStoryboardBlock(draft) {
  const block = document.createElement("article");
  block.className = "storyboard-block";
  block.dataset.storyboardId = draft.id;
  block.setAttribute("contenteditable", "false");
  block.setAttribute("role", "group");
  block.tabIndex = 0;
  const heading = document.createElement("div");
  heading.className = "storyboard-card-heading";
  const title = document.createElement("strong");
  title.className = "storyboard-card-title";
  const summary = document.createElement("span");
  summary.className = "storyboard-card-summary";
  summary.textContent = String(draft.summary || "").trim();
  heading.append(title, summary);
  block.append(heading);
  const actions = document.createElement("div");
  actions.className = "storyboard-card-actions";
  actions.append(
    storyboardAction("up", "向上移動", () => moveStoryboard(draft.id, -1)),
    storyboardAction("down", "向下移動", () => moveStoryboard(draft.id, 1)),
    storyboardAction("edit", "編輯分鏡", () => editStoryboard(draft.id)),
    storyboardAction("copy", "複製分鏡", () => duplicateStoryboard(draft.id)),
    storyboardAction("delete", "刪除分鏡", () => deleteStoryboard(draft.id)),
  );
  for (const [label, value, nodes] of storyboardFields(draft)) {
    const row = document.createElement("div");
    row.className = "storyboard-field";
    row.dataset.field = ({ 時間: "time", 場景: "scene", 鏡頭: "camera", 視角: "view", 燈光: "lighting", 音效: "sound", 動作: "action", 人物與對話: "dialogue" })[label];
    const fieldLabel = document.createElement("span");
    fieldLabel.className = "storyboard-field-label";
    fieldLabel.textContent = `${label}：`;
    row.append(fieldLabel, ...(nodes?.length ? nodes.map(node => node.cloneNode(true)) : [document.createTextNode(value)]));
    block.append(row);
  }
  block.append(actions);
  block.addEventListener("click", event => {
    if (event.target.closest(".resource-token, .storyboard-card-action")) return;
    editStoryboard(draft.id);
  });
  block.addEventListener("keydown", event => {
    if (["Enter", " "].includes(event.key) && event.target === block) {
      event.preventDefault();
      editStoryboard(draft.id);
    }
  });
  return block;
}

function restoreEditorHtml(id, html) {
  $(id).innerHTML = html || "";
  $(id).querySelectorAll(".resource-token").forEach(token => {
    if (!videoResources.some(resource => resource.id === token.dataset.resourceId)) {
      token.classList.add("missing");
      token.title = "資源不存在";
    }
  });
}

function editStoryboard(id) {
  if (busy || promptBuilderMinimized) return;
  const draft = storyboards.get(id);
  if (!draft) return;
  resetVideoPromptBuilder();
  editingStoryboardId = id;
  $("video-prompt-start").value = draft.start;
  $("video-prompt-end").value = draft.end;
  $("video-prompt-summary").value = draft.summary || "";
  for (const [field, html] of [["scene", draft.scene], ["sound", draft.sound]]) restoreEditorHtml(`video-prompt-${field}`, html);
  $("video-prompt-camera").value = draft.camera;
  $("video-prompt-camera-speed").value = draft.cameraSpeed;
  restoreEditorHtml("video-prompt-camera-custom", draft.cameraCustom);
  $("video-prompt-shot-size").value = draft.shotSize;
  $("video-prompt-view-angle").value = draft.viewAngle;
  restoreEditorHtml("video-prompt-view-custom", draft.viewCustom);
  renderStoryboardCharacterControls(draft.viewSubjects, draft.viewpointCharacter, draft.actionCharacter);
  renderDialogueRows(draft.dialogues?.length ? draft.dialogues : draft.dialogue ? [{ speaker: "", emotion: "", text: draft.dialogue }] : []);
  $("video-prompt-action-category").value = draft.actionCategory;
  syncActionControls(draft.actionType);
  $("video-prompt-action-style").value = draft.actionStyle;
  restoreEditorHtml("video-prompt-action-custom", draft.actionCustom);
  restoreEditorHtml("video-prompt-action-target", draft.actionTarget);
  restoreEditorHtml("video-prompt-action-detail", draft.actionDetail);
  $("video-prompt-lighting").value = draft.lighting;
  $("video-prompt-lighting-temperature").value = draft.lightingTemperature;
  $("video-prompt-lighting-intensity").value = draft.lightingIntensity;
  restoreEditorHtml("video-prompt-lighting-custom", draft.lightingCustom);
  syncCameraControls();
  syncViewControls();
  syncLightingControls();
  $("submit-video-prompt-builder").textContent = "儲存分鏡";
  showVideoPromptBuilder();
}

function duplicateStoryboard(id) {
  if (promptBuilderMinimized) return;
  const source = storyboards.get(id);
  const sourceBlock = document.querySelector(`[data-storyboard-id="${CSS.escape(id)}"]`);
  if (!source || !sourceBlock) return;
  const copy = structuredClone(source);
  copy.id = globalThis.crypto?.randomUUID?.() || `storyboard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const duration = Number(source.end) - Number(source.start);
  copy.start = roundedStoryboardTime(source.end);
  copy.end = roundedStoryboardTime(Number(copy.start) + duration);
  storyboards.set(copy.id, copy);
  sourceBlock.after(createStoryboardBlock(copy));
  refreshStoryboardLabels();
  syncDraftStatus();
}

function deleteStoryboard(id) {
  if (promptBuilderMinimized) return;
  const block = document.querySelector(`[data-storyboard-id="${CSS.escape(id)}"]`);
  if (!block || !window.confirm("確定刪除這個分鏡？")) return;
  storyboards.delete(id);
  block.remove();
  refreshStoryboardLabels();
  syncDraftStatus();
}

function validateStoryboardTimes(form) {
  const startInput = $("video-prompt-start");
  const endInput = $("video-prompt-end");
  startInput.setCustomValidity(startInput.value === "" ? "請輸入開始時間" : "");
  endInput.setCustomValidity(endInput.value === "" ? "請輸入結束時間" : "");
  if (startInput.value !== "" && endInput.value !== "" && Number(endInput.value) <= Number(startInput.value)) {
    endInput.setCustomValidity("結束時間必須大於開始時間");
  }
  return form.reportValidity();
}

function validateDialogueRows(form) {
  let valid = true;
  $("video-dialogue-list").querySelectorAll(".video-dialogue-row").forEach(row => {
    const speaker = row.querySelector(".video-dialogue-speaker");
    const hasText = Boolean(editorText(row.querySelector(".video-dialogue-text")));
    speaker.setCustomValidity(hasText && !speaker.value ? "請選擇說話者或旁白" : "");
    if (!speaker.checkValidity()) valid = false;
  });
  if (!valid) form.reportValidity();
  return valid;
}

function submitVideoPromptBuilder(event) {
  event.preventDefault();
  hideCharacterMentionMenu();
  hideResourceMentionMenu();
  if (!validateStoryboardTimes(event.currentTarget)) return;
  if (!validateDialogueRows(event.currentTarget)) return;
  const draft = collectStoryboardDraft();
  if (!storyboardFields(draft).length) return;
  const prompt = $("video-prompt");
  storyboards.set(draft.id, draft);
  const existing = editingStoryboardId ? prompt.querySelector(`[data-storyboard-id="${CSS.escape(editingStoryboardId)}"]`) : null;
  const block = createStoryboardBlock(draft);
  if (existing) existing.replaceWith(block);
  else prompt.append(block);
  refreshStoryboardLabels();
  resetVideoPromptBuilder();
  $("video-prompt-builder-dialog").close();
  syncDraftStatus();
  block.focus();
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
  renderStoryboardCharacterControls();
}

function showCharacterEditorReference(file) {
  const preview = $("character-reference-preview");
  const placeholder = $("character-reference-placeholder");
  const box = $("character-reference-box");
  editingCharacterReference = file || null;
  $("character-reference").setCustomValidity(file ? "" : "請選擇人物參考圖。");
  preview.hidden = true;
  preview.removeAttribute("src");
  placeholder.hidden = false;
  box.classList.remove("has-image");
  $("character-reference-name").textContent = "尚未選擇圖片";
  if (!file) return;
  const url = URL.createObjectURL(file);
  characterPreviewUrls.add(url);
  preview.src = url;
  preview.hidden = false;
  placeholder.hidden = true;
  box.classList.add("has-image");
  $("character-reference-name").textContent = file.name || "人物參考圖";
}

function syncCharacterVoiceCustom(focus = false) {
  const custom = $("character-voice").value === "custom";
  $("character-voice-custom-wrap").hidden = !custom;
  if (custom && focus) $("character-voice-custom").focus();
}

function setCharacterVoice(value = "") {
  const presetExists = [...$("character-voice").options].some(option => option.value === value && value !== "custom");
  $("character-voice").value = presetExists ? value : value ? "custom" : "";
  $("character-voice-custom").value = value && !presetExists ? value : "";
  syncCharacterVoiceCustom();
}

function characterVoiceValue() {
  return $("character-voice").value === "custom"
    ? $("character-voice-custom").value.trim()
    : $("character-voice").value;
}

function normalizedCharacterName(name = "") {
  return String(name).normalize("NFKC").trim().toLocaleLowerCase("zh-TW");
}

function characterNameExists(name, ignoredIndex = -1) {
  const normalized = normalizedCharacterName(name);
  return Boolean(normalized) && characterTemplates.some((character, index) => index !== ignoredIndex && normalizedCharacterName(character.name) === normalized);
}

function openCharacterEditor(index = -1) {
  editingCharacterIndex = index;
  const character = index >= 0 ? characterTemplates[index] : null;
  $("character-editor-title").textContent = character ? "編輯人物" : "新增人物";
  $("character-name").setCustomValidity("");
  $("character-name").value = character?.name || "";
  $("character-reference").value = "";
  $("character-style").value = character?.style || "";
  $("character-tone").value = character?.tone || "";
  setCharacterVoice(character?.voice || "");
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
  const nameInput = $("character-name");
  const character = {
    name: nameInput.value.trim(),
    referenceImage: editingCharacterReference,
    style: $("character-style").value.trim(),
    tone: $("character-tone").value.trim(),
    voice: characterVoiceValue(),
    clothing: $("character-clothing").value.trim(),
    enabled: editingCharacterIndex >= 0 ? characterTemplates[editingCharacterIndex]?.enabled !== false : false,
  };
  const duplicateName = characterNameExists(character.name, editingCharacterIndex);
  nameInput.setCustomValidity(duplicateName ? "人物名稱不可重複。" : "");
  if (!character.name || !character.referenceImage || duplicateName) {
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

function referencedCharacters(videoDetails) {
  return characterTemplates.filter(character => character.enabled !== false
    && character.name
    && character.referenceImage
    && videoDetails.includes(character.name));
}

function characterTemplateText(characters) {
  if (!characters.length) return "";
  const lines = characters.map((character, index) => {
    const fields = [
      ["名字", character.name],
      ["聲線", character.voice],
      ["口氣", character.tone],
      ["風格", character.style],
      ["服裝", character.clothing],
    ].filter(([, value]) => value).map(([label, value]) => `${label}：${value}`).join("；");
    return `人物 ${index + 1}：${fields}`;
  }).filter(line => !line.endsWith("："));
  return lines.length ? `人物設定：\n${lines.join("\n")}` : "";
}

function filmStyleText() {
  const primary = filmStyle.primary === "custom" ? filmStyle.primaryCustom : filmStyle.primary;
  const narratorVoice = filmStyle.narratorVoice === "custom" ? filmStyle.narratorCustom : filmStyle.narratorVoice;
  const fields = [
    ["主要風格", primary],
    ["年代質感", filmStyle.era],
    ["色彩基調", filmStyle.color],
    ["畫面質感", filmStyle.texture],
    ["畫面比例感", filmStyle.framing],
    ["旁白聲線", narratorVoice],
    ["自訂補充", filmStyle.notes],
  ].filter(([, value]) => value).map(([label, value]) => `${label}：${value}`);
  return fields.length ? `全片風格：\n${fields.join("\n")}` : "";
}

function storyboardPromptText(draft) {
  if (!draft) return "";
  return storyboardFields(draft)
    .map(([label, value]) => `${label}：${value}`)
    .join("\n");
}

function finalStoryboardPromptText() {
  if (!finalStoryboard) return "";
  return finalStoryboardFields(finalStoryboard).map(([label, value]) => `${label}：${value}`).join("\n");
}

function videoPromptSections() {
  const details = document.createElement("div");
  const storyboardText = [];
  let sceneNumber = 1;
  let finalText = "";
  for (const node of $("video-prompt").childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE && node.matches(".final-storyboard-block")) {
      finalText = finalStoryboardPromptText();
    }
    else if (node.nodeType === Node.ELEMENT_NODE && node.matches(".storyboard-block")) {
      const text = storyboardPromptText(storyboards.get(node.dataset.storyboardId));
      if (text) storyboardText.push(`Scene ${sceneNumber++}\n${text}`);
    }
    else details.append(node.cloneNode(true));
  }
  if (finalText) storyboardText.push(`Scene ${sceneNumber}\n${finalText}`);
  return { details: editorText(details), storyboards: storyboardText.join("\n\n") };
}

function promptVideoDetails() {
  if (isPromptMode()) return editorText($("video-prompt-text"));
  const sections = videoPromptSections();
  return [sections.details, sections.storyboards].filter(Boolean).join("\n");
}

function resourceReferenceText() {
  const tokens = [...$("video-prompt").querySelectorAll(".resource-token")];
  const ids = [...new Set(tokens.map(token => token.dataset.resourceId).filter(Boolean))];
  const lines = ids.map(id => videoResources.find(resource => resource.id === id)).filter(Boolean)
    .map(resource => `@${resource.referenceName}：${resourceTypeLabel(resource.kind)}`);
  return lines.length ? `引用資源：\n${lines.join("\n")}` : "";
}

function completeVideoPrompt(videoDetails = promptVideoDetails()) {
  if (isPromptMode()) return videoDetails;
  const sections = videoPromptSections();
  return [
    filmStyleText(),
    characterTemplateText(referencedCharacters(videoDetails)),
    sections.details ? `影片細節：\n${sections.details}` : "",
    sections.storyboards ? `分鏡內容：\n${sections.storyboards}` : "",
    resourceReferenceText(),
  ].filter(Boolean).join("\n\n");
}

function openVideoPromptPreview() {
  if (restoreMinimizedDialog("promptPreview")) return;
  $("video-prompt-preview-text").textContent = completeVideoPrompt() || "目前尚未輸入題詞。";
  $("video-prompt-preview-dialog").returnValue = "";
  $("video-prompt-preview-dialog").showModal();
  $("video-prompt-preview-text").focus();
}

function orderedStoryboardEntries() {
  return [...$("video-prompt").querySelectorAll(".storyboard-block:not(.final-storyboard-block)")].map((block, index) => ({
    block,
    draft: storyboards.get(block.dataset.storyboardId),
    index,
  })).filter(entry => entry.draft);
}

function storyboardCharacterNames(draft) {
  const enabled = characterTemplates.filter(character => character.enabled !== false && character.name).map(character => character.name);
  const text = storyboardPromptText(draft);
  return new Set(enabled.filter(name => text.includes(name)));
}

function continuityProfile(draft) {
  const text = storyboardPromptText(draft);
  const firstMatch = values => values.find(value => text.includes(value)) || "";
  const clothing = text.match(/(?:穿著|身穿)([^，。；\n]{1,30})/u)?.[1]?.trim() || "";
  return {
    time: firstMatch(["清晨", "白天", "正午", "黃昏", "夜晚", "深夜"]),
    place: firstMatch(["室內", "室外"]),
    weather: firstMatch(["晴天", "雨天", "下雨", "雪天", "下雪"]),
    temperature: draft.lightingTemperature || firstMatch(["暖色", "冷色"]),
    clothing,
    characters: storyboardCharacterNames(draft),
  };
}

function addContinuityWarnings(entries, add) {
  const labels = { time: "時間", place: "室內／室外", weather: "天氣", temperature: "燈光色溫" };
  for (let index = 1; index < entries.length; index += 1) {
    const previous = continuityProfile(entries[index - 1].draft);
    const current = continuityProfile(entries[index].draft);
    const sharedCharacters = [...current.characters].filter(name => previous.characters.has(name));
    for (const [field, label] of Object.entries(labels)) {
      if (previous[field] && current[field] && previous[field] !== current[field]) {
        add("warning", `分鏡 ${index} 到分鏡 ${index + 1} 的${label}由「${previous[field]}」變為「${current[field]}」，請確認是否為預期轉換。`, entries[index]);
      }
    }
    if (sharedCharacters.length && previous.clothing && current.clothing && previous.clothing !== current.clothing) {
      add("warning", `人物「${sharedCharacters.join("、")}」在相鄰分鏡中的服裝描述不同，請確認人物連續性。`, entries[index]);
    }
  }
}

function modelDurationOptions(model) {
  if (!model) return [];
  return model.durations || Array.from({ length: model.maximumDuration - model.minimumDuration + 1 }, (_, index) => model.minimumDuration + index);
}

function inspectStoryboardProject() {
  const entries = orderedStoryboardEntries();
  const finalEntry = finalStoryboard ? {
    block: document.getElementById("final-storyboard-card"),
    draft: finalStoryboard,
    index: entries.length,
    final: true,
  } : null;
  const timelineEntries = finalEntry ? [...entries, finalEntry] : entries;
  const model = VIDEO_MODELS[$("video-model").value];
  const outputDuration = Number($("video-duration").value) || 0;
  const issues = [];
  const add = (severity, message, entry = null, action = null) => issues.push({
    severity,
    message,
    storyboardId: entry?.final ? "" : entry?.draft.id || "",
    finalStoryboard: Boolean(entry?.final),
    index: entry ? entry.index : -1,
    action,
  });
  if (!entries.length) add("error", "尚未加入任何分鏡，請先建立至少一張分鏡卡片。");
  let previousEnd = null;
  for (const entry of entries) {
    const { draft, index, block } = entry;
    const start = Number(draft.start);
    const end = Number(draft.end);
    const label = `分鏡 ${index + 1}`;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) add("error", `${label} 的開始或結束時間無效。`, entry);
    if (previousEnd !== null && start < previousEnd) add("error", `${label} 與上一張分鏡重疊 ${(previousEnd - start).toFixed(1)} 秒。`, entry);
    else if (previousEnd !== null && start > previousEnd) add("warning", `${label} 與上一張分鏡之間有 ${(start - previousEnd).toFixed(1)} 秒空檔。`, entry);
    previousEnd = Number.isFinite(end) ? end : previousEnd;
    if (!htmlText(draft.scene)) add("warning", `${label} 尚未設定場景。`, entry);
    if (!draft.camera && !htmlText(draft.cameraCustom)) add("warning", `${label} 尚未設定鏡頭運動。`, entry);
    for (const token of block.querySelectorAll(".resource-token")) {
      if (!videoResources.some(resource => resource.id === token.dataset.resourceId)) add("error", `${label} 引用了已刪除的資源「${token.textContent.trim()}」。`, entry);
    }
    const enabledNames = new Set(characterTemplates.filter(character => character.enabled !== false).map(character => character.name));
    const characterNames = [...(draft.viewSubjects || []), draft.viewpointCharacter, draft.actionCharacter, ...(draft.dialogues || []).map(dialogue => dialogue.speaker)]
      .filter(name => name && name !== "__all__" && name !== "__narrator__");
    for (const name of new Set(characterNames)) if (!enabledNames.has(name)) add("warning", `${label} 使用的人物「${name}」目前不存在或已禁用。`, entry);
  }
  if (finalEntry) {
    const { draft, block } = finalEntry;
    const start = Number(draft.start);
    const end = Number(draft.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) add("error", "最終分鏡的開始或結束時間無效。", finalEntry);
    if (previousEnd !== null && start < previousEnd) add("error", `最終分鏡與上一張分鏡重疊 ${(previousEnd - start).toFixed(1)} 秒。`, finalEntry);
    else if (previousEnd !== null && start > previousEnd) add("warning", `最終分鏡與上一張分鏡之間有 ${(start - previousEnd).toFixed(1)} 秒空檔。`, finalEntry);
    if (!htmlText(draft.scene)) add("warning", "最終分鏡尚未設定場景。", finalEntry);
    if (!draft.camera && !htmlText(draft.cameraCustom)) add("warning", "最終分鏡尚未設定鏡頭運動。", finalEntry);
    for (const token of block?.querySelectorAll(".resource-token") || []) {
      if (!videoResources.some(resource => resource.id === token.dataset.resourceId)) add("error", `最終分鏡引用了已刪除的資源「${token.textContent.trim()}」。`, finalEntry);
    }
    const enabledNames = new Set(characterTemplates.filter(character => character.enabled !== false).map(character => character.name));
    const characterNames = [
      ...(draft.viewSubjects || []),
      draft.viewpointCharacter,
      ...(draft.actions || []).map(action => action.actionCharacter),
    ].filter(name => name && name !== "__all__");
    for (const name of new Set(characterNames)) if (!enabledNames.has(name)) add("warning", `最終分鏡使用的人物「${name}」目前不存在或已禁用。`, finalEntry);
  }
  addContinuityWarnings(entries, add);
  const referencedIds = new Set([...$("video-prompt").querySelectorAll(".resource-token")].map(token => token.dataset.resourceId).filter(Boolean));
  const unusedResources = videoResources.filter(resource => !referencedIds.has(resource.id));
  if (unusedResources.length) add("warning", `有 ${unusedResources.length} 個上傳資源尚未被任何分鏡引用。`);
  const maxEnd = Math.max(
    entries.reduce((value, entry) => Math.max(value, Number(entry.draft.end) || 0), 0),
    Number(finalStoryboard?.end) || 0,
  );
  if (entries.length && maxEnd > 0) {
    const supportsDuration = model?.durations?.some(duration => Math.abs(duration - maxEnd) < 0.05);
    if (model?.durations && !supportsDuration) add("warning", `全部分鏡的時間範圍為 ${maxEnd.toFixed(1)} 秒，不是 ${model.label} 可直接生成的片長。`);
    else if (model?.minimumDuration && maxEnd < model.minimumDuration) add("warning", `全部分鏡的時間範圍為 ${maxEnd.toFixed(1)} 秒，短於 ${model.label} 最低 ${model.minimumDuration} 秒。`);
    else if (model?.maximumDuration && maxEnd > model.maximumDuration) add("warning", `全部分鏡的時間範圍為 ${maxEnd.toFixed(1)} 秒，超過 ${model.label} 最高 ${model.maximumDuration} 秒。`);
  }
  if (maxEnd > outputDuration) {
    const suggestedDuration = modelDurationOptions(model).find(duration => duration >= maxEnd) || null;
    if (suggestedDuration) add("warning", `分鏡時間延伸至 ${maxEnd.toFixed(1)} 秒，超過目前輸出片長 ${outputDuration} 秒。點選此警告可自動調整為 ${suggestedDuration} 秒。`, null, { type: "fit-duration", duration: suggestedDuration });
    else add("warning", `分鏡時間延伸至 ${maxEnd.toFixed(1)} 秒，已超過 ${model.label} 可選擇的最長時間，無法自動調整。`);
  }
  if (entries.length && Number(entries[0].draft.start) > 0) add("warning", `第一張分鏡從 ${Number(entries[0].draft.start).toFixed(1)} 秒開始，片頭會有空檔。`, entries[0]);
  return {
    entries,
    finalEntry,
    timelineEntries,
    totalEntries: timelineEntries.length,
    issues,
    errors: issues.filter(issue => issue.severity === "error").length,
    warnings: issues.filter(issue => issue.severity === "warning").length,
    maxEnd,
    outputDuration,
    remainingDuration: outputDuration - maxEnd,
    promptLength: completeVideoPrompt().length,
  };
}

function storyboardAiCharacters(draft, final = false) {
  const names = [
    ...(draft.viewSubjects || []),
    draft.viewpointCharacter,
    ...(final ? (draft.actions || []).map(action => action.actionCharacter) : [draft.actionCharacter]),
    ...(draft.dialogues || []).map(dialogue => dialogue.speaker),
  ].filter(name => name && name !== "__all__" && name !== "__narrator__");
  return [...new Set(names)];
}

function storyboardAiScene(draft, id, final = false) {
  const fields = final ? finalStoryboardFields(draft) : storyboardFields(draft);
  const values = Object.fromEntries(fields.map(([label, value]) => [label, value]));
  const duration = Number(draft.end) - Number(draft.start);
  const description = fields
    .filter(([label]) => !["時間", "場景", "鏡頭", "人物與對話"].includes(label))
    .map(([label, value]) => `${label}：${value}`)
    .join("\n") || values.場景 || "未提供分鏡內容";
  return {
    id,
    ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
    ...(draft.shotSize ? { shot: draft.shotSize } : {}),
    ...(values.鏡頭 ? { camera: values.鏡頭 } : {}),
    description,
    ...(values["人物與對話"] ? { dialogue: values["人物與對話"] } : {}),
    ...(values.場景 ? { location: values.場景 } : {}),
    ...(storyboardAiCharacters(draft, final).length ? { characters: storyboardAiCharacters(draft, final) } : {}),
  };
}

function storyboardAiRequest() {
  const entries = orderedStoryboardEntries();
  const scenes = entries.map((entry, index) => storyboardAiScene(entry.draft, index + 1));
  if (finalStoryboard) scenes.push(storyboardAiScene(finalStoryboard, scenes.length + 1, true));
  const sections = videoPromptSections();
  const story = [sections.details, filmStyleText()].filter(Boolean).join("\n\n");
  return { ...(story ? { story } : {}), scenes };
}

function parseStoryboardAiResult(payload) {
  if (!payload?.success) throw new Error(payload?.error || "AI 分析服務未回傳結果。");
  let result = payload.result?.response ?? payload.result;
  if (Array.isArray(result?.choices)) result = result.choices[0]?.message?.content;
  if (typeof result === "string") {
    const source = result.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { result = JSON.parse(source); }
    catch { throw new Error("AI 分析報告未完整產生，請重新分析。"); }
  }
  const hasReportFields = result
    && typeof result === "object"
    && Number.isFinite(Number(result.overall_score))
    && ["pass", "needs_revision", "fail"].includes(result.status)
    && typeof result.summary === "string"
    && Array.isArray(result.strengths)
    && Array.isArray(result.problems)
    && Array.isArray(result.scene_reviews)
    && Array.isArray(result.corrected_scenes)
    && Array.isArray(result.generation_advice);
  if (!hasReportFields) throw new Error("AI 分析結果缺少必要的報告欄位，請重新分析。");
  return result;
}

function reportText(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = String(value ?? "");
  return element;
}

function storyboardAiList(title, values = []) {
  if (!values.length) return null;
  const section = reportText("section", "storyboard-ai-section", "");
  const list = document.createElement("ul");
  list.replaceChildren(...values.map(value => reportText("li", "", value)));
  section.append(reportText("h3", "", title), list);
  return section;
}

function renderStoryboardAiReport(report) {
  const container = $("storyboard-ai-report");
  const statusLabels = { pass: "可直接生成", needs_revision: "建議修改", fail: "需要重整" };
  const heading = reportText("div", "storyboard-ai-heading", "");
  heading.append(
    reportText("span", "storyboard-ai-score", Number.isFinite(Number(report.overall_score)) ? Math.round(Number(report.overall_score)) : "—"),
    reportText("span", "storyboard-ai-status", statusLabels[report.status] || "分析完成"),
    reportText("p", "", report.summary || "AI 已完成分鏡分析。"),
  );
  const nodes = [heading];
  const strengths = storyboardAiList("做得好的地方", Array.isArray(report.strengths) ? report.strengths : []);
  if (strengths) nodes.push(strengths);
  if (Array.isArray(report.problems) && report.problems.length) {
    const section = reportText("section", "storyboard-ai-section", "");
    section.append(reportText("h3", "", "需要處理的問題"));
    for (const problem of report.problems) {
      const item = reportText("article", "storyboard-ai-problem", "");
      item.dataset.severity = problem.severity || "low";
      const related = problem.related_scene === null || problem.related_scene === undefined ? "" : ` ↔ Scene ${problem.related_scene}`;
      item.append(
        reportText("strong", "", `Scene ${problem.scene}${related} · ${problem.severity || "提醒"}`),
        reportText("p", "", problem.message || ""),
        reportText("small", "", problem.suggestion ? `建議：${problem.suggestion}` : ""),
      );
      section.append(item);
    }
    nodes.push(section);
  }
  if (Array.isArray(report.scene_reviews) && report.scene_reviews.length) {
    const section = reportText("section", "storyboard-ai-section", "");
    const grid = reportText("div", "storyboard-ai-scene-grid", "");
    for (const review of report.scene_reviews) {
      const card = reportText("article", "storyboard-ai-scene", "");
      card.append(
        reportText("strong", "", `Scene ${review.scene} · ${review.score ?? "—"} 分`),
        reportText("span", "", `連續性：${review.continuity || "未說明"}`),
        reportText("span", "", `鏡頭：${review.camera || "未說明"}`),
        reportText("span", "", `時間：${review.timing || "未說明"}`),
        reportText("span", "", `生成穩定性：${review.ai_generation || "未說明"}`),
      );
      grid.append(card);
    }
    section.append(reportText("h3", "", "逐鏡分析"), grid);
    nodes.push(section);
  }
  const corrections = storyboardAiList("修正版分鏡", Array.isArray(report.corrected_scenes) ? report.corrected_scenes.map(scene => {
    const duration = scene.duration === null || scene.duration === undefined ? "" : ` · ${scene.duration} 秒`;
    const camera = [scene.shot, scene.camera].filter(Boolean).join("／");
    return `Scene ${scene.id}${duration}${camera ? ` · ${camera}` : ""}：${scene.description}${scene.reason ? `（原因：${scene.reason}）` : ""}`;
  }) : []);
  if (corrections) nodes.push(corrections);
  const advice = storyboardAiList("生成建議", Array.isArray(report.generation_advice) ? report.generation_advice : []);
  if (advice) nodes.push(advice);
  container.replaceChildren(...nodes);
  container.hidden = false;
  lastStoryboardAiReport = report;
  $("open-storyboard-ai-pdf").disabled = busy;
}

function prepareStoryboardAiPdfWindow() {
  const target = window.open("about:blank", "_blank");
  if (!target) return null;
  target.document.title = "AI 分鏡分析中…";
  target.document.body.textContent = "AI 正在分析分鏡，完成後將在此顯示 PDF 報告…";
  return target;
}

async function openStoryboardAiPdf(preparedWindow = null) {
  if (!lastStoryboardAiReport) return false;
  const target = preparedWindow && !preparedWindow.closed
    ? preparedWindow
    : busy ? null : prepareStoryboardAiPdfWindow();
  if (!target) {
    setStatus("AI 分析完成；瀏覽器未能自動開啟 PDF，請點擊「開啟 PDF」。", "error");
    return false;
  }
  target.document.title = "正在建立 AI 分鏡分析報告…";
  target.document.body.textContent = "正在建立 AI 分鏡分析報告…";
  $("open-storyboard-ai-pdf").disabled = true;
  try {
    const pdf = await createStoryboardReportPdf(lastStoryboardAiReport);
    const url = URL.createObjectURL(pdf);
    target.location.replace(url);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setStatus("已在新視窗開啟 AI 分析 PDF", "success");
    return true;
  } catch (error) {
    target.close();
    setStatus(error?.message || "無法建立 AI 分析 PDF", "error");
    return false;
  } finally {
    $("open-storyboard-ai-pdf").disabled = busy || !lastStoryboardAiReport;
  }
}

async function storyboardCheckerRequest(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...clientIdentityHeaders() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const failure = new Error(payload?.error || `AI 分析服務回應錯誤（${response.status}）。`);
    failure.status = response.status;
    throw failure;
  }
  return payload;
}

// 對單一後端（主要引擎或備援）跑完整的「送出 → 視需要輪詢」流程。兩套後端目前都是
// 同步回傳結果，不會真的觸發輪詢分支，但保留這段是為了以防任何一邊未來又改回排隊
// 模式時不用重寫呼叫邏輯。
async function runStoryboardBackend(checkUrl, input) {
  const statusUrl = `${checkUrl}/status`;
  const created = await storyboardCheckerRequest(checkUrl, input);
  if (created.status === "complete" || created.result) return parseStoryboardAiResult(created);
  const requestId = created.requestId;
  if (!requestId) throw new Error("AI 分析服務沒有回傳任務編號。");
  const startedAt = Date.now();
  while (Date.now() - startedAt < STORYBOARD_CHECKER_TIMEOUT) {
    await new Promise(resolve => setTimeout(resolve, STORYBOARD_CHECKER_POLL_INTERVAL));
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    $("video-generation-lock-title").textContent = "AI 正在分析分鏡";
    $("video-generation-lock-detail").textContent = `任務已排入佇列 · 已等待 ${elapsed} 秒`;
    const status = await storyboardCheckerRequest(statusUrl, { requestId });
    if (status.status === "complete" || status.result) return parseStoryboardAiResult(status);
    if (["failed", "cancelled", "expired"].includes(status.status)) throw new Error("AI 分鏡分析任務未能完成。");
  }
  throw new Error("AI 分鏡分析等待超過 10 分鐘，請稍後重新嘗試。");
}

async function waitForStoryboardAiReport(input) {
  try {
    return await runStoryboardBackend(STORYBOARD_PRIMARY_URL, input);
  } catch (primaryError) {
    // 429（冷卻中）不重試備援：兩邊各自獨立冷卻，重試備援只會讓使用者在「主要引擎
    // 冷卻中」跟「備援也冷卻中」之間困惑，不如直接把限流訊息原樣丟回去。
    if (primaryError?.status === 429) throw primaryError;
    console.warn("分鏡 AI 分析主要引擎失敗，改用 storyboard-checker 備援：", primaryError);
    try {
      return await runStoryboardBackend(STORYBOARD_FALLBACK_URL, input);
    } catch (fallbackError) {
      // 兩邊都失敗時，把備援的錯誤訊息回報給使用者（通常比主要引擎的錯誤更具體，
      // 因為備援是最後一道防線，使用者需要知道的是「最終」失敗原因）。
      throw fallbackError;
    }
  }
}

async function analyzeStoryboardsWithAi() {
  const input = storyboardAiRequest();
  if (!input.scenes.length || busy) {
    if (storyboardAiPdfWindow && !storyboardAiPdfWindow.closed) storyboardAiPdfWindow.close();
    storyboardAiPdfWindow = null;
    return;
  }
  const inspectionDialog = $("storyboard-inspection-dialog");
  const reopenInspection = inspectionDialog.open;
  if (reopenInspection) {
    inspectionDialog.returnValue = "";
    inspectionDialog.close();
  }
  setBusy(true);
  $("video-generation-lock-title").textContent = "AI 正在分析分鏡";
  $("video-generation-lock-detail").textContent = `正在檢查 ${input.scenes.length} 個 Scene 的故事、運鏡與連續性…`;
  try {
    const report = await waitForStoryboardAiReport(input);
    renderStoryboardAiReport(report);
    await openStoryboardAiPdf(storyboardAiPdfWindow);
  } catch (error) {
    if (storyboardAiPdfWindow && !storyboardAiPdfWindow.closed) storyboardAiPdfWindow.close();
    const container = $("storyboard-ai-report");
    lastStoryboardAiReport = null;
    $("open-storyboard-ai-pdf").disabled = true;
    container.replaceChildren(reportText("p", "storyboard-ai-error", error?.message || "AI 分析失敗，請稍後再試。"));
    container.hidden = false;
    setStatus("AI 分鏡分析失敗", "error");
  } finally {
    storyboardAiPdfWindow = null;
    setBusy(false);
    if (reopenInspection && !inspectionDialog.open) {
      inspectionDialog.returnValue = "";
      inspectionDialog.showModal();
    }
    requestAnimationFrame(() => {
      $("storyboard-ai-report").scrollIntoView({ block: "nearest", behavior: "smooth" });
      $("close-storyboard-inspection").focus();
    });
  }
}

function openStoryboardAiConfirmation() {
  if (busy || $("analyze-storyboards-ai").disabled) return;
  $("storyboard-ai-confirm-dialog").showModal();
}

function confirmStoryboardAiAnalysis(event) {
  event.preventDefault();
  $("storyboard-ai-confirm-dialog").close();
  storyboardAiPdfWindow = prepareStoryboardAiPdfWindow();
  void analyzeStoryboardsWithAi();
}

function inspectionSummaryItem(label, value) {
  const item = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = String(value);
  item.append(document.createTextNode(label), strong);
  return item;
}

function renderStoryboardInspection(report) {
  $("analyze-storyboards-ai").disabled = busy || !report.totalEntries;
  $("storyboard-inspection-summary").replaceChildren(
    inspectionSummaryItem("分鏡", report.totalEntries),
    inspectionSummaryItem("時間範圍", `${report.maxEnd.toFixed(1)} / ${report.outputDuration} 秒`),
    inspectionSummaryItem("最終題詞", `${report.promptLength.toLocaleString()} 字`),
    inspectionSummaryItem("錯誤／提醒", `${report.errors}／${report.warnings}`),
  );
  const timeRoom = $("storyboard-time-room");
  timeRoom.classList.toggle("warning", report.remainingDuration < 0);
  timeRoom.textContent = report.remainingDuration >= 0
    ? `目前分鏡使用至 ${report.maxEnd.toFixed(1)} 秒，距離 ${report.outputDuration} 秒的輸出片長尚有 ${report.remainingDuration.toFixed(1)} 秒餘裕。`
    : `目前分鏡已超出輸出片長 ${Math.abs(report.remainingDuration).toFixed(1)} 秒；請點選下方警告自動調整。若超過模型最長時間，仍會保留警告。`;
  const timeline = $("storyboard-inspection-timeline");
  const scale = Math.max(report.maxEnd, report.outputDuration, 1);
  const errorIds = new Set(report.issues.filter(issue => issue.severity === "error").map(issue => issue.finalStoryboard ? "__final__" : issue.storyboardId));
  timeline.replaceChildren(...report.timelineEntries.map(entry => {
    const segment = document.createElement("button");
    segment.type = "button";
    const entryId = entry.final ? "__final__" : entry.draft.id;
    segment.className = `storyboard-timeline-segment${entry.final ? " final" : ""}${errorIds.has(entryId) ? " has-error" : ""}`;
    segment.style.left = `${Math.max(0, Number(entry.draft.start)) / scale * 100}%`;
    segment.style.width = `${Math.max(0.04, (Number(entry.draft.end) - Number(entry.draft.start)) / scale) * 100}%`;
    segment.textContent = `${entry.final ? "最終" : entry.index + 1} · ${formatStoryboardTime(entry.draft.start, entry.draft.end)}`;
    segment.title = entry.final ? "最終分鏡" : String(entry.draft.summary || "").trim() || "未填寫分鏡描述";
    segment.addEventListener("click", () => { $("storyboard-inspection-dialog").close(); entry.final ? openFinalStoryboard() : editStoryboard(entry.draft.id); });
    return segment;
  }));
  const result = $("storyboard-inspection-result");
  if (!report.issues.length) {
    const empty = document.createElement("p");
    empty.className = "storyboard-inspection-empty";
    empty.textContent = "分鏡時間、模型片長與引用資源皆通過檢查。";
    result.replaceChildren(empty);
    return;
  }
  const list = document.createElement("ul");
  list.replaceChildren(...report.issues.map(issue => {
    const item = document.createElement(issue.storyboardId || issue.finalStoryboard || issue.action ? "button" : "div");
    if (item instanceof HTMLButtonElement) item.type = "button";
    item.className = "storyboard-inspection-item";
    item.dataset.severity = issue.severity;
    const marker = document.createElement("strong");
    marker.textContent = issue.severity === "error" ? "錯誤" : issue.action ? "警告" : "提醒";
    const message = document.createElement("span");
    message.textContent = issue.message;
    item.append(marker, message);
    if (issue.finalStoryboard) item.addEventListener("click", () => { $("storyboard-inspection-dialog").close(); openFinalStoryboard(); });
    else if (issue.storyboardId) item.addEventListener("click", () => { $("storyboard-inspection-dialog").close(); editStoryboard(issue.storyboardId); });
    else if (issue.action?.type === "fit-duration") item.addEventListener("click", () => {
      $("video-duration").value = String(issue.action.duration);
      syncResultHeading();
      scheduleAutoDraft();
      renderStoryboardInspection(inspectStoryboardProject());
      setStatus(`影片長度已調整為 ${issue.action.duration} 秒`, "success");
    });
    return item;
  }));
  result.replaceChildren(list);
}

function openStoryboardInspection(report = inspectStoryboardProject()) {
  renderStoryboardInspection(report);
  $("storyboard-inspection-dialog").returnValue = "";
  $("storyboard-inspection-dialog").showModal();
  $("close-storyboard-inspection").focus();
  return report;
}

function videoDetailsHtml() {
  const holder = document.createElement("div");
  for (const node of $("video-prompt").childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE && node.matches(".storyboard-block")) continue;
    holder.append(node.cloneNode(true));
  }
  return holder.innerHTML;
}

function projectBinaryRecord(file, binaries) {
  if (!(file instanceof Blob)) return { binaryIndex: null };
  const binaryIndex = binaries.length;
  binaries.push(file);
  return { binaryIndex };
}

function projectResourceRecord(resource, binaries) {
  return {
    id: resource.id,
    kind: resource.kind,
    referenceName: resource.referenceName,
    originalName: resource.originalName,
    mimeType: resource.mimeType,
    duration: resource.duration,
    createdAt: resource.createdAt,
    ...projectBinaryRecord(resource.file, binaries),
  };
}

function projectCharacterRecord(character, binaries) {
  return {
    name: character.name,
    voice: character.voice,
    tone: character.tone,
    style: character.style,
    clothing: character.clothing,
    enabled: true,
    ...projectBinaryRecord(character.referenceImage, binaries),
  };
}

function videoProjectMetadata(includeCharacters, binaries) {
  const storyboardOrder = [...$("video-prompt").querySelectorAll(".storyboard-block")]
    .map(block => storyboards.get(block.dataset.storyboardId))
    .filter(Boolean)
    .map(draft => structuredClone(draft));
  const enabledCharacters = characterTemplates.filter(character => character.enabled !== false);
  return {
    createdAt: new Date().toISOString(),
    editorMode: promptEditorMode,
    promptTextHtml: $("video-prompt-text").innerHTML,
    promptText: editorText($("video-prompt-text")),
    videoDetailsHtml: videoDetailsHtml(),
    filmStyle: { ...filmStyle },
    storyboards: storyboardOrder,
    finalStoryboard: finalStoryboard ? structuredClone(finalStoryboard) : null,
    resources: videoResources.filter(resource => resource.file instanceof Blob).map(resource => projectResourceRecord(resource, binaries)),
    resourceCounters: { ...resourceCounters },
    characters: includeCharacters ? enabledCharacters.map(character => projectCharacterRecord(character, binaries)) : null,
    generation: {
      model: $("video-model").value,
      resolution: $("video-resolution").value,
      duration: $("video-duration").value,
      ratio: $("video-ratio").value,
      includeAudio: $("veo-include-audio").checked,
    },
  };
}

function draftTimeLabel(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(timestamp);
}

function setAutoDraftStatus(text, mode = "") {
  const output = $("video-auto-draft-status");
  output.textContent = text;
  output.className = `video-auto-draft-status ${mode}`.trim();
}

function finishAutoDraftRestore() {
  autoDraftReady = true;
  $("export-video-project").disabled = false;
  $("select-video-project").disabled = false;
  syncClearWorkspaceAvailability();
  syncStoryboardPdfAvailability();
}

function autoDraftMetadata() {
  const binaries = [];
  const metadata = videoProjectMetadata(false, binaries);
  metadata.resources = metadata.resources.map(({ binaryIndex, ...resource }) => resource);
  return metadata;
}

function autoDraftResourceRecords() {
  return videoResources.filter(resource => resource.file instanceof Blob).map(resource => ({
    id: resource.id,
    kind: resource.kind,
    referenceName: resource.referenceName,
    originalName: resource.originalName,
    mimeType: resource.mimeType,
    duration: resource.duration,
    createdAt: resource.createdAt,
    file: resource.file,
  }));
}

function scheduleAutoDraft({ resources = false } = {}) {
  autoDraftResourcesDirty ||= resources;
  if (!autoDraftReady) {
    autoDraftTouched = true;
    return;
  }
  clearTimeout(autoDraftTimer);
  setAutoDraftStatus("等待自動儲存…", "saving");
  autoDraftTimer = setTimeout(() => void saveAutoDraftNow().catch(() => {}), 900);
}

function saveAutoDraftNow({ resources = false } = {}) {
  if (!autoDraftReady) return Promise.resolve(null);
  clearTimeout(autoDraftTimer);
  autoDraftTimer = 0;
  const saveResources = resources || autoDraftResourcesDirty;
  autoDraftResourcesDirty = false;
  setAutoDraftStatus("正在自動儲存…", "saving");
  const operation = async () => {
    const savedAt = Date.now();
    if (saveResources) {
      await saveStoredValue("video-generator-draft-resources", {
        resources: autoDraftResourceRecords(),
        updatedAt: savedAt,
      });
    }
    const draft = { metadata: autoDraftMetadata(), updatedAt: savedAt };
    await saveStoredValue("video-generator-draft", draft);
    setAutoDraftStatus(`草稿已自動儲存 · ${draftTimeLabel(savedAt)}`);
    return draft;
  };
  autoDraftSavePromise = autoDraftSavePromise.then(operation, operation).catch(error => {
    autoDraftResourcesDirty ||= saveResources;
    setAutoDraftStatus("草稿自動儲存失敗", "error");
    throw error;
  });
  return autoDraftSavePromise;
}

function storedDraftResource(record) {
  const kind = resourceKind(record?.file);
  if (!kind) return null;
  return {
    id: String(record.id || globalThis.crypto?.randomUUID?.() || `resource-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    kind,
    referenceName: String(record.referenceName || record.file.name),
    originalName: String(record.originalName || record.file.name),
    mimeType: record.file.type || String(record.mimeType || ""),
    file: record.file,
    duration: Number.isFinite(Number(record.duration)) ? Number(record.duration) : null,
    createdAt: Number(record.createdAt) || Date.now(),
  };
}

async function restoreAutoDraft() {
  try {
    const [draft, storedResources] = await Promise.all([
      loadStoredValue("video-generator-draft"),
      loadStoredValue("video-generator-draft-resources"),
    ]);
    if (autoDraftTouched) {
      finishAutoDraftRestore();
      scheduleAutoDraft({ resources: true });
      return;
    }
    const metadata = draft?.metadata;
    if (!metadata || !Array.isArray(metadata.storyboards) || !Array.isArray(metadata.resources)) {
      finishAutoDraftRestore();
      setAutoDraftStatus("自動儲存已啟用");
      return;
    }
    const resourceIds = new Set(metadata.resources.map(resource => String(resource.id)));
    videoResources = (storedResources?.resources || []).map(storedDraftResource).filter(resource => resource && resourceIds.has(resource.id));
    restoreResourceCounters(metadata.resourceCounters);
    renderVideoResources();
    restoreImportedFilmStyle(metadata.filmStyle);
    const prompt = $("video-prompt");
    prompt.innerHTML = sanitizedImportedHtml(metadata.videoDetailsHtml);
    storyboards.clear();
    metadata.storyboards.map(normalizedStoryboard).forEach(draftItem => {
      storyboards.set(draftItem.id, draftItem);
      prompt.append(createStoryboardBlock(draftItem));
    });
    finalStoryboard = normalizedFinalStoryboard(metadata.finalStoryboard);
    restoreProjectEditorMode(metadata);
    refreshStoryboardLabels();
    renderStoryboardCharacterControls();
    restoreGenerationSettings(metadata.generation);
    finishAutoDraftRestore();
    syncDraftStatus(false);
    setAutoDraftStatus(`已還原自動儲存草稿 · ${draftTimeLabel(draft.updatedAt)}`);
  } catch {
    finishAutoDraftRestore();
    setAutoDraftStatus("草稿無法從瀏覽器還原", "error");
  }
}

async function projectFromStoredDraft(includeCharacters) {
  const [draft, storedResources] = await Promise.all([
    loadStoredValue("video-generator-draft"),
    loadStoredValue("video-generator-draft-resources"),
  ]);
  if (!draft?.metadata || !Array.isArray(draft.metadata.resources)) throw Error("無法讀取剛儲存的影片草稿。");
  const resources = new Map((storedResources?.resources || []).map(record => [String(record.id), storedDraftResource(record)]));
  const binaries = [];
  const metadata = structuredClone(draft.metadata);
  metadata.resources = metadata.resources.map(record => {
    const resource = resources.get(String(record.id));
    if (!resource) throw Error(`草稿中的資源 ${record.referenceName || record.id} 無法讀取。`);
    return projectResourceRecord(resource, binaries);
  });
  const enabledCharacters = characterTemplates.filter(character => character.enabled !== false);
  metadata.characters = includeCharacters ? enabledCharacters.map(character => projectCharacterRecord(character, binaries)) : null;
  return { metadata, binaries };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function storyboardPdfProject() {
  if (isPromptMode()) return {
    scenes: [{ title: "影片題詞", summary: "", fields: [["內容", editorText($("video-prompt-text"))]] }],
    characters: referencedCharacters(promptVideoDetails()).map(character => ({ kind: "image", file: character.referenceImage, referenceName: character.name, voice: character.voice, tone: character.tone, style: character.style, clothing: character.clothing })),
    resources: referencedResources().map(resource => ({ kind: resource.kind, file: resource.file, referenceName: `@${resource.referenceName}`, originalName: resource.file?.name || "未命名檔案", meta: resourceTypeLabel(resource.kind) })),
  };
  const entries = orderedStoryboardEntries();
  const allScenes = finalStoryboard
    ? [...entries, { draft: finalStoryboard, final: true }]
    : entries;
  const scenes = allScenes.map((entry, index) => ({
    title: `Scene ${index + 1}${entry.final ? " · 最終分鏡" : ""}`,
    summary: entry.final ? "" : String(entry.draft.summary || "").trim(),
    fields: (entry.final ? finalStoryboardFields(entry.draft) : storyboardFields(entry.draft)).map(([label, value]) => [label, value]),
  }));
  const characters = referencedCharacters(promptVideoDetails()).map(character => ({
    kind: "image",
    file: character.referenceImage,
    referenceName: character.name,
    voice: character.voice,
    tone: character.tone,
    style: character.style,
    clothing: character.clothing,
  }));
  const resources = referencedResources().map(resource => ({
    kind: resource.kind,
    file: resource.file,
    referenceName: `@${resource.referenceName}`,
    originalName: resource.file?.name || "未命名檔案",
    meta: [resourceTypeLabel(resource.kind), formatResourceSize(resource.file?.size), formatDuration(resource.duration)].filter(Boolean).join(" · "),
  }));
  return { scenes, characters, resources };
}

function storyboardPdfFilename(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `video_storyboard_${day}_${time}.pdf`;
}

async function exportStoryboardPdf() {
  if (busy || (!isPromptMode() && !storyboards.size && !finalStoryboard) || (isPromptMode() && !editorText($("video-prompt-text")))) return;
  setBusy(true);
  $("video-generation-lock-title").textContent = "正在建立分鏡 PDF";
  $("video-generation-lock-detail").textContent = "正在整理分鏡卡與引用資源，所有處理都在瀏覽器內完成。";
  setStatus("正在建立分鏡 PDF…");
  try {
    const pdf = await createStoryboardCardsPdf(storyboardPdfProject());
    downloadBlob(pdf, storyboardPdfFilename());
    setStatus("分鏡 PDF 已匯出", "success");
  } catch (error) {
    setStatus(error?.message || "分鏡 PDF 匯出失敗", "error");
  } finally {
    setBusy(false);
  }
}

function openVideoProjectExport() {
  if (busy) return;
  const enabledCount = characterTemplates.filter(character => character.enabled !== false).length;
  $("export-active-characters").disabled = !enabledCount;
  $("export-active-characters").checked = Boolean(enabledCount);
  $("export-character-count").textContent = enabledCount ? `將加入 ${enabledCount} 位啟用人物；有參考圖時一併保存` : "目前沒有可匯出的啟用人物";
  $("export-video-project-dialog").showModal();
}

async function exportVideoProject(event) {
  event.preventDefault();
  const includeCharacters = $("export-active-characters").checked && !$("export-active-characters").disabled;
  $("export-video-project-dialog").close();
  $("export-video-project").disabled = true;
  setStatus("正在整理影片設定與媒體資源…");
  try {
    await saveAutoDraftNow({ resources: true });
    const { metadata, binaries } = await projectFromStoredDraft(includeCharacters);
    const file = await createVideoProjectFile(metadata, binaries);
    downloadBlob(file, file.name);
    setStatus(`已匯出設定 · ${metadata.storyboards.length} 個分鏡 · ${metadata.resources.length} 個資源`, "success");
  } catch (error) {
    setStatus(error.message || "影片設定匯出失敗", "error");
  } finally {
    $("export-video-project").disabled = false;
  }
}

function clearVideoWorkspace() {
  if (busy || !hasClearableWorkspace()) return;
  if (!window.confirm("是否清除所有工作區？")) return;
  if (window.confirm("是否先匯出檔案？")) {
    openVideoProjectExport();
    return;
  }

  storyboards.clear();
  $("video-prompt").replaceChildren();
  $("video-prompt-text").replaceChildren();
  promptModeSource = "";
  finalStoryboard = null;
  resetFinalStoryboardEditor();
  videoResources = [];
  resourceCounters = { image: 0, audio: 0, video: 0 };
  filmStyle = { ...EMPTY_FILM_STYLE };
  resetVideoPromptBuilder();
  promptBuilderMinimized = false;
  $("restore-video-prompt-builder").hidden = true;
  if ($("video-resource-preview-dialog").open) $("video-resource-preview-dialog").close();
  renderVideoResources();
  restoreImportedFilmStyle(filmStyle);
  renderFinalStoryboardCard();
  syncDraftStatus(false);
  scheduleAutoDraft({ resources: true });
  setStatus("已清除題詞、全部分鏡、上傳資源與全片風格", "success");
}

function projectCountSummary(label, count) {
  const item = document.createElement("span");
  const value = document.createElement("strong");
  value.textContent = String(count);
  item.append(value, document.createTextNode(label));
  return item;
}

function validateProjectMetadata(metadata, binaries) {
  if (!metadata || typeof metadata !== "object" || !Array.isArray(metadata.storyboards) || !Array.isArray(metadata.resources)) {
    throw new Error("影片設定檔缺少必要資料。");
  }
  if (metadata.resources.some(record => !Number.isInteger(record?.binaryIndex) || !binaries[record.binaryIndex])) {
    throw new Error("影片設定檔的媒體索引無效。");
  }
  if (Array.isArray(metadata.characters) && metadata.characters.some(record => record?.binaryIndex !== null && (!Number.isInteger(record?.binaryIndex) || !binaries[record.binaryIndex]))) {
    throw new Error("影片設定檔的人物參考圖索引無效。");
  }
  if (Array.isArray(metadata.characters)) {
    const names = metadata.characters.map(record => normalizedCharacterName(record?.name)).filter(Boolean);
    if (new Set(names).size !== names.length) throw new Error("影片設定檔包含重複的人物名稱。");
  }
}

async function selectVideoProject(event) {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (!file || busy) return;
  pendingVideoProject = null;
  $("import-video-project-error").hidden = true;
  $("confirm-import-video-project").disabled = true;
  $("import-video-project-name").textContent = file.name;
  $("import-video-project-summary").replaceChildren();
  $("import-project-characters").checked = false;
  $("import-project-characters").disabled = true;
  $("import-character-count").textContent = "正在讀取設定檔…";
  $("import-video-project-dialog").showModal();
  try {
    const decoded = await readVideoProjectFile(file);
    validateProjectMetadata(decoded.metadata, decoded.binaries);
    pendingVideoProject = decoded;
    const characterCount = Array.isArray(decoded.metadata.characters) ? decoded.metadata.characters.length : 0;
    $("import-video-project-summary").replaceChildren(
      projectCountSummary("分鏡", decoded.metadata.storyboards.length),
      projectCountSummary("資源", decoded.metadata.resources.length),
      projectCountSummary("人物", characterCount),
    );
    $("import-project-characters").disabled = !characterCount;
    $("import-character-count").textContent = characterCount
      ? `勾選後以檔案中的 ${characterCount} 位人物複寫目前人物模板`
      : "這個設定檔未包含人物";
    $("confirm-import-video-project").disabled = false;
  } catch (error) {
    $("import-video-project-error").textContent = error.message || "無法讀取影片設定檔。";
    $("import-video-project-error").hidden = false;
    $("import-character-count").textContent = "無法匯入人物";
  }
}

function sanitizedImportedHtml(html) {
  const source = document.createElement("template");
  source.innerHTML = typeof html === "string" ? html : "";
  const holder = document.createElement("div");
  const appendSafe = (node, target) => {
    if (node.nodeType === Node.TEXT_NODE) {
      target.append(document.createTextNode(node.data));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || ["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(node.tagName)) return;
    // 防禦性：從來源模板移除危險屬性，即使目前邏輯不複製屬性，
    // 也能防止未來修改意外引入 on* 事件處理器或 javascript: 網址。
    for (const attr of [...node.attributes]) {
      if (attr.name.startsWith("on") || ["href", "src", "action", "formaction", "xlink:href"].includes(attr.name)) {
        node.removeAttribute(attr.name);
      }
    }
    if (node.tagName === "BR") {
      target.append(document.createElement("br"));
      return;
    }
    if (node.matches(".resource-token")) {
      const resource = videoResources.find(item => item.id === node.dataset.resourceId);
      target.append(resource ? createResourceMention(resource) : document.createTextNode(node.textContent || ""));
      return;
    }
    const block = ["DIV", "P"].includes(node.tagName);
    [...node.childNodes].forEach(child => appendSafe(child, target));
    if (block) target.append(document.createElement("br"));
  };
  [...source.content.childNodes].forEach(node => appendSafe(node, holder));
  while (holder.lastChild?.nodeName === "BR") holder.lastChild.remove();
  return holder.innerHTML;
}

function restoreProjectEditorMode(metadata = {}) {
  const safeHtml = sanitizedImportedHtml(metadata.promptTextHtml);
  const holder = document.createElement("div");
  holder.innerHTML = safeHtml;
  const savedText = editorText(holder) || String(metadata.promptText || "").trim();
  const explicitMode = ["prompt", "storyboard"].includes(metadata.editorMode) ? metadata.editorMode : "";
  promptEditorMode = explicitMode || (savedText ? "prompt" : "storyboard");
  if (safeHtml) $("video-prompt-text").innerHTML = safeHtml;
  else fillPromptEditor(savedText);
  promptModeSource = promptEditorMode === "prompt" ? editorText($("video-prompt-text")) : "";
  syncPromptModeUi();
}

function normalizedStoryboard(raw) {
  const start = Number(raw?.start);
  const end = Number(raw?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error("設定檔包含無效的分鏡時間。");
  const html = key => sanitizedImportedHtml(raw?.[key]);
  return {
    id: globalThis.crypto?.randomUUID?.() || `storyboard-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    start: roundedStoryboardTime(start),
    end: roundedStoryboardTime(end),
    summary: String(raw?.summary || ""),
    scene: html("scene"),
    shotSize: String(raw?.shotSize || ""),
    viewAngle: String(raw?.viewAngle || ""),
    viewCustom: html("viewCustom"),
    viewSubjects: Array.isArray(raw?.viewSubjects) ? raw.viewSubjects.map(String) : [],
    viewpointCharacter: String(raw?.viewpointCharacter || ""),
    sound: html("sound"),
    actionCharacter: String(raw?.actionCharacter || ""),
    actionCategory: String(raw?.actionCategory || ""),
    actionType: String(raw?.actionType || ""),
    actionStyle: String(raw?.actionStyle || ""),
    actionCustom: html("actionCustom"),
    actionTarget: html("actionTarget"),
    actionDetail: html("actionDetail"),
    dialogues: Array.isArray(raw?.dialogues) ? raw.dialogues.map(dialogue => ({ speaker: String(dialogue?.speaker || ""), emotion: String(dialogue?.emotion || ""), text: sanitizedImportedHtml(dialogue?.text) })) : [],
    camera: String(raw?.camera || ""),
    cameraSpeed: String(raw?.cameraSpeed || ""),
    cameraCustom: html("cameraCustom"),
    lighting: String(raw?.lighting || ""),
    lightingTemperature: String(raw?.lightingTemperature || ""),
    lightingIntensity: String(raw?.lightingIntensity || ""),
    lightingCustom: html("lightingCustom"),
  };
}

function normalizedFinalStoryboard(raw) {
  if (!raw || typeof raw !== "object") return null;
  const html = key => sanitizedImportedHtml(raw[key]);
  const structuredCamera = Object.hasOwn(raw, "cameraCustom");
  const structuredView = Object.hasOwn(raw, "viewAngle");
  const storedDuration = Number(raw.duration);
  const legacyDuration = roundedStoryboardTime(Number(raw.end) - Number(raw.start));
  const duration = [1, 2, 3].includes(storedDuration)
    ? storedDuration
    : [1, 2, 3].includes(legacyDuration) ? legacyDuration : 2;
  const actions = Array.isArray(raw.actions) ? raw.actions.map(action => {
    if (typeof action === "string") return { actionCharacter: "", actionCategory: "movement", actionType: "custom", actionStyle: "", actionCustom: sanitizedImportedHtml(action), actionTarget: "", actionDetail: "" };
    return {
      actionCharacter: String(action?.actionCharacter || ""),
      actionCategory: String(action?.actionCategory || ""),
      actionType: String(action?.actionType || ""),
      actionStyle: String(action?.actionStyle || ""),
      actionCustom: sanitizedImportedHtml(action?.actionCustom),
      actionTarget: sanitizedImportedHtml(action?.actionTarget),
      actionDetail: sanitizedImportedHtml(action?.actionDetail),
    };
  }).filter(action => actionPromptField(action)[0]) : [];
  return {
    start: roundedStoryboardTime(Number(raw.start) || 0),
    end: roundedStoryboardTime((Number(raw.start) || 0) + duration),
    duration,
    scene: html("scene"),
    camera: structuredCamera ? String(raw.camera || "") : raw.camera ? "custom" : "",
    cameraSpeed: String(raw.cameraSpeed || ""),
    cameraCustom: structuredCamera ? html("cameraCustom") : html("camera"),
    shotSize: String(raw.shotSize || ""),
    viewAngle: structuredView ? String(raw.viewAngle || "") : raw.view ? "custom" : "",
    viewCustom: structuredView ? html("viewCustom") : html("view"),
    viewSubjects: Array.isArray(raw.viewSubjects) ? raw.viewSubjects.map(String) : [],
    viewpointCharacter: String(raw.viewpointCharacter || ""),
    sound: html("sound"),
    actions,
  };
}

function importedResource(record, binaries) {
  const file = binaries[record.binaryIndex];
  const kind = resourceKind(file);
  if (!kind) throw new Error("設定檔包含不支援的資源格式。");
  return {
    id: String(record.id || globalThis.crypto?.randomUUID?.() || `resource-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    kind,
    referenceName: String(record.referenceName || file.name),
    originalName: String(record.originalName || file.name),
    mimeType: file.type || String(record.mimeType || ""),
    file,
    duration: Number.isFinite(Number(record.duration)) ? Number(record.duration) : null,
    createdAt: Number(record.createdAt) || Date.now(),
  };
}

function importedCharacter(record, binaries) {
  const referenceImage = Number.isInteger(record.binaryIndex) ? binaries[record.binaryIndex] : null;
  if (referenceImage && resourceKind(referenceImage) !== "image") throw new Error("人物參考圖格式無效。");
  return {
    name: String(record.name || "").trim(),
    referenceImage,
    voice: String(record.voice || ""),
    tone: String(record.tone || ""),
    style: String(record.style || ""),
    clothing: String(record.clothing || ""),
    enabled: true,
  };
}

function restoreResourceCounters(saved = {}) {
  resourceCounters = { image: 0, audio: 0, video: 0 };
  for (const kind of Object.keys(resourceCounters)) {
    resourceCounters[kind] = Math.max(0, Number(saved?.[kind]) || 0);
  }
  for (const resource of videoResources) {
    const number = Number(resource.referenceName.match(/(\d+)$/)?.[1]);
    if (Number.isInteger(number)) resourceCounters[resource.kind] = Math.max(resourceCounters[resource.kind], number);
  }
}

function restoreGenerationSettings(generation = {}) {
  if (VIDEO_MODELS[generation.model]) $("video-model").value = generation.model;
  if (typeof generation.includeAudio === "boolean") $("veo-include-audio").checked = generation.includeAudio;
  syncModelDetails();
  for (const [id, value] of [["video-resolution", generation.resolution], ["video-duration", generation.duration], ["video-ratio", generation.ratio]]) {
    const select = $(id);
    if ([...select.options].some(option => option.value === String(value))) select.value = String(value);
  }
  syncResultHeading();
}

function restoreImportedFilmStyle(saved = {}) {
  filmStyle = Object.fromEntries(Object.keys(EMPTY_FILM_STYLE).map(key => [key, String(saved?.[key] || "")]));
  const configured = Boolean(filmStyleText());
  $("open-film-style").classList.toggle("configured", configured);
  $("open-film-style").textContent = configured ? "全片風格（已設定）" : "全片風格";
}

async function importVideoProject(event) {
  event.preventDefault();
  if (!pendingVideoProject) return;
  if (!window.confirm("匯入設定將會複寫目前的所有資料，是否確認？")) return;
  const { metadata, binaries } = pendingVideoProject;
  const overwriteCharacters = $("import-project-characters").checked && Array.isArray(metadata.characters);
  $("confirm-import-video-project").disabled = true;
  try {
    const nextResources = metadata.resources.map(record => importedResource(record, binaries));
    const nextCharacters = overwriteCharacters ? metadata.characters.map(record => importedCharacter(record, binaries)) : null;
    const previousCharacters = characterTemplates;
    if (nextCharacters) {
      characterTemplates = nextCharacters;
      try {
        await persistCharacterTemplates();
      } catch (error) {
        characterTemplates = previousCharacters;
        throw error;
      }
    }
    videoResources = nextResources;
    restoreResourceCounters(metadata.resourceCounters);
    renderVideoResources();
    restoreImportedFilmStyle(metadata.filmStyle);
    const prompt = $("video-prompt");
    prompt.innerHTML = sanitizedImportedHtml(metadata.videoDetailsHtml);
    storyboards.clear();
    metadata.storyboards.map(normalizedStoryboard).forEach(draft => {
      storyboards.set(draft.id, draft);
      prompt.append(createStoryboardBlock(draft));
    });
    finalStoryboard = normalizedFinalStoryboard(metadata.finalStoryboard);
    restoreProjectEditorMode(metadata);
    refreshStoryboardLabels();
    if (nextCharacters) renderCharacterTemplates();
    else renderStoryboardCharacterControls();
    restoreGenerationSettings(metadata.generation);
    pendingVideoProject = null;
    $("import-video-project-dialog").close();
    syncDraftStatus();
    scheduleAutoDraft({ resources: true });
    setStatus(`已匯入設定 · ${metadata.storyboards.length} 個分鏡 · ${metadata.resources.length} 個資源`, "success");
  } catch (error) {
    $("import-video-project-error").textContent = error.message || "影片設定匯入失敗。";
    $("import-video-project-error").hidden = false;
    $("confirm-import-video-project").disabled = false;
  }
}

function referencedResources() {
  if (isPromptMode()) {
    const names = referencedResourceNames(editorText($("video-prompt-text")), videoResources.map(resource => resource.referenceName));
    return names.map(name => videoResources.find(resource => resource.referenceName === name));
  }
  const tokens = [...$("video-prompt").querySelectorAll(".resource-token")];
  const ids = [...new Set(tokens.map(token => token.dataset.resourceId).filter(Boolean))];
  const missing = ids.filter(id => !videoResources.some(resource => resource.id === id));
  if (missing.length) throw Error("影片細節中有引用已刪除的資源，請先移除紅色引用標籤。");
  return ids.map(id => videoResources.find(resource => resource.id === id));
}

function generationInputs(videoDetails) {
  const resources = referencedResources().map(resource => ({
    kind: resource.kind,
    file: resource.file,
    referenceName: `@${resource.referenceName}`,
    duration: resource.duration,
  }));
  const characters = referencedCharacters(videoDetails);
  resources.push(...characters.map(character => ({
    kind: "image",
    file: character.referenceImage,
    referenceName: `人物「${character.name}」`,
    duration: null,
  })));
  return { resources, characters };
}

function resourceMimeType(input) {
  if (input.file.type) return input.file.type;
  const extension = String(input.file.name || "").split(".").pop()?.toLowerCase();
  const mimeTypes = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", heic: "image/heic", heif: "image/heif",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v", mkv: "video/x-matroska",
  };
  return mimeTypes[extension] || `${input.kind}/octet-stream`;
}

function validateGenerationInputs(modelId, model, inputs) {
  if (!inputs.length) return;
  const counts = kind => inputs.filter(input => input.kind === kind).length;
  if (model.provider === "google") {
    if (inputs.some(input => input.kind !== "image")) throw Error("Veo 3.1 目前只接受圖片資源，請移除音頻與影片引用。");
    if (inputs.length > 3) throw Error("Veo 3.1 最多可使用 3 張引用圖片（包含人物參考圖）。");
    const totalBytes = inputs.reduce((sum, input) => sum + input.file.size, 0);
    if (totalBytes > 18 * 1024 * 1024) throw Error("Veo 3.1 引用圖片合計不可超過 18 MB，請縮小圖片後再試。");
    return;
  }
  if (counts("image") > 9) throw Error(`${model.label} 最多可使用 9 張引用圖片（包含人物參考圖）。`);
  if (counts("video") > 3) throw Error(`${model.label} 最多可使用 3 個引用影片。`);
  if (counts("audio") > 3) throw Error(`${model.label} 最多可使用 3 個引用音頻。`);
  for (const input of inputs) {
    const maximum = input.kind === "image" ? 30 : input.kind === "audio" ? 15 : 50;
    if (input.file.size > maximum * 1024 * 1024) throw Error(`${input.referenceName} 超過 ${maximum} MB 的模型輸入限制。`);
    if (model.provider === "minimax" && input.kind !== "image" && Number.isFinite(input.duration) && (input.duration < 2 || input.duration > 15)) {
      throw Error(`${input.referenceName} 長度必須介於 2～15 秒。`);
    }
  }
}

function referenceGuide(inputs) {
  const counters = { image: 0, audio: 0, video: 0 };
  const labels = { image: "張參考圖片", audio: "個參考音頻", video: "個參考影片" };
  if (!inputs.length) return "";
  return `參考素材對應：${inputs.map(input => {
    counters[input.kind] += 1;
    return `第 ${counters[input.kind]} ${labels[input.kind]}是 ${input.referenceName}`;
  }).join("；")}`;
}

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",", 2)[1] || "");
    reader.onerror = () => reject(Error(`無法讀取 ${file.name || "引用圖片"}。`));
    reader.readAsDataURL(file);
  });
}

async function uploadGenerationInputs(inputs, signal) {
  const urls = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const cached = uploadedResourceCache.get(input.file);
    if (cached?.expiresAt > Date.now() + 5 * 60 * 1000) {
      urls.push(cached.url);
      continue;
    }
    $("video-generation-lock-title").textContent = "正在上傳引用資源";
    $("video-generation-lock-detail").textContent = `${index + 1}／${inputs.length} · ${input.referenceName}`;
    setStatus(`正在上傳引用資源 ${index + 1}／${inputs.length}…`);
    const uploadUrl = `${RESOURCE_UPLOAD_URL}?name=${encodeURIComponent(input.file.name || input.referenceName)}`;
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": resourceMimeType(input) },
      body: input.file,
      cache: "no-store",
      signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.url) throw Error(body.message || body.error || `${input.referenceName} 上傳失敗（${response.status}）。`);
    const uploaded = { url: body.url, expiresAt: Number(body.expiresAt) || Date.now() + 60 * 60 * 1000 };
    uploadedResourceCache.set(input.file, uploaded);
    urls.push(uploaded.url);
  }
  return urls;
}

async function generationPayload(modelId, model, prompt, inputs, signal) {
  validateGenerationInputs(modelId, model, inputs);
  const guidedPrompt = [prompt, referenceGuide(inputs)].filter(Boolean).join("\n\n");
  const duration = model.provider === "google" && inputs.length ? 8 : Number($("video-duration").value);
  if (model.provider === "google") {
    if (inputs.length) $("video-duration").value = "8";
    const referenceImages = await Promise.all(inputs.map(async input => ({
      image: { inlineData: { mimeType: resourceMimeType(input), data: await fileBase64(input.file) } },
      referenceType: "asset",
    })));
    return {
      model: modelId,
      instances: [{ prompt: guidedPrompt, ...(referenceImages.length ? { referenceImages } : {}) }],
      parameters: {
        sampleCount: 1,
        resolution: $("video-resolution").value,
        durationSeconds: duration,
        aspectRatio: $("video-ratio").value,
      },
    };
  }

  const urls = await uploadGenerationInputs(inputs, signal);
  const content = [{ type: "text", text: guidedPrompt }, ...inputs.map((input, index) => {
    const type = `${input.kind}_url`;
    return {
      type,
      [type]: { url: urls[index] },
      role: `reference_${input.kind}`,
    };
  })];
  return {
    model: modelId,
    content,
    resolution: $("video-resolution").value,
    duration,
    ratio: $("video-ratio").value,
  };
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
  const durations = modelDurationOptions(model);
  const selectedDuration = durations.includes(previousDuration) ? previousDuration : durations[0];
  replaceOptions($("video-duration"), durations.map(String), String(selectedDuration));
  $("video-duration").querySelectorAll("option").forEach(option => { option.textContent = `${option.value} 秒`; });
  const ratios = model.ratios || VIDEO_RATIOS;
  const previousRatio = $("video-ratio").value;
  replaceOptions($("video-ratio"), ratios, ratios.includes(previousRatio) ? previousRatio : ratios[0]);
  $("video-api-key").textContent = usesAccountCredits(modelId) ? (memberSignedIn ? "帳戶扣點" : "需登入") : getApiKey(model.provider) ? "已設定" : "未設定";
  const billingUrl = providerBillingUrl(model.provider);
  $("video-provider-billing").href = billingUrl;
  $("video-provider-billing").hidden = !billingUrl;
  $("video-provider-billing").setAttribute("aria-label", `前往 ${model.apiKey} 儲值`);
  const veoAudio = model.provider === "google";
  $("veo-audio-option").hidden = !veoAudio;
  $("veo-include-audio").disabled = busy || !veoAudio;
  $("veo-audio-option").parentElement.classList.toggle("veo-audio-visible", veoAudio);
  $("confirm-video-generation-message").textContent = usesAccountCredits(modelId)
    ? "影片生成費用將會從帳戶額度扣除，是否確定開始生成？"
    : `影片生成會消耗 ${model.apiKey} 帳戶額度，是否確定開始生成？`;
  syncResultHeading();
  syncGenerateAvailability();
}

function syncResultHeading() {
  $("result-video-resolution").textContent = $("video-resolution").value;
  $("result-video-ratio").textContent = `${$("video-ratio").value} · MP4`;
}

function openApiKeyDialog() {
  const modelId = $("video-model").value;
  const model = VIDEO_MODELS[modelId];
  if (!model || busy) return;
  const storedKey = getApiKey(model.provider);
  $("video-api-key-dialog-title").textContent = `${model.apiKey} API KEY`;
  $("video-api-key-help").textContent = model.provider === "minimax"
    ? "MiniMax H3 系列須使用一般 Pay-as-you-go API KEY；Token Plan／Credit Key 不支援。金鑰只會保存在目前瀏覽器。"
    : model.provider === "google"
      ? "請使用 Google AI Studio Gemini API KEY。金鑰只會保存在目前瀏覽器，並透過代理服務送至 Google。"
      : "請使用 BytePlus ModelArk API KEY。金鑰只會保存在目前瀏覽器，並透過代理服務送至 BytePlus。";
  $("video-api-key-input").value = storedKey?.value || "";
  $("video-api-key-account-credits").checked = memberSignedIn && usesAccountCredits(modelId);
  $("video-api-key-input").placeholder = storedKey ? "已載入保存的 API KEY" : "輸入 API KEY";
  $("video-api-key-error").hidden = true;
  syncVideoApiKeyCreditControls();
  $("video-api-key-dialog").showModal();
  ($("video-api-key-input").disabled ? $("video-api-key-account-credits") : $("video-api-key-input")).focus();
}

function syncVideoApiKeyCreditControls() {
  const accountOption = $("video-api-key-account-credits");
  accountOption.disabled = !memberSignedIn;
  if (!memberSignedIn) accountOption.checked = false;
  $("video-api-key-input").disabled = accountOption.checked;
}

function submitApiKey(event) {
  event.preventDefault();
  const modelId = $("video-model").value;
  const model = VIDEO_MODELS[modelId];
  const value = $("video-api-key-input").value.trim();
  const accountCredits = $("video-api-key-account-credits").checked;
  if (!model) return;
  if (accountCredits && !memberSignedIn) {
    $("video-api-key-error").textContent = "請先登入會員帳號。";
    $("video-api-key-error").hidden = false;
    return;
  }
  if (!accountCredits && !value) {
    $("video-api-key-error").textContent = "請輸入 API KEY。";
    $("video-api-key-error").hidden = false;
    return;
  }
  if (!saveAccountCredits(modelId, accountCredits) || (!accountCredits && !saveApiKey(model.provider, model.apiKey, value))) {
    $("video-api-key-error").textContent = "瀏覽器無法保存 API KEY。";
    $("video-api-key-error").hidden = false;
    return;
  }
  $("video-api-key-dialog").close();
  syncModelDetails();
  void restorePendingGeneration();
}

function setBusy(value, showLock = value) {
  busy = value;
  document.body.setAttribute("aria-busy", String(value));
  $("video-generation-lock").hidden = !showLock;
  for (const id of ["open-film-style", "open-final-storyboard", "preview-video-prompt", "inspect-storyboards", "analyze-storyboards-ai", "reflow-storyboard-times", "open-character-template", "open-video-prompt-builder", "export-storyboard-pdf", "export-video-project", "select-video-project", "clear-video-resources", "video-model", "video-resolution", "video-duration", "video-ratio", "video-api-key", "video-resource-input", "open-video-history"]) $(id).disabled = value;
  $("open-storyboard-ai-pdf").disabled = value || !lastStoryboardAiReport;
  $("open-video-prompt-builder").disabled = value || promptBuilderMinimized || $("video-prompt-builder-dialog").open;
  $("restore-video-prompt-builder").disabled = value;
  document.querySelectorAll(".resource-editor").forEach(editor => editor.contentEditable = String(!value));
  $("storyboard-prompt-mode").disabled = value;
  $("plain-prompt-mode").disabled = value;
  $("download-video").disabled = value || (!generatedVideoBlob && !generatedVideoRemoteUrl);
  $("open-video-history").disabled = value || !generationHistory.length;
  $("veo-include-audio").disabled = value || VIDEO_MODELS[$("video-model").value]?.provider !== "google";
  syncGenerateAvailability();
  syncClearWorkspaceAvailability();
  syncStoryboardPdfAvailability();
  syncPromptModeUi();
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

function explainRejectedReference(message, inputs) {
  if (!/may contain real person/i.test(message)) return message;
  const contentIndex = Number(message.match(/content\[(\d+)\]/i)?.[1]);
  const input = Number.isInteger(contentIndex) && contentIndex > 0 ? inputs[contentIndex - 1] : null;
  const reference = input?.referenceName || (Number.isInteger(contentIndex) ? `content[${contentIndex}]` : "其中一張參考圖片");
  return `BytePlus 拒絕了 ${reference}，因為圖片可能包含真人。請移除該引用，或改用不含真人的參考圖後再試。`;
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

async function pollVideoTask(taskId, apiKey, model, signal, billing = {}, startedAt = Date.now()) {
  while (Date.now() - startedAt < POLL_TIMEOUT) {
    const result = await fetchJson(providerEndpoints(model.provider).query, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, taskId, ...billing }),
      cache: "no-store",
      signal,
    }, model.provider);
    const task = model.provider === "byteplus" || model.provider === "google" ? result : result?.task;
    if (!task) throw Error(`${model.apiKey} 沒有回傳任務資料。`);
    if (model.provider === "google" && task.done) {
      if (task.error) {
        const error = Error(task.error.message || "Google Veo 影片生成失敗。");
        error.terminal = true;
        throw error;
      }
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
    if (["failed", "cancelled", "expired"].includes(taskState)) {
      const error = Error(task.error?.message || task.message || `影片生成${taskState === "cancelled" ? "已取消" : taskState === "expired" ? "已逾時" : "失敗"}。`);
      error.terminal = true;
      throw error;
    }
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    $("video-generation-lock-title").textContent = taskState === "running" ? "影片生成中" : "影片任務排隊中";
    $("video-generation-lock-detail").textContent = `任務 ${taskId} · 已等待 ${elapsed} 秒`;
    setStatus(`${taskState === "running" ? "影片生成中" : "影片排隊中"} · 已等待 ${elapsed} 秒`);
    await wait(POLL_INTERVAL, signal);
  }
  throw Error(`影片生成等待超過 30 分鐘，請稍後至 ${model.apiKey} 查詢任務狀態。`);
}

function generationRecordMetadata(modelId, prompt) {
  const model = VIDEO_MODELS[modelId];
  return {
    modelId,
    modelLabel: model.label,
    provider: model.provider,
    resolution: $("video-resolution").value,
    duration: Number($("video-duration").value),
    ratio: $("video-ratio").value,
    includeAudio: model.provider === "google" ? $("veo-include-audio").checked : true,
    accountCredits: usesAccountCredits(modelId),
    prompt,
  };
}

async function loadGenerationHistory() {
  const saved = await loadStoredValue("video-generation-history").catch(() => null);
  generationHistory = Array.isArray(saved?.items) ? saved.items.filter(item => item?.blob?.size).slice(0, VIDEO_HISTORY_LIMIT) : [];
  syncHistoryButton();
  return generationHistory;
}

function syncHistoryButton() {
  $("open-video-history").textContent = generationHistory.length ? `生成歷史（${generationHistory.length}）` : "生成歷史";
  $("open-video-history").disabled = busy || !generationHistory.length;
}

async function saveGenerationHistory(blob, metadata) {
  await loadGenerationHistory();
  const record = {
    id: globalThis.crypto?.randomUUID?.() || `video-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    blob,
    name: videoFilename(),
    createdAt: Date.now(),
    ...metadata,
  };
  generationHistory.unshift(record);
  generationHistory = generationHistory.slice(0, VIDEO_HISTORY_LIMIT);
  let lastError;
  while (generationHistory.length) {
    try {
      await saveStoredValue("video-generation-history", { items: generationHistory, updatedAt: Date.now() });
      syncHistoryButton();
      return record;
    } catch (error) {
      lastError = error;
      if (generationHistory.length === 1) break;
      generationHistory.pop();
    }
  }
  throw lastError || Error("無法保存生成歷史。");
}

function releaseUrlSet(urls) {
  urls.forEach(url => URL.revokeObjectURL(url));
  urls.clear();
}

function historyTime(value) {
  return new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function loadHistoryVersion(id) {
  const record = generationHistory.find(item => item.id === id);
  if (!record) return;
  releaseVideo();
  generatedVideoBlob = record.blob;
  generatedVideoUrl = URL.createObjectURL(record.blob);
  generatedVideoMetadata = record;
  $("result-video-resolution").textContent = record.resolution || "影片";
  $("result-video-ratio").textContent = `${record.ratio || "原始比例"} · MP4`;
  presentVideo();
  $("video-history-dialog").close();
  setStatus(`已載入 ${historyTime(record.createdAt)} 的生成版本`, "success");
}

async function deleteHistoryVersion(id) {
  const record = generationHistory.find(item => item.id === id);
  if (!record || !window.confirm(`確定刪除 ${historyTime(record.createdAt)} 的生成版本？`)) return;
  generationHistory = generationHistory.filter(item => item.id !== id);
  videoHistorySelection.delete(id);
  if (generationHistory.length) await saveStoredValue("video-generation-history", { items: generationHistory, updatedAt: Date.now() });
  else await deleteStoredValue("video-generation-history");
  syncHistoryButton();
  renderVideoHistory();
}

function renderVideoHistory() {
  releaseUrlSet(historyPreviewUrls);
  videoHistorySelection = new Set([...videoHistorySelection].filter(id => generationHistory.some(item => item.id === id)));
  const list = $("video-history-list");
  list.replaceChildren();
  if (!generationHistory.length) {
    const empty = document.createElement("p");
    empty.className = "video-history-empty";
    empty.textContent = "尚無生成歷史。";
    list.append(empty);
  }
  for (const record of generationHistory) {
    const card = document.createElement("article");
    card.className = "video-history-card";
    const video = document.createElement("video");
    const url = URL.createObjectURL(record.blob);
    historyPreviewUrls.add(url);
    video.src = url;
    video.controls = true;
    video.preload = "metadata";
    const info = document.createElement("div");
    info.className = "video-history-card-info";
    const title = document.createElement("strong");
    title.textContent = record.modelLabel || VIDEO_MODELS[record.modelId]?.label || "影片版本";
    const meta = document.createElement("small");
    meta.textContent = `${historyTime(record.createdAt)} · ${record.resolution || ""} · ${record.ratio || ""} · ${record.duration || "?"} 秒`;
    const actions = document.createElement("div");
    actions.className = "video-history-card-actions";
    const choose = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = videoHistorySelection.has(record.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked && videoHistorySelection.size >= 2) {
        checkbox.checked = false;
        return;
      }
      if (checkbox.checked) videoHistorySelection.add(record.id);
      else videoHistorySelection.delete(record.id);
      $("compare-video-history").disabled = videoHistorySelection.size !== 2;
    });
    choose.append(checkbox, document.createTextNode("比較"));
    const load = document.createElement("button");
    load.type = "button";
    load.textContent = "載入";
    load.addEventListener("click", () => loadHistoryVersion(record.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "刪除";
    remove.addEventListener("click", () => void deleteHistoryVersion(record.id));
    actions.append(choose, load, remove);
    info.append(title, meta, actions);
    card.append(video, info);
    list.append(card);
  }
  $("compare-video-history").disabled = videoHistorySelection.size !== 2;
}

function openVideoHistory() {
  renderVideoHistory();
  $("video-history-dialog").showModal();
}

function compareSelectedVideos() {
  const records = [...videoHistorySelection].map(id => generationHistory.find(item => item.id === id)).filter(Boolean);
  if (records.length !== 2) return;
  $("video-history-dialog").close();
  releaseUrlSet(comparisonPreviewUrls);
  const grid = $("video-compare-grid");
  grid.replaceChildren(...records.map(record => {
    const item = document.createElement("section");
    item.className = "video-compare-item";
    const video = document.createElement("video");
    const url = URL.createObjectURL(record.blob);
    comparisonPreviewUrls.add(url);
    video.src = url;
    video.controls = true;
    video.preload = "metadata";
    const meta = document.createElement("p");
    meta.textContent = `${record.modelLabel || "影片版本"} · ${historyTime(record.createdAt)} · ${record.resolution || ""} · ${record.ratio || ""}`;
    item.append(video, meta);
    return item;
  }));
  $("video-compare-dialog").showModal();
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
  generatedVideoMetadata = null;
  $("retry-save-video").hidden = true;
}

function presentVideo() {
  const video = $("generated-video");
  video.src = generatedVideoUrl || generatedVideoRemoteUrl;
  video.hidden = false;
  $("empty-video-result").hidden = true;
  video.load();
  $("download-video").disabled = false;
}

async function restoreLastGeneratedVideo() {
  if (lastGeneratedVideoRestored) return;
  lastGeneratedVideoRestored = true;
  try {
    await loadGenerationHistory();
    const latest = generationHistory[0];
    if (latest?.blob?.size && !busy) {
      releaseVideo();
      generatedVideoBlob = latest.blob;
      generatedVideoUrl = URL.createObjectURL(generatedVideoBlob);
      generatedVideoMetadata = latest;
      $("result-video-resolution").textContent = latest.resolution || "影片";
      $("result-video-ratio").textContent = `${latest.ratio || "原始比例"} · MP4`;
      presentVideo();
      setStatus("已載入上次生成結果", "success");
      return;
    }
    const record = await loadStoredMedia("generated-video");
    if (!record?.blob?.size || !record.blob.type?.startsWith("video/") || busy) return;
    releaseVideo();
    generatedVideoBlob = record.blob;
    generatedVideoUrl = URL.createObjectURL(generatedVideoBlob);
    presentVideo();
    setStatus("已載入上次生成結果", "success");
  } catch {}
}

async function showVideoResult(remoteUrl, provider = generatedVideoProvider, apiKey = "", metadata = generatedVideoMetadata) {
  const resultMetadata = metadata || {};
  let persisted = false;
  releaseVideo();
  generatedVideoRemoteUrl = remoteUrl;
  generatedVideoProvider = provider;
  generatedVideoApiKey = apiKey;
  generatedVideoMetadata = resultMetadata;
  try {
    const response = await fetch(providerEndpoints(provider).download, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: remoteUrl,
        ...(provider === "google" ? {
          apiKey,
          accountCredits: Boolean(resultMetadata.accountCredits),
          reservationId: resultMetadata.reservationId || "",
        } : {}),
      }),
      cache: "no-store",
    });
    if (!response.ok) throw Error(`影片下載回傳 ${response.status}`);
    const blob = await response.blob();
    if (!blob.size) throw Error("影片檔案內容為空。");
    const downloadedBlob = new Blob([blob], { type: blob.type || "video/mp4" });
    if (provider === "google" && resultMetadata.includeAudio === false) {
      $("video-generation-lock-title").textContent = "正在移除影片音訊";
      $("video-generation-lock-detail").textContent = "Veo 影片已生成，正在建立無音訊版本…";
      generatedVideoBlob = await convertMediaFile({
        file: downloadedBlob,
        format: "mp4",
        inputKind: "video",
        hasAudio: false,
        signal: generationAbort?.signal,
        onProgress: progress => { $("video-generation-lock-detail").textContent = `正在建立無音訊版本 · ${progress}%`; },
      });
    } else generatedVideoBlob = downloadedBlob;
    generatedVideoUrl = URL.createObjectURL(generatedVideoBlob);
    const historyRecord = await saveGenerationHistory(generatedVideoBlob, resultMetadata).catch(() => null);
    if (historyRecord) {
      generatedVideoMetadata = historyRecord;
      persisted = true;
    }
    else showError("影片已生成，但瀏覽器無法保存生成歷史。");
    $("retry-save-video").hidden = true;
  } catch {
    showError(provider === "google" && resultMetadata.includeAudio === false
      ? "影片已生成，但瀏覽器無法建立無音訊版本；目前播放的遠端影片仍可能包含音訊。"
      : "影片已生成，但下載代理無法讀取影片檔案；仍可播放或開啟下載網址。保存功能暫時無法使用。");
    $("retry-save-video").hidden = false;
  }
  presentVideo();
  return persisted;
}

async function savePendingGeneration(taskId, metadata) {
  await saveStoredValue("video-generation-task", { taskId, metadata, createdAt: Date.now(), updatedAt: Date.now() });
}

async function clearPendingGeneration() {
  await deleteStoredValue("video-generation-task").catch(() => {});
}

async function restorePendingGeneration() {
  if (busy) return;
  const pending = await loadStoredValue("video-generation-task").catch(() => null);
  const metadata = pending?.metadata;
  const model = VIDEO_MODELS[metadata?.modelId];
  if (!pending?.taskId || !model) return;
  // 帳戶扣點模式不該把使用者存的私人 API Key 送出去（跟 image-generator.js 的做法對齊）。
  const apiKey = metadata.accountCredits ? "" : getApiKey(model.provider)?.value || "";
  if (!metadata.accountCredits && !apiKey) {
    setStatus(`有一個未完成的 ${metadata.modelLabel || model.label} 任務；設定 API KEY 後重新開啟頁面即可繼續查詢`, "error");
    return;
  }
  setBusy(true);
  generationAbort = new AbortController();
  $("video-generation-lock-title").textContent = "正在恢復影片生成任務";
  $("video-generation-lock-detail").textContent = `任務 ${pending.taskId}`;
  setStatus(`正在恢復 ${metadata.modelLabel || model.label} 生成任務…`);
  try {
    const task = await pollVideoTask(pending.taskId, apiKey, model, generationAbort.signal, {
      accountCredits: Boolean(metadata.accountCredits),
      reservationId: metadata.reservationId || "",
    });
    const saved = await showVideoResult(task.videoUrl, model.provider, apiKey, metadata);
    if (saved) await clearPendingGeneration();
    setStatus(saved ? "已取回先前的影片生成結果" : "影片已生成，將於下次開啟時再次嘗試保存", saved ? "success" : "error");
  } catch (error) {
    if (error?.terminal) await clearPendingGeneration();
    if (error?.name !== "AbortError") {
      showError(error.message || "暫時無法恢復影片生成任務，下次開啟頁面會再次查詢。");
      setStatus(error?.terminal ? "先前的影片任務失敗" : "影片任務將於下次開啟時繼續查詢", "error");
    }
  } finally {
    generationAbort = null;
    setBusy(false);
  }
}

function videoFilename(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `video_${day}_${time}.mp4`;
}

async function generateVideo() {
  const videoDetails = promptVideoDetails();
  const modelId = $("video-model").value;
  const model = VIDEO_MODELS[modelId];
  const accountCredits = usesAccountCredits(modelId);
  // 帳戶扣點模式不該把使用者存的私人 API Key 送出去（跟 image-generator.js 的做法對齊）。
  const apiKey = accountCredits ? "" : getApiKey(model.provider)?.value || "";
  if (!videoDetails || (!accountCredits && !apiKey) || busy) return;
  showError();
  setBusy(true);
  generationAbort = new AbortController();
  let inputs = [];
  let pendingTaskSaved = false;
  const idempotencyKey = crypto.randomUUID();
  $("video-generation-lock-title").textContent = "正在建立影片生成任務";
  $("video-generation-lock-detail").textContent = "請保持此頁面開啟，完成時間依服務狀態而定。";
  try {
    const generation = generationInputs(videoDetails);
    inputs = generation.resources;
    const prompt = completeVideoPrompt(videoDetails);
    generatedVideoMetadata = generationRecordMetadata(modelId, prompt);
    let authorization = "";
    if (accountCredits) {
      const { session, error } = await getCurrentSession();
      if (error) throw error;
      if (!session?.access_token) throw Error("請先登入會員帳號。");
      authorization = `Bearer ${session.access_token}`;
    }
    setStatus(`正在建立 ${model.apiKey} 影片任務…`);
    const payload = await generationPayload(modelId, model, prompt, inputs, generationAbort.signal);
    if (model.provider === "byteplus") {
      payload.generate_audio = true;
      payload.watermark = false;
    }
    const created = await fetchJson(providerEndpoints(model.provider).create, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) },
      body: JSON.stringify({
        apiKey,
        payload,
        accountCredits,
        idempotencyKey,
        billing: { includeAudio: generatedVideoMetadata.includeAudio },
      }),
      cache: "no-store",
      signal: generationAbort.signal,
    }, model.provider);
    const taskId = model.provider === "byteplus" ? created?.id : model.provider === "google" ? created?.name : created?.task_id;
    if (!taskId) throw Error(`${model.apiKey} 沒有回傳影片任務 ID。`);
    if (accountCredits) {
      if (!created?.yumeewReservationId) throw Error("影片任務已建立，但沒有取得額度預扣識別碼。");
      generatedVideoMetadata.reservationId = created.yumeewReservationId;
    }
    pendingTaskSaved = await savePendingGeneration(taskId, generatedVideoMetadata).then(() => true).catch(() => false);
    const task = await pollVideoTask(taskId, apiKey, model, generationAbort.signal, {
      accountCredits,
      reservationId: generatedVideoMetadata.reservationId || "",
    });
    $("video-generation-lock-title").textContent = "影片已完成，正在載入結果";
    $("video-generation-lock-detail").textContent = "正在準備預覽與下載檔案…";
    const saved = await showVideoResult(task.videoUrl, model.provider, apiKey, generatedVideoMetadata);
    if (pendingTaskSaved && saved) {
      await clearPendingGeneration();
      pendingTaskSaved = false;
    }
    setStatus(saved
      ? `生成完成 · ${task.resolution || $("video-resolution").value} · ${task.duration || $("video-duration").value} 秒`
      : "影片已生成，但尚未保存到瀏覽器；下次開啟時會再次嘗試",
    saved ? "success" : "error");
  } catch (error) {
    if (pendingTaskSaved && error?.terminal) await clearPendingGeneration();
    if (error?.name !== "AbortError") {
      const message = error instanceof TypeError
        ? "瀏覽器無法連線至影片生成服務，請稍後再試。"
        : explainRejectedReference(error.message || "影片生成失敗。", inputs);
      showError(message);
      setStatus("影片生成失敗", "error");
    }
  } finally {
    generationAbort = null;
    setBusy(false);
  }
}

async function openGenerateConfirmation() {
  if ($("generate-video").disabled || busy) return;
  const report = isPromptMode()
    ? { errors: 0, totalEntries: 0, promptLength: completeVideoPrompt().length }
    : inspectStoryboardProject();
  if (report.errors) {
    openStoryboardInspection(report);
    setStatus(`請先修正 ${report.errors} 個分鏡錯誤`, "error");
    return;
  }
  const model = VIDEO_MODELS[$("video-model").value];
  const accountCredits = usesAccountCredits($("video-model").value);
  if (accountCredits && !memberSignedIn) {
    showError("請先登入會員帳號，再使用帳戶扣點。");
    setStatus("需要會員登入", "error");
    syncGenerateAvailability();
    return;
  }
  const details = promptVideoDetails();
  const resources = referencedResources();
  const characters = referencedCharacters(details);
  const inputs = generationInputs(details).resources;
  const duration = model.provider === "google" && inputs.length ? 8 : Number($("video-duration").value);
  if (duration !== Number($("video-duration").value)) $("video-duration").value = String(duration);
  setStatus("正在取得最新費率並試算…");
  $("generate-video").disabled = true;
  let estimate;
  try {
    const billing = await fetchVideoBillingSettings(model.billingId);
    estimate = estimateVideoGenerationCost({
      billingId: model.billingId,
      resolution: $("video-resolution").value,
      duration,
      includeAudio: $("veo-include-audio").checked,
      resources: inputs,
    }, billing.settings);
    if (accountCredits) {
      setStatus("正在確認會員剩餘額度…");
      const { session, error } = await getCurrentSession();
      if (error) throw error;
      const account = await fetchMemberAccount(session, { ledger: false });
      if (!hasSufficientVideoCredit(account.balance, estimate.total)) {
        showError("生成額度不足，請先儲值再嘗試。");
        setStatus("生成額度不足", "error");
        syncGenerateAvailability();
        return;
      }
    }
  } catch (error) {
    showError(error.message || "目前無法取得影片生成費率，請稍後再試。");
    setStatus(accountCredits ? "會員額度確認失敗" : "影片費率試算失敗", "error");
    syncGenerateAvailability();
    return;
  }
  const estimatedFee = estimate.resourceCost > 0
    ? `${usd.format(estimate.total)}（影片 ${usd.format(estimate.outputCost)}＋資源 ${usd.format(estimate.resourceCost)}）`
    : usd.format(estimate.total);
  const values = [
    ["生成模型", model.label],
    ["輸出規格", `${$("video-resolution").value} · ${$("video-ratio").value}`],
    ["影片長度", `${duration} 秒`],
    ["生成任務", "1 個"],
    ["內容模式", isPromptMode() ? "題詞模式" : `${report.totalEntries} 個分鏡`],
    ["人物／資源", `${characters.length} 位／${resources.length} 個`],
    ["影片音訊", model.provider === "google" ? ($("veo-include-audio").checked ? "包含" : "不包含") : model.provider === "byteplus" ? "啟用" : "依模型輸出"],
    ["額度／費用", estimatedFee],
    ["題詞長度", `${report.promptLength} 字元`],
  ];
  $("video-generation-summary").replaceChildren(...values.map(([label, value]) => {
    const item = document.createElement("span");
    if (label === "額度／費用") {
      const fee = document.createElement("span");
      fee.className = "video-generation-estimated-fee";
      const prefix = document.createElement("span");
      prefix.textContent = "預估 ";
      const amount = document.createElement("strong");
      amount.textContent = value;
      fee.append(prefix, amount);
      item.append(document.createTextNode(label), fee);
      return item;
    }
    const strong = document.createElement("strong");
    strong.textContent = value;
    item.append(document.createTextNode(label), strong);
    return item;
  }));
  $("confirm-video-generation-dialog").showModal();
  setStatus("已完成生成費率試算");
  syncGenerateAvailability();
}

function confirmVideoGeneration(event) {
  event.preventDefault();
  $("confirm-video-generation-dialog").close();
  void generateVideo();
}

$("open-character-template").addEventListener("click", openCharacterTemplate);
for (const [id, mode] of [["storyboard-prompt-mode", "storyboard"], ["plain-prompt-mode", "prompt"]]) {
  $(id).addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    selectPromptMode(mode);
  });
}
$("open-film-style").addEventListener("click", openFilmStyle);
$("open-final-storyboard").addEventListener("click", openFinalStoryboard);
$("add-final-storyboard-action").addEventListener("click", () => $("final-storyboard-actions").append(createFinalStoryboardAction()));
$("final-storyboard-camera").addEventListener("change", () => syncFinalStoryboardCamera(true));
$("final-storyboard-view-angle").addEventListener("change", () => syncFinalStoryboardView(true));
$("final-storyboard-form").addEventListener("submit", submitFinalStoryboard);
$("cancel-final-storyboard").addEventListener("click", () => $("final-storyboard-dialog").close());
$("final-storyboard-dialog").addEventListener("close", () => {
  hideCharacterMentionMenu();
  hideResourceMentionMenu();
});
$("film-style-primary").addEventListener("change", () => syncFilmStyleCustom(true));
$("film-style-narrator-voice").addEventListener("change", () => syncNarratorVoiceCustom(true));
$("apply-film-style").addEventListener("click", applyFilmStyle);
$("cancel-film-style").addEventListener("click", () => $("film-style-dialog").close());
$("add-character").addEventListener("click", () => openCharacterEditor());
$("close-character-template").addEventListener("click", () => $("character-template-dialog").close());
$("character-reference").addEventListener("change", event => showCharacterEditorReference(event.currentTarget.files?.[0] || null));
$("character-name").addEventListener("input", event => event.currentTarget.setCustomValidity(""));
$("character-voice").addEventListener("change", () => syncCharacterVoiceCustom(true));
$("character-editor-form").addEventListener("submit", submitCharacterEditor);
$("cancel-character-editor").addEventListener("click", () => $("character-editor-dialog").close());
$("delete-character").addEventListener("click", deleteEditingCharacter);
$("preview-video-prompt").addEventListener("click", openVideoPromptPreview);
$("minimize-video-prompt-preview").addEventListener("click", () => minimizeDialog("promptPreview"));
$("restore-video-prompt-preview").addEventListener("click", () => restoreMinimizedDialog("promptPreview"));
$("close-video-prompt-preview").addEventListener("click", () => $("video-prompt-preview-dialog").close());
$("video-prompt-preview-dialog").addEventListener("close", () => syncMinimizedDialog("promptPreview"));
$("inspect-storyboards").addEventListener("click", () => openStoryboardInspection());
$("analyze-storyboards-ai").addEventListener("click", openStoryboardAiConfirmation);
$("open-storyboard-ai-pdf").addEventListener("click", () => void openStoryboardAiPdf());
$("storyboard-ai-confirm-form").addEventListener("submit", confirmStoryboardAiAnalysis);
$("cancel-storyboard-ai").addEventListener("click", () => $("storyboard-ai-confirm-dialog").close());
$("reflow-storyboard-times").addEventListener("click", reflowStoryboardTimes);
$("close-storyboard-inspection").addEventListener("click", () => $("storyboard-inspection-dialog").close());
$("export-storyboard-pdf").addEventListener("click", () => void exportStoryboardPdf());
$("export-video-project").addEventListener("click", openVideoProjectExport);
$("export-video-project-form").addEventListener("submit", event => void exportVideoProject(event));
$("cancel-export-video-project").addEventListener("click", () => $("export-video-project-dialog").close());
$("select-video-project").addEventListener("click", () => $("video-project-input").click());
$("clear-video-resources").addEventListener("click", clearVideoWorkspace);
$("video-project-input").addEventListener("change", event => void selectVideoProject(event));
$("import-video-project-form").addEventListener("submit", event => void importVideoProject(event));
$("cancel-import-video-project").addEventListener("click", () => $("import-video-project-dialog").close());
$("import-video-project-dialog").addEventListener("close", () => { pendingVideoProject = null; });
$("open-video-prompt-builder").addEventListener("click", openVideoPromptBuilder);
$("minimize-video-prompt-builder").addEventListener("click", minimizeVideoPromptBuilder);
$("restore-video-prompt-builder").addEventListener("click", restoreVideoPromptBuilder);
$("video-prompt-camera").addEventListener("change", () => syncCameraControls(true));
$("video-prompt-view-angle").addEventListener("change", () => syncViewControls(true));
$("video-prompt-view-subjects").addEventListener("change", event => {
  if (!event.target.matches("input[type=checkbox]") || !event.target.checked || $("video-prompt-action-character").value) return;
  $("video-prompt-action-character").value = event.target.value;
});
$("video-prompt-action-category").addEventListener("change", () => syncActionControls());
$("video-prompt-action-type").addEventListener("change", event => syncActionControls(event.currentTarget.value, true));
$("video-prompt-lighting").addEventListener("change", () => syncLightingControls(true));
$("add-video-dialogue").addEventListener("click", () => {
  $("video-dialogue-list").append(createDialogueRow());
  syncDialogueEmptyState();
});
for (const input of [$("video-prompt-start"), $("video-prompt-end")]) {
  input.addEventListener("keydown", event => {
    if (["e", "E", "+", "-"].includes(event.key)) event.preventDefault();
  });
  input.addEventListener("input", () => {
    input.setCustomValidity("");
    $("video-prompt-end").setCustomValidity("");
  });
}
$("video-prompt-builder-form").addEventListener("submit", submitVideoPromptBuilder);
$("cancel-video-prompt-builder").addEventListener("click", () => {
  hideCharacterMentionMenu();
  hideResourceMentionMenu();
  $("video-prompt-builder-dialog").close();
});
$("video-prompt-builder-dialog").addEventListener("close", () => {
  hideCharacterMentionMenu();
  hideResourceMentionMenu();
  const minimized = $("video-prompt-builder-dialog").returnValue === "minimized";
  promptBuilderMinimized = minimized;
  if (!minimized) editingStoryboardId = "";
  $("restore-video-prompt-builder").hidden = !minimized;
  $("open-video-prompt-builder").disabled = busy || minimized;
});
$("video-prompt-builder-dialog").addEventListener("pointerdown", event => {
  if (characterMentionTarget && !$("character-mention-menu").contains(event.target) && event.target !== characterMentionTarget) hideCharacterMentionMenu();
});
$("video-prompt-builder-dialog").addEventListener("scroll", () => {
  if (characterMentionTarget) positionCharacterMentionMenu(characterMentionTarget, $("character-mention-menu").childElementCount);
  if (resourceMentionTarget) positionResourceMentionMenu(resourceMentionTarget, $("resource-mention-menu").childElementCount);
});
arrangeVideoPromptBuilderFields();
cloneSelectOptions("video-prompt-camera", "final-storyboard-camera");
cloneSelectOptions("video-prompt-shot-size", "final-storyboard-shot-size");
cloneSelectOptions("video-prompt-view-angle", "final-storyboard-view-angle");
syncCameraControls();
renderStoryboardCharacterControls();
renderDialogueRows();
document.querySelectorAll(".resource-editor").forEach(setupResourceEditor);
syncViewControls();
syncActionControls();
syncLightingControls();
$("video-resource-input").addEventListener("change", event => void addVideoResources([...event.currentTarget.files]));
$("close-video-resource-preview").addEventListener("click", () => $("video-resource-preview-dialog").close());
$("video-resource-preview-dialog").addEventListener("close", stopResourcePreview);
document.addEventListener("click", event => {
  const token = event.target.matches?.(".resource-token") ? event.target : null;
  if (token) openResourcePreview(token.dataset.resourceId);
});
document.addEventListener("keydown", event => {
  if (!event.target.matches?.(".resource-token")) return;
  if (["Backspace", "Delete"].includes(event.key)) {
    event.preventDefault();
    removeResourceMention(event.target);
    return;
  }
  if (!["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  openResourcePreview(event.target.dataset.resourceId);
});
document.addEventListener("pointerdown", event => {
  if (characterMentionTarget && !$("character-mention-menu").contains(event.target) && event.target !== characterMentionTarget) hideCharacterMentionMenu();
  if (resourceMentionTarget && !$("resource-mention-menu").contains(event.target) && !event.target.closest?.(".resource-editor")) hideResourceMentionMenu();
});
$("video-model").addEventListener("change", () => { syncModelDetails(); scheduleAutoDraft(); });
$("video-resolution").addEventListener("change", () => { syncResultHeading(); scheduleAutoDraft(); });
$("video-duration").addEventListener("change", () => scheduleAutoDraft());
$("video-ratio").addEventListener("change", () => { syncResultHeading(); scheduleAutoDraft(); });
$("veo-include-audio").addEventListener("change", () => scheduleAutoDraft());
$("video-api-key").addEventListener("click", openApiKeyDialog);
$("video-api-key-account-credits").addEventListener("change", syncVideoApiKeyCreditControls);
$("video-api-key-form").addEventListener("submit", submitApiKey);
$("cancel-video-api-key").addEventListener("click", () => $("video-api-key-dialog").close());
onAuthStateChange(session => {
  memberSignedIn = Boolean(session?.user);
  syncModelDetails();
  syncVideoApiKeyCreditControls();
});
$("generate-video").addEventListener("click", openGenerateConfirmation);
$("confirm-video-generation-form").addEventListener("submit", confirmVideoGeneration);
$("cancel-video-generation").addEventListener("click", () => $("confirm-video-generation-dialog").close());
$("download-video").addEventListener("click", () => {
  if (busy || (!generatedVideoBlob && !generatedVideoRemoteUrl)) return;
  const link = document.createElement("a");
  link.href = generatedVideoUrl || generatedVideoRemoteUrl;
  link.download = generatedVideoBlob ? generatedVideoMetadata?.name || videoFilename() : "";
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
  await showVideoResult(retryUrl, retryProvider, retryApiKey);
  setStatus(generatedVideoBlob ? "影片已保存到瀏覽器" : "影片保存失敗", generatedVideoBlob ? "success" : "error");
  setBusy(false);
});

$("open-video-history").addEventListener("click", openVideoHistory);
$("close-video-history").addEventListener("click", () => $("video-history-dialog").close());
$("video-history-dialog").addEventListener("close", () => releaseUrlSet(historyPreviewUrls));
$("compare-video-history").addEventListener("click", compareSelectedVideos);
$("close-video-compare").addEventListener("click", () => $("video-compare-dialog").close());
$("video-compare-dialog").addEventListener("close", () => releaseUrlSet(comparisonPreviewUrls));

window.addEventListener("pagehide", () => {
  if (autoDraftReady) void saveAutoDraftNow({ resources: autoDraftResourcesDirty }).catch(() => {});
  generationAbort?.abort();
  releaseVideo();
  releaseUrlSet(historyPreviewUrls);
  releaseUrlSet(comparisonPreviewUrls);
  characterPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  characterPreviewUrls.clear();
  releaseResourceUrls();
  stopResourcePreview();
});

syncModelDetails();
syncPromptModeUi();
syncDraftStatus(false);
void getCurrentSession().then(({ session }) => {
  memberSignedIn = Boolean(session?.user);
  syncModelDetails();
  syncVideoApiKeyCreditControls();
}).catch(() => {});
function restoreWhenIdle(task) {
  const run = () => void task();
  if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(run, { timeout: 1200 });
  else setTimeout(run, 0);
}
restoreWhenIdle(async () => {
  await Promise.all([restoreCharacterTemplates(), restoreAutoDraft()]);
});
void loadGenerationHistory().then(async () => {
  await restorePendingGeneration();
  restoreWhenIdle(() => restoreLastGeneratedVideo());
});
