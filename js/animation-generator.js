import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { deleteStoredValue, loadStoredValue, saveStoredValue } from "./media-store.js";
import { clientIdentityHeaders } from "./client-identity.js";
import { drawMvScene, fallbackSceneSpec, isValidSceneSpec } from "./animation-scenes.js";
import { exportFilename } from "./formats.js";
import { encodeMedia } from "./export.js";

// 分鏡編輯介面完全比照影片生成器（js/video-generator.js）：分鏡卡片、人物模板（持久化）、
// 全片風格、分鏡合理性檢查、專案匯出入的欄位與互動方式都是同一套。差異只在於：
// - 沒有 @ 資源／# 人物提及的 contenteditable 編輯器（那套機制是為了讓使用者引用上傳
//   給付費影片模型消費的圖片／音訊／影片資源；動畫生成沒有這個概念，改用一般輸入框）。
// - 沒有最終分鏡、模型選擇、API Key、帳戶扣點、生成歷史（這些是付費影片模型特有的
//   概念，動畫生成是本機 Canvas 繪製，沒有對應功能）。
// - 生成的不是影片模型題詞，而是送到 inspiration-chat 的 /api/mv-scene/generate，
//   把分鏡欄位轉成 Canvas 2.5D 分層規格。
// - 不需要使用者上傳音樂：時間軸完全由分鏡卡片的開始／結束時間決定，匯出時合成一段
//   靜音音軌（encodeMedia 需要 AudioBuffer 才能編碼，這樣完全不用改動共用的匯出管線）。
const MV_SCENE_URL = "https://inspiration-chat.yustellar.idv.tw/api/mv-scene/generate";
const STORYBOARD_PRIMARY_URL = "https://storyboard-checker.yustellar.idv.tw/api/storyboard/check";
const STORYBOARD_FALLBACK_URL = "https://inspiration-chat.yustellar.idv.tw/api/storyboard/check";

const STORYBOARD_ACTIONS = Object.freeze({
  movement: Object.freeze(["站立", "坐下", "起身", "向前走", "向後退", "奔跑", "跳躍", "蹲下", "轉身", "停下", "進入畫面", "離開畫面"]),
  gaze: Object.freeze(["抬頭", "低頭", "回頭", "點頭", "搖頭", "看向鏡頭", "看向另一名角色", "看向遠方", "閉上眼睛", "睜開眼睛", "眨眼"]),
  expression: Object.freeze(["微笑", "大笑", "哭泣", "露出驚訝表情", "露出憤怒表情", "顯得緊張", "顯得害羞", "保持面無表情", "表情逐漸轉變"]),
  gesture: Object.freeze(["揮手", "指向目標", "伸手", "握拳", "張開雙臂", "鼓掌", "擁抱", "鞠躬", "跳舞", "旋轉身體", "跌倒", "起身"]),
  object: Object.freeze(["拿起物品", "放下物品", "打開物品", "關閉物品", "推動物品", "拉動物品", "拋出物品", "接住物品", "書寫", "閱讀", "喝水", "彈奏樂器", "使用手機"]),
  interaction: Object.freeze(["走向另一名角色", "牽手", "握手", "擁抱另一名角色", "追逐", "閃避", "推開另一名角色", "並肩行走", "面對面交談", "將物品交給對方"]),
  environment: Object.freeze(["頭髮隨風飄動", "衣物隨風擺動", "被雨淋濕", "踩出水花", "被強光照亮", "因衝擊後退", "在煙霧中前進"]),
});
const EMPTY_FILM_STYLE = Object.freeze({ primary: "", primaryCustom: "", era: "", color: "", texture: "", framing: "", narratorVoice: "", narratorCustom: "", notes: "" });

const $ = (id) => document.getElementById(id);
const MAX_SEGMENT = 60;
const MIN_SEGMENT = 0.5;

const restored = loadSettings();
applyTheme(restored.mode, restored.theme);

let busy = false;
let controller = null;
let downloadUrl = "";
let editingStoryboardId = "";
let filmStyle = { ...EMPTY_FILM_STYLE };
const storyboards = new Map();
let characterTemplates = [];
const characterPreviewUrls = new Set();
let editingCharacterIndex = -1;
let editingCharacterReference = null;
let lastStoryboardAiReport = null;

const canvas = $("mv-canvas");
const settings = { storyboard: [], darkness: 0 };

// ---- 虛擬時鐘（沒有音樂，預覽播放靠自己的計時器驅動）----
let previewTime = 0;
let playing = false;
let rafId = 0;
let lastTick = 0;

function totalDuration() {
  return [...storyboards.values()].reduce((max, draft) => Math.max(max, Number(draft.end) || 0), 0);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function renderFrame() {
  drawMvScene(canvas, previewTime, null, null, settings);
  $("mv-time").textContent = formatTime(previewTime);
  const duration = totalDuration();
  $("mv-seek").value = String(duration > 0 ? Math.round((previewTime / duration) * 1000) : 0);
}

function tick(now) {
  if (!playing) return;
  const duration = totalDuration();
  previewTime = Math.min(duration, previewTime + (now - lastTick) / 1000);
  lastTick = now;
  renderFrame();
  if (previewTime >= duration) {
    playing = false;
    $("mv-play").textContent = "▶";
    $("mv-play").setAttribute("aria-label", "播放");
    return;
  }
  rafId = requestAnimationFrame(tick);
}

function status(text, mode = "") {
  const el = $("video-generation-status");
  el.textContent = text;
  el.className = `generation-status ${mode}`;
}

function error(text = "") {
  const el = $("video-generation-error");
  el.textContent = text;
  el.hidden = !text;
}

function htmlText(value = "") {
  return String(value || "").trim();
}

function syncGenerateAvailability() {
  $("generate-video").disabled = busy || storyboards.size === 0;
  $("inspect-storyboards").disabled = busy;
  $("analyze-storyboards-ai").disabled = busy || storyboards.size === 0;
  $("export-video-project").disabled = busy || storyboards.size === 0;
  $("clear-video-resources").disabled = busy || storyboards.size === 0;
}

function setBusy(value) {
  busy = value;
  $("video-generation-lock").hidden = !value;
  $("open-video-prompt-builder").disabled = value;
  $("open-character-template").disabled = value;
  $("open-film-style").disabled = value;
  syncGenerateAvailability();
}

// ---- 全片風格 ----
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
  $("film-style-dialog").showModal();
  $("film-style-primary").focus();
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
}

// ---- 人物模板（IndexedDB 持久化，跟影片生成器同一套介面，各自獨立保存）----
function normalizedCharacterName(name = "") {
  return String(name).normalize("NFKC").trim().toLocaleLowerCase("zh-TW");
}
function characterNameExists(name, ignoredIndex = -1) {
  const normalized = normalizedCharacterName(name);
  return Boolean(normalized) && characterTemplates.some((character, index) => index !== ignoredIndex && normalizedCharacterName(character.name) === normalized);
}
async function persistCharacterTemplates() {
  if (characterTemplates.length) await saveStoredValue("mv-character-templates", { characters: characterTemplates, updatedAt: Date.now() });
  else await deleteStoredValue("mv-character-templates");
  syncCharacterTemplateButton();
}
function syncCharacterTemplateButton() {
  const enabledCount = characterTemplates.filter((character) => character.enabled !== false).length;
  $("open-character-template").textContent = characterTemplates.length ? `人物模板 (啟用 ${enabledCount}/${characterTemplates.length})` : "人物模板";
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
async function toggleCharacterTemplate(index) {
  const character = characterTemplates[index];
  if (!character) return;
  const previous = character.enabled !== false;
  character.enabled = !previous;
  renderCharacterTemplates();
  try {
    await persistCharacterTemplates();
    status(`已${character.enabled ? "啟用" : "停用"}人物「${character.name}」`, "success");
  } catch {
    character.enabled = previous;
    renderCharacterTemplates();
    status("人物啟用狀態無法保存到瀏覽器", "error");
  }
}
function renderCharacterTemplates() {
  characterPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
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
  const presetExists = [...$("character-voice").options].some((option) => option.value === value && value !== "custom");
  $("character-voice").value = presetExists ? value : value ? "custom" : "";
  $("character-voice-custom").value = value && !presetExists ? value : "";
  syncCharacterVoiceCustom();
}
function characterVoiceValue() {
  return $("character-voice").value === "custom" ? $("character-voice-custom").value.trim() : $("character-voice").value;
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
    referenceBitmap: editingCharacterReference ? await createImageBitmap(editingCharacterReference) : null,
    style: $("character-style").value.trim(),
    tone: $("character-tone").value.trim(),
    voice: characterVoiceValue(),
    clothing: $("character-clothing").value.trim(),
    enabled: editingCharacterIndex >= 0 ? characterTemplates[editingCharacterIndex]?.enabled !== false : true,
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
    status(`已保存人物「${character.name}」`, "success");
  } catch {
    status("人物模板無法保存到瀏覽器", "error");
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
    status(`已刪除人物「${name}」`, "success");
  } catch {
    status("人物模板刪除後無法同步保存", "error");
  }
}
async function restoreCharacterTemplates() {
  try {
    const stored = await loadStoredValue("mv-character-templates");
    if (!Array.isArray(stored?.characters)) return;
    characterTemplates = await Promise.all(stored.characters.map(async (character) => ({ ...character, enabled: character.enabled !== false, referenceBitmap: character.referenceImage ? await createImageBitmap(character.referenceImage) : null })));
    renderCharacterTemplates();
  } catch {}
}
function enabledCharacters() {
  return characterTemplates.filter((character) => character.enabled !== false && character.name);
}
function characterByName(name) {
  return enabledCharacters().find((character) => character.name === name) || null;
}

// ---- 分鏡建構器（比照影片生成器的「新增分鏡」對話框，改用一般輸入框取代 @ 資源提及）----
function syncCameraControls(focusCustom = false) {
  const custom = $("video-prompt-camera").value === "custom";
  $("video-prompt-camera-speed").disabled = !$("video-prompt-camera").value;
  $("video-prompt-camera-custom").hidden = !custom;
  if (custom && focusCustom) $("video-prompt-camera-custom").focus();
}
function selectedStoryboardSubjects() {
  return [...$("video-prompt-view-subjects").querySelectorAll("input:checked")].map((input) => input.value);
}
function renderStoryboardCharacterControls(selectedSubjects = selectedStoryboardSubjects(), viewpoint = $("video-prompt-viewpoint-character").value, actionCharacter = $("video-prompt-action-character").value) {
  const characters = enabledCharacters();
  const subjects = $("video-prompt-view-subjects");
  if (!characters.length) {
    const empty = document.createElement("span");
    empty.className = "video-view-subjects-empty";
    empty.textContent = "尚無已啟用人物";
    subjects.replaceChildren(empty);
  } else {
    subjects.replaceChildren(...characters.map((character) => {
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
  viewpointSelect.replaceChildren(placeholder, ...characters.map((character) => {
    const option = document.createElement("option");
    option.value = character.name;
    option.textContent = character.name;
    return option;
  }));
  viewpointSelect.value = characters.some((character) => character.name === viewpoint) ? viewpoint : "";
  const actionSelect = $("video-prompt-action-character");
  const unspecified = document.createElement("option");
  unspecified.value = "";
  unspecified.textContent = "未指定執行角色";
  const everyone = document.createElement("option");
  everyone.value = "__all__";
  everyone.textContent = "所有畫面人物";
  actionSelect.replaceChildren(unspecified, everyone, ...characters.map((character) => {
    const option = document.createElement("option");
    option.value = character.name;
    option.textContent = character.name;
    return option;
  }));
  actionSelect.value = actionCharacter === "__all__" || characters.some((character) => character.name === actionCharacter) ? actionCharacter : "";
}
function dialogueSpeakerSelect(selected = "") {
  const select = document.createElement("select");
  select.className = "setting-select video-dialogue-speaker";
  select.setAttribute("aria-label", "說話者");
  const choices = [["", "選擇說話者"], ["__narrator__", "旁白"], ...enabledCharacters().map((character) => [character.name, character.name])];
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
  text.value = dialogue.text || "";
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
    empty.textContent = "尚未加入對話。";
    list.append(empty);
  }
}
function renderDialogueRows(dialogues = []) {
  $("video-dialogue-list").replaceChildren(...dialogues.map(createDialogueRow));
  syncDialogueEmptyState();
}
function collectDialogueRows() {
  return [...$("video-dialogue-list").querySelectorAll(".video-dialogue-row")].map((row) => ({
    speaker: row.querySelector(".video-dialogue-speaker").value,
    emotion: row.querySelector(".video-dialogue-emotion").value.trim(),
    text: row.querySelector(".video-dialogue-text").value.trim(),
  })).filter((dialogue) => dialogue.text);
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
  const options = (STORYBOARD_ACTIONS[category] || []).map((action) => {
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
  actionSelect.value = options.some((option) => option.value === selectedAction) ? selectedAction : "";
  const custom = actionSelect.value === "custom";
  $("video-prompt-action-custom").hidden = !custom;
  if (custom && focusCustom) $("video-prompt-action-custom").focus();
}
function syncLightingControls(focusCustom = false) {
  const lighting = $("video-prompt-lighting").value;
  const custom = lighting === "custom";
  $("video-prompt-lighting-temperature").disabled = !lighting;
  $("video-prompt-lighting-intensity").disabled = !lighting;
  $("video-prompt-lighting-custom").hidden = !custom;
  if (custom && focusCustom) $("video-prompt-lighting-custom").focus();
}

function collectStoryboardDraft() {
  return {
    id: editingStoryboardId || globalThis.crypto?.randomUUID?.() || `storyboard-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    start: $("video-prompt-start").value,
    end: $("video-prompt-end").value,
    summary: $("video-prompt-summary").value.trim(),
    scene: $("video-prompt-scene").value.trim(),
    shotSize: $("video-prompt-shot-size").value,
    viewAngle: $("video-prompt-view-angle").value,
    viewCustom: $("video-prompt-view-custom").value.trim(),
    viewSubjects: selectedStoryboardSubjects(),
    viewpointCharacter: $("video-prompt-viewpoint-character").value,
    sound: $("video-prompt-sound").value.trim(),
    actionCharacter: $("video-prompt-action-character").value,
    actionCategory: $("video-prompt-action-category").value,
    actionType: $("video-prompt-action-type").value,
    actionStyle: $("video-prompt-action-style").value,
    actionCustom: $("video-prompt-action-custom").value.trim(),
    actionTarget: $("video-prompt-action-target").value.trim(),
    actionDetail: $("video-prompt-action-detail").value.trim(),
    dialogues: collectDialogueRows(),
    camera: $("video-prompt-camera").value,
    cameraSpeed: $("video-prompt-camera-speed").value,
    cameraCustom: $("video-prompt-camera-custom").value.trim(),
    lighting: $("video-prompt-lighting").value,
    lightingTemperature: $("video-prompt-lighting-temperature").value,
    lightingIntensity: $("video-prompt-lighting-intensity").value,
    lightingCustom: $("video-prompt-lighting-custom").value.trim(),
    spec: editingStoryboardId ? storyboards.get(editingStoryboardId)?.spec ?? null : null,
    specHash: editingStoryboardId ? storyboards.get(editingStoryboardId)?.specHash ?? "" : "",
    specSource: editingStoryboardId ? storyboards.get(editingStoryboardId)?.specSource ?? "" : "",
    specNote: editingStoryboardId ? storyboards.get(editingStoryboardId)?.specNote ?? "" : "",
  };
}
function nextStoryboardStart() {
  const blocks = document.querySelectorAll("#video-prompt .storyboard-block");
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
  const angle = draft.viewAngle === "custom" ? draft.viewCustom : draft.viewAngle;
  const parts = [
    draft.shotSize,
    angle,
    draft.viewpointCharacter ? `視點角色：${draft.viewpointCharacter}` : "",
    draft.viewSubjects?.length ? `畫面主體：${draft.viewSubjects.join("、")}` : "",
  ].filter(Boolean);
  return parts.join("、");
}
function actionPromptField(draft) {
  const actor = draft.actionCharacter === "__all__" ? "所有畫面人物" : draft.actionCharacter;
  const action = draft.actionType === "custom" ? draft.actionCustom : draft.actionType;
  const head = action ? `${actor || ""}${draft.actionStyle || ""}${action}` : "";
  return [head, draft.actionTarget ? `目標或物件：${draft.actionTarget}` : "", draft.actionDetail].filter(Boolean).join("，");
}
function dialoguePromptField(dialogues = []) {
  return dialogues.map((dialogue) => {
    if (!dialogue.text) return "";
    const speaker = dialogue.speaker === "__narrator__" ? "旁白" : dialogue.speaker || "未指定人物";
    return `${speaker}${dialogue.emotion ? `（${dialogue.emotion}）` : ""}：「${dialogue.text}」`;
  }).filter(Boolean).join("\n");
}
function storyboardFields(draft) {
  const cameraPrefix = draft.cameraSpeed || "";
  const cameraText = draft.camera === "custom" ? `${cameraPrefix}${cameraPrefix ? " " : ""}${draft.cameraCustom}` : draft.camera ? `${cameraPrefix}${draft.camera}` : "";
  const lightingPrefix = `${draft.lightingIntensity || ""}${draft.lightingTemperature || ""}`;
  const lightingText = draft.lighting === "custom" ? `${lightingPrefix}${lightingPrefix ? " " : ""}${draft.lightingCustom}` : draft.lighting ? `${lightingPrefix}${draft.lighting}` : "";
  return [
    ["時間", draft.start !== "" && draft.end !== "" ? formatStoryboardTime(draft.start, draft.end) : ""],
    ["場景", draft.scene],
    ["鏡頭", cameraText],
    ["視角", viewPromptField(draft)],
    ["燈光", lightingText],
    ["音效", draft.sound],
    ["動作", actionPromptField(draft)],
    ["人物與對話", dialoguePromptField(draft.dialogues || [])],
  ].filter(([, value]) => value);
}
function storyboardPromptText(draft) {
  if (!draft) return "";
  return storyboardFields(draft).map(([label, value]) => `${label}：${value}`).join("\n");
}
function storyboardCharacterNames(draft) {
  return [...new Set([...(draft.viewSubjects || []), draft.viewpointCharacter, draft.actionCharacter, ...(draft.dialogues || []).map((d) => d.speaker)]
    .filter((name) => name && name !== "__all__" && name !== "__narrator__"))];
}
function characterContextText(draft) {
  const names = storyboardCharacterNames(draft);
  const lines = names.map((name) => {
    const character = characterByName(name);
    if (!character) return "";
    const traits = [character.style && `風格 ${character.style}`, character.tone && `口氣 ${character.tone}`, character.clothing && `服裝 ${character.clothing}`].filter(Boolean).join("，");
    return traits ? `人物「${name}」：${traits}` : "";
  }).filter(Boolean);
  return lines.join("\n");
}

function storyboardAction(kind, label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `storyboard-card-action ${kind}`;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", (event) => { event.stopPropagation(); handler(); });
  return button;
}
function refreshStoryboardLabels() {
  const blocks = [...document.querySelectorAll("#video-prompt .storyboard-block")];
  blocks.forEach((block, index) => {
    block.querySelector(".storyboard-card-title").textContent = `分鏡 ${index + 1}`;
    block.setAttribute("aria-label", `編輯分鏡 ${index + 1}`);
    block.querySelector(".storyboard-card-action.up").disabled = index === 0;
    block.querySelector(".storyboard-card-action.down").disabled = index === blocks.length - 1;
  });
  syncGenerateAvailability();
  renderFrame();
}
function orderedStoryboardEntries() {
  return [...$("video-prompt").querySelectorAll(".storyboard-block")].map((block, index) => ({
    block, draft: storyboards.get(block.dataset.storyboardId), index,
  })).filter((entry) => entry.draft);
}
function moveStoryboard(id, direction) {
  if (busy) return;
  const block = document.querySelector(`[data-storyboard-id="${CSS.escape(id)}"]`);
  const sibling = direction < 0 ? block?.previousElementSibling : block?.nextElementSibling;
  if (!block || !sibling?.matches(".storyboard-block")) return;
  if (direction < 0) sibling.before(block); else sibling.after(block);
  refreshStoryboardLabels();
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
    const duration = Math.max(0.1, Number(draft.end) - Number(draft.start) || 0.1);
    draft.start = roundedStoryboardTime(cursor);
    cursor += duration;
    draft.end = roundedStoryboardTime(cursor);
    redrawStoryboard(draft.id);
  }
  refreshStoryboardLabels();
  renderStoryboardInspection(inspectStoryboardProject());
  status(`已重新接續 ${entries.length} 個分鏡時間`, "success");
}
function createStoryboardBlock(draft) {
  const block = document.createElement("article");
  block.className = "storyboard-block";
  block.dataset.storyboardId = draft.id;
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
  for (const [label, value] of storyboardFields(draft)) {
    const row = document.createElement("div");
    row.className = "storyboard-field";
    const fieldLabel = document.createElement("span");
    fieldLabel.className = "storyboard-field-label";
    fieldLabel.textContent = `${label}：`;
    row.append(fieldLabel, document.createTextNode(value));
    block.append(row);
  }
  if (draft.specNote) {
    const note = document.createElement("div");
    note.className = `storyboard-field mv-scene-spec-note ${draft.specSource}`;
    note.textContent = draft.specNote;
    block.append(note);
  }
  block.append(actions);
  block.addEventListener("click", (event) => {
    if (event.target.closest(".storyboard-card-action")) return;
    editStoryboard(draft.id);
  });
  block.addEventListener("keydown", (event) => {
    if (["Enter", " "].includes(event.key) && event.target === block) {
      event.preventDefault();
      editStoryboard(draft.id);
    }
  });
  return block;
}
function resetVideoPromptBuilder() {
  editingStoryboardId = "";
  $("video-prompt-builder-form").reset();
  $("video-prompt-start").value = nextStoryboardStart();
  $("video-prompt-end").value = roundedStoryboardTime(Number(nextStoryboardStart()) + 4);
  renderStoryboardCharacterControls([], "", "");
  renderDialogueRows();
  syncCameraControls();
  syncViewControls();
  syncActionControls();
  syncLightingControls();
  $("submit-video-prompt-builder").textContent = "加入分鏡";
}
function openVideoPromptBuilder() {
  if (busy) return;
  resetVideoPromptBuilder();
  $("video-prompt-builder-dialog").showModal();
  $("video-prompt-scene").focus();
}
function editStoryboard(id) {
  if (busy) return;
  const draft = storyboards.get(id);
  if (!draft) return;
  resetVideoPromptBuilder();
  editingStoryboardId = id;
  $("video-prompt-start").value = draft.start;
  $("video-prompt-end").value = draft.end;
  $("video-prompt-summary").value = draft.summary || "";
  $("video-prompt-scene").value = draft.scene || "";
  $("video-prompt-sound").value = draft.sound || "";
  $("video-prompt-camera").value = draft.camera;
  $("video-prompt-camera-speed").value = draft.cameraSpeed;
  $("video-prompt-camera-custom").value = draft.cameraCustom || "";
  $("video-prompt-shot-size").value = draft.shotSize;
  $("video-prompt-view-angle").value = draft.viewAngle;
  $("video-prompt-view-custom").value = draft.viewCustom || "";
  renderStoryboardCharacterControls(draft.viewSubjects, draft.viewpointCharacter, draft.actionCharacter);
  renderDialogueRows(draft.dialogues || []);
  $("video-prompt-action-category").value = draft.actionCategory;
  syncActionControls(draft.actionType);
  $("video-prompt-action-style").value = draft.actionStyle;
  $("video-prompt-action-custom").value = draft.actionCustom || "";
  $("video-prompt-action-target").value = draft.actionTarget || "";
  $("video-prompt-action-detail").value = draft.actionDetail || "";
  $("video-prompt-lighting").value = draft.lighting;
  $("video-prompt-lighting-temperature").value = draft.lightingTemperature;
  $("video-prompt-lighting-intensity").value = draft.lightingIntensity;
  $("video-prompt-lighting-custom").value = draft.lightingCustom || "";
  syncCameraControls();
  syncViewControls();
  syncLightingControls();
  $("submit-video-prompt-builder").textContent = "儲存分鏡";
  $("video-prompt-builder-dialog").showModal();
}
function duplicateStoryboard(id) {
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
}
function deleteStoryboard(id) {
  const block = document.querySelector(`[data-storyboard-id="${CSS.escape(id)}"]`);
  if (!block || !window.confirm("確定刪除這個分鏡？")) return;
  storyboards.delete(id);
  block.remove();
  refreshStoryboardLabels();
}
function validateStoryboardTimes(form) {
  const startInput = $("video-prompt-start");
  const endInput = $("video-prompt-end");
  startInput.setCustomValidity(startInput.value === "" ? "請輸入開始時間" : "");
  endInput.setCustomValidity(endInput.value === "" ? "請輸入結束時間" : "");
  if (startInput.value !== "" && endInput.value !== "" && Number(endInput.value) <= Number(startInput.value)) endInput.setCustomValidity("結束時間必須大於開始時間");
  else if (startInput.value !== "" && endInput.value !== "" && Number(endInput.value) - Number(startInput.value) > MAX_SEGMENT) endInput.setCustomValidity(`單一分鏡最長 ${MAX_SEGMENT} 秒`);
  return form.reportValidity();
}
function validateDialogueRows(form) {
  let valid = true;
  $("video-dialogue-list").querySelectorAll(".video-dialogue-row").forEach((row) => {
    const speaker = row.querySelector(".video-dialogue-speaker");
    const hasText = Boolean(row.querySelector(".video-dialogue-text").value.trim());
    speaker.setCustomValidity(hasText && !speaker.value ? "請選擇說話者或旁白" : "");
    if (!speaker.checkValidity()) valid = false;
  });
  if (!valid) form.reportValidity();
  return valid;
}
function submitVideoPromptBuilder(event) {
  event.preventDefault();
  if (!validateStoryboardTimes(event.currentTarget)) return;
  if (!validateDialogueRows(event.currentTarget)) return;
  const draft = collectStoryboardDraft();
  if (!storyboardFields(draft).length) return;
  const prompt = $("video-prompt");
  storyboards.set(draft.id, draft);
  const existing = editingStoryboardId ? prompt.querySelector(`[data-storyboard-id="${CSS.escape(editingStoryboardId)}"]`) : null;
  const block = createStoryboardBlock(draft);
  if (existing) existing.replaceWith(block); else prompt.append(block);
  refreshStoryboardLabels();
  resetVideoPromptBuilder();
  $("video-prompt-builder-dialog").close();
  block.focus();
}

// ---- 分鏡合理性檢查（沿用影片生成器已串接的 storyboard-checker／inspiration-chat 分析引擎）----
function continuityProfile(draft) {
  const text = storyboardPromptText(draft);
  const firstMatch = (values) => values.find((value) => text.includes(value)) || "";
  return {
    time: firstMatch(["清晨", "白天", "正午", "黃昏", "夜晚", "深夜"]),
    place: firstMatch(["室內", "室外"]),
    weather: firstMatch(["晴天", "雨天", "下雨", "雪天", "下雪"]),
    temperature: draft.lightingTemperature || firstMatch(["暖色", "冷色"]),
    characters: new Set(storyboardCharacterNames(draft).filter((name) => enabledCharacters().some((character) => character.name === name))),
  };
}
function addContinuityWarnings(entries, add) {
  const labels = { time: "時間", place: "室內／室外", weather: "天氣", temperature: "燈光色溫" };
  for (let index = 1; index < entries.length; index += 1) {
    const previous = continuityProfile(entries[index - 1].draft);
    const current = continuityProfile(entries[index].draft);
    for (const [field, label] of Object.entries(labels)) {
      if (previous[field] && current[field] && previous[field] !== current[field]) {
        add("warning", `分鏡 ${index} 到分鏡 ${index + 1} 的${label}由「${previous[field]}」變為「${current[field]}」，請確認是否為預期轉換。`, entries[index]);
      }
    }
  }
}
function inspectStoryboardProject() {
  const entries = orderedStoryboardEntries();
  const issues = [];
  const add = (severity, message, entry = null) => issues.push({ severity, message, storyboardId: entry?.draft.id || "", index: entry ? entry.index : -1 });
  if (!entries.length) add("error", "尚未加入任何分鏡，請先建立至少一張分鏡卡片。");
  let previousEnd = null;
  for (const entry of entries) {
    const { draft, index } = entry;
    const start = Number(draft.start), end = Number(draft.end);
    const label = `分鏡 ${index + 1}`;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) add("error", `${label} 的開始或結束時間無效。`, entry);
    if (previousEnd !== null && start < previousEnd) add("error", `${label} 與上一張分鏡重疊 ${(previousEnd - start).toFixed(1)} 秒。`, entry);
    else if (previousEnd !== null && start > previousEnd) add("warning", `${label} 與上一張分鏡之間有 ${(start - previousEnd).toFixed(1)} 秒空檔。`, entry);
    previousEnd = Number.isFinite(end) ? end : previousEnd;
    if (!draft.scene) add("warning", `${label} 尚未設定場景。`, entry);
    if (!draft.camera && !draft.cameraCustom) add("warning", `${label} 尚未設定鏡頭運動。`, entry);
    for (const name of storyboardCharacterNames(draft)) if (!enabledCharacters().some((character) => character.name === name)) add("warning", `${label} 使用的人物「${name}」目前不存在或已禁用。`, entry);
  }
  addContinuityWarnings(entries, add);
  const maxEnd = entries.reduce((value, entry) => Math.max(value, Number(entry.draft.end) || 0), 0);
  if (entries.length && Number(entries[0].draft.start) > 0) add("warning", `第一張分鏡從 ${Number(entries[0].draft.start).toFixed(1)} 秒開始，片頭會有空檔。`, entries[0]);
  return { entries, totalEntries: entries.length, issues, errors: issues.filter((i) => i.severity === "error").length, warnings: issues.filter((i) => i.severity === "warning").length, maxEnd };
}
function inspectionSummaryItem(label, value) {
  const item = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = String(value);
  item.append(document.createTextNode(label), strong);
  return item;
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
  list.replaceChildren(...values.map((value) => reportText("li", "", value)));
  section.append(reportText("h3", "", title), list);
  return section;
}
function renderStoryboardAiReport(report) {
  const container = $("storyboard-ai-report");
  const statusLabels = { pass: "可直接使用", needs_revision: "建議修改", fail: "需要重整" };
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
      item.append(
        reportText("strong", "", `Scene ${problem.scene} · ${problem.severity || "提醒"}`),
        reportText("p", "", problem.message || ""),
        reportText("small", "", problem.suggestion ? `建議：${problem.suggestion}` : ""),
      );
      section.append(item);
    }
    nodes.push(section);
  }
  const advice = storyboardAiList("生成建議", Array.isArray(report.generation_advice) ? report.generation_advice : []);
  if (advice) nodes.push(advice);
  container.replaceChildren(...nodes);
  container.hidden = false;
  lastStoryboardAiReport = report;
}
function renderStoryboardInspection(report) {
  $("analyze-storyboards-ai").disabled = busy || !report.totalEntries;
  $("storyboard-inspection-summary").replaceChildren(
    inspectionSummaryItem("分鏡", report.totalEntries),
    inspectionSummaryItem("總長", `${report.maxEnd.toFixed(1)} 秒`),
    inspectionSummaryItem("錯誤／提醒", `${report.errors}／${report.warnings}`),
  );
  const result = $("storyboard-inspection-result");
  if (!report.issues.length) {
    result.replaceChildren(reportText("p", "storyboard-inspection-empty", "分鏡時間與人物引用皆通過檢查。"));
    return;
  }
  const list = document.createElement("ul");
  list.replaceChildren(...report.issues.map((issue) => {
    const item = document.createElement(issue.storyboardId ? "button" : "div");
    if (item instanceof HTMLButtonElement) item.type = "button";
    item.className = "storyboard-inspection-item";
    item.dataset.severity = issue.severity;
    item.append(reportText("strong", "", issue.severity === "error" ? "錯誤" : "提醒"), reportText("span", "", issue.message));
    if (issue.storyboardId) item.addEventListener("click", () => { $("storyboard-inspection-dialog").close(); editStoryboard(issue.storyboardId); });
    return item;
  }));
  result.replaceChildren(list);
}
function openStoryboardInspection() {
  renderStoryboardInspection(inspectStoryboardProject());
  $("storyboard-inspection-dialog").showModal();
  $("close-storyboard-inspection").focus();
}
function storyboardAiScene(draft, id) {
  const fields = storyboardFields(draft);
  const values = Object.fromEntries(fields.map(([label, value]) => [label, value]));
  const duration = Number(draft.end) - Number(draft.start);
  const description = fields.filter(([label]) => !["時間", "場景", "鏡頭", "人物與對話"].includes(label)).map(([label, value]) => `${label}：${value}`).join("\n") || values.場景 || "未提供分鏡內容";
  return {
    id,
    ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
    ...(draft.shotSize ? { shot: draft.shotSize } : {}),
    ...(values.鏡頭 ? { camera: values.鏡頭 } : {}),
    description,
    ...(values["人物與對話"] ? { dialogue: values["人物與對話"] } : {}),
    ...(values.場景 ? { location: values.場景 } : {}),
    ...(storyboardCharacterNames(draft).length ? { characters: storyboardCharacterNames(draft) } : {}),
  };
}
function storyboardAiRequest() {
  const entries = orderedStoryboardEntries();
  const scenes = entries.map((entry, index) => storyboardAiScene(entry.draft, index + 1));
  const story = filmStyleText();
  return { ...(story ? { story } : {}), scenes };
}
function parseStoryboardAiResult(payload) {
  if (!payload?.success) throw new Error(payload?.error || "AI 分析服務未回傳結果。");
  let result = payload.result?.response ?? payload.result;
  if (Array.isArray(result?.choices)) result = result.choices[0]?.message?.content;
  if (typeof result === "string") {
    const source = result.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { result = JSON.parse(source); } catch { throw new Error("AI 分析報告未完整產生，請重新分析。"); }
  }
  const hasReportFields = result && typeof result === "object" && Number.isFinite(Number(result.overall_score)) && ["pass", "needs_revision", "fail"].includes(result.status) && typeof result.summary === "string" && Array.isArray(result.strengths) && Array.isArray(result.problems) && Array.isArray(result.generation_advice);
  if (!hasReportFields) throw new Error("AI 分析結果缺少必要的報告欄位，請重新分析。");
  return result;
}
async function storyboardCheckerRequest(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...clientIdentityHeaders() }, body: JSON.stringify(body), cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const failure = new Error(payload?.error || `AI 分析服務回應錯誤（${response.status}）。`);
    failure.status = response.status;
    throw failure;
  }
  return payload;
}
async function waitForStoryboardAiReport(input) {
  try {
    return parseStoryboardAiResult(await storyboardCheckerRequest(STORYBOARD_PRIMARY_URL, input));
  } catch (primaryError) {
    if (primaryError?.status === 429) throw primaryError;
    console.warn("分鏡 AI 分析主要引擎失敗，改用備援：", primaryError);
    return parseStoryboardAiResult(await storyboardCheckerRequest(STORYBOARD_FALLBACK_URL, input));
  }
}
async function analyzeStoryboardsWithAi() {
  const input = storyboardAiRequest();
  if (!input.scenes.length || busy) return;
  const inspectionDialog = $("storyboard-inspection-dialog");
  const reopenInspection = inspectionDialog.open;
  if (reopenInspection) inspectionDialog.close();
  setBusy(true);
  $("video-generation-lock-title").textContent = "AI 正在分析分鏡";
  $("video-generation-lock-detail").textContent = `正在檢查 ${input.scenes.length} 個 Scene 的故事、運鏡與連續性…`;
  try {
    renderStoryboardAiReport(await waitForStoryboardAiReport(input));
  } catch (analysisError) {
    lastStoryboardAiReport = null;
    const container = $("storyboard-ai-report");
    container.replaceChildren(reportText("p", "storyboard-ai-error", analysisError?.message || "AI 分析失敗，請稍後再試。"));
    container.hidden = false;
    status("AI 分鏡分析失敗", "error");
  } finally {
    setBusy(false);
    if (reopenInspection) inspectionDialog.showModal();
  }
}
function openStoryboardAiConfirmation() {
  if (busy || $("analyze-storyboards-ai").disabled) return;
  $("storyboard-ai-confirm-dialog").showModal();
}
function confirmStoryboardAiAnalysis(event) {
  event.preventDefault();
  $("storyboard-ai-confirm-dialog").close();
  void analyzeStoryboardsWithAi();
}

// ---- 專案匯出入（JSON 格式；比照影片生成器可選擇是否一併包含人物模板）----
async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
async function dataUrlToFile(dataUrl, name) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type });
}
function openVideoProjectExport() {
  if (busy || !storyboards.size) return;
  $("export-character-count").textContent = `目前有 ${enabledCharacters().length} 位啟用中的人物`;
  $("export-video-project-dialog").showModal();
}
async function exportVideoProject(event) {
  event.preventDefault();
  const includeCharacters = $("export-active-characters").checked;
  const entries = orderedStoryboardEntries();
  const project = {
    version: 1,
    filmStyle,
    storyboards: entries.map((entry) => entry.draft),
    ...(includeCharacters ? { characters: await Promise.all(enabledCharacters().map(async (character) => ({ ...character, referenceImage: character.referenceImage ? await fileToDataUrl(character.referenceImage) : null }))) } : {}),
  };
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "mv-animation-project.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("export-video-project-dialog").close();
  status("已匯出設定", "success");
}
let pendingVideoProject = null;
async function selectVideoProject(event) {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (!file) return;
  try {
    const project = JSON.parse(await file.text());
    if (!Array.isArray(project.storyboards)) throw new Error("設定檔缺少分鏡資料。");
    pendingVideoProject = project;
    $("import-video-project-name").textContent = file.name;
    $("import-video-project-summary").replaceChildren(
      inspectionSummaryItem("分鏡數量", project.storyboards.length),
      inspectionSummaryItem("人物數量", project.characters?.length || 0),
    );
    $("import-project-characters").checked = false;
    $("import-project-characters").disabled = !project.characters?.length;
    $("import-character-count").textContent = project.characters?.length ? `設定檔內含 ${project.characters.length} 位人物` : "設定檔未包含人物";
    $("import-video-project-error").hidden = true;
    $("import-video-project-dialog").showModal();
  } catch (importError) {
    error(importError.message || "無法讀取這份設定檔。");
  }
}
async function importVideoProject(event) {
  event.preventDefault();
  if (!pendingVideoProject) return;
  try {
    const project = pendingVideoProject;
    filmStyle = { ...EMPTY_FILM_STYLE, ...(project.filmStyle || {}) };
    const configured = Boolean(filmStyleText());
    $("open-film-style").classList.toggle("configured", configured);
    $("open-film-style").textContent = configured ? "全片風格（已設定）" : "全片風格";
    storyboards.clear();
    for (const draft of project.storyboards) storyboards.set(draft.id, draft);
    $("video-prompt").replaceChildren(...[...storyboards.values()].map(createStoryboardBlock));
    refreshStoryboardLabels();
    if ($("import-project-characters").checked && Array.isArray(project.characters)) {
      characterTemplates = await Promise.all(project.characters.map(async (character) => {
        const referenceImage = character.referenceImage ? await dataUrlToFile(character.referenceImage, `${character.name || "character"}.png`) : null;
        return { ...character, referenceImage, referenceBitmap: referenceImage ? await createImageBitmap(referenceImage) : null };
      }));
      await persistCharacterTemplates();
      renderCharacterTemplates();
    }
    $("import-video-project-dialog").close();
    status("已匯入設定", "success");
  } catch (importError) {
    $("import-video-project-error").textContent = importError.message || "匯入設定失敗。";
    $("import-video-project-error").hidden = false;
  }
}
function clearVideoWorkspace() {
  if (busy || !storyboards.size || !window.confirm("確定清除目前所有分鏡與全片風格？")) return;
  storyboards.clear();
  $("video-prompt").replaceChildren();
  filmStyle = { ...EMPTY_FILM_STYLE };
  $("open-film-style").classList.remove("configured");
  $("open-film-style").textContent = "全片風格";
  refreshStoryboardLabels();
  status("已清除目前分鏡", "success");
}

// ---- AI 2.5D 場景生成（每個分鏡各自呼叫一次，失敗時退回本機關鍵字模板）----
function mvSceneRequestFor(draft) {
  const fields = storyboardFields(draft).filter(([label]) => label !== "時間" && label !== "鏡頭" && label !== "人物與對話");
  const dialogue = draft.dialogues?.length ? [["人物與對話", dialoguePromptField(draft.dialogues)]] : [];
  const description = [...fields, ...dialogue].map(([label, value]) => `${label}：${value}`).join("\n") || draft.scene || "";
  const characterContext = characterContextText(draft);
  const style = filmStyleText();
  return {
    description: [description, characterContext, style].filter(Boolean).join("\n\n").slice(0, 500) || "一段安靜的場景",
    camera: (draft.camera === "custom" ? draft.cameraCustom : draft.camera) || undefined,
    shot: draft.shotSize || undefined,
    mood: (filmStyle.primary === "custom" ? filmStyle.primaryCustom : filmStyle.primary) || undefined,
    duration: Math.max(0.1, Math.min(60, Number(draft.end) - Number(draft.start) || 4)),
  };
}
function primaryReferenceImage(draft) {
  for (const name of storyboardCharacterNames(draft)) {
    const character = characterByName(name);
    if (character?.referenceBitmap) return character.referenceBitmap;
  }
  return null;
}
async function ensureCardScene(draft, onProgress) {
  const request = mvSceneRequestFor(draft);
  const hash = JSON.stringify(request);
  if (draft.spec && draft.specHash === hash) return;
  draft.specHash = hash;
  try {
    onProgress?.("正在生成…");
    const response = await fetch(MV_SCENE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const retryAfter = body?.retryAfter;
      throw new Error(retryAfter ? `AI 生成過於頻繁，請在 ${retryAfter} 秒後再試，暫時使用本機備援場景。` : (body?.error || "AI 場景生成暫時無法使用，改用本機備援場景。"));
    }
    const spec = typeof body?.result === "string" ? JSON.parse(body.result) : body?.result;
    if (!isValidSceneSpec(spec)) throw new Error("AI 回傳的畫面規格格式異常，改用本機備援場景。");
    draft.spec = spec;
    draft.specSource = "ai";
    draft.specNote = spec.mood ? `AI 已生成畫面（${spec.mood}）` : "AI 已生成畫面";
  } catch (generateError) {
    draft.spec = fallbackSceneSpec(request.description);
    draft.specSource = "fallback";
    draft.specNote = generateError.message || "AI 場景生成失敗，已改用本機備援場景。";
  }
  redrawStoryboard(draft.id);
}
async function ensureAllScenes() {
  const entries = orderedStoryboardEntries();
  let index = 0;
  for (const { draft } of entries) {
    index += 1;
    $("video-generation-lock-title").textContent = "正在生成 2.5D 畫面";
    $("video-generation-lock-detail").textContent = `分鏡 ${index}／${entries.length}`;
    await ensureCardScene(draft);
  }
}

// ---- 匯出（虛擬時鐘＋靜音音軌，encodeMedia 需要 AudioBuffer 才能編碼，維持共用管線不變）----
function silentAudioBuffer(duration) {
  const sampleRate = 44100;
  return new AudioBuffer({ length: Math.max(1, Math.ceil(duration * sampleRate)), numberOfChannels: 2, sampleRate });
}
async function generateVideo() {
  if (busy || !storyboards.size) return;
  error();
  const duration = totalDuration();
  if (duration < MIN_SEGMENT) {
    error("分鏡總長度過短，請先建立至少一個分鏡。");
    return;
  }
  controller = new AbortController();
  setBusy(true);
  $("video-generation-lock-title").textContent = "正在準備生成";
  $("video-generation-lock-detail").textContent = "";
  status("正在生成 MV…");
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    await ensureAllScenes();
    $("video-generation-lock-title").textContent = "正在編碼影片";
    $("video-generation-lock-detail").textContent = "";
    const format = $("mv-format").value;
    const resolution = $("mv-resolution").value;
    const fps = $("mv-fps").value;
    settings.storyboard = [...storyboards.values()].map((draft) => ({ start: Number(draft.start), end: Number(draft.end), description: draft.scene, spec: draft.spec, resolvedImage: primaryReferenceImage(draft) }));
    const blob = await encodeMedia({
      format,
      buffer: silentAudioBuffer(duration),
      image: null,
      backgroundFile: null,
      settings,
      resolution,
      aspectRatio: $("mv-aspect-ratio").value,
      fps,
      signal: controller.signal,
      drawFrame: drawMvScene,
      onEncodingMode: (mode) => {
        $("mv-export-note").textContent = mode === "prefer-hardware" ? "硬體編碼優先（由瀏覽器決定實際加速方式）" : mode === "prefer-software" ? "使用軟體編碼" : "使用瀏覽器自動選擇的編碼方式";
      },
      onProgress: (value) => {
        $("video-generation-lock-detail").textContent = `編碼進度 ${value}%`;
      },
    });
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = exportFilename("mv-animation", format, resolution, fps);
    document.body.append(link);
    link.click();
    link.remove();
    status("MV 已完成，下載已開始。", "success");
  } catch (exportError) {
    status("生成失敗", "error");
    error(exportError.message || "生成失敗，請降低解析度再試。");
  } finally {
    controller = null;
    setBusy(false);
  }
}

// ---- 事件綁定 ----
$("open-film-style").addEventListener("click", openFilmStyle);
$("film-style-primary").addEventListener("change", () => syncFilmStyleCustom(true));
$("film-style-narrator-voice").addEventListener("change", () => syncNarratorVoiceCustom(true));
$("apply-film-style").addEventListener("click", applyFilmStyle);
$("cancel-film-style").addEventListener("click", () => $("film-style-dialog").close());

$("open-character-template").addEventListener("click", openCharacterTemplate);
$("add-character").addEventListener("click", () => openCharacterEditor());
$("close-character-template").addEventListener("click", () => $("character-template-dialog").close());
$("character-reference").addEventListener("change", (event) => showCharacterEditorReference(event.currentTarget.files?.[0] || null));
$("character-name").addEventListener("input", (event) => event.currentTarget.setCustomValidity(""));
$("character-voice").addEventListener("change", () => syncCharacterVoiceCustom(true));
$("character-editor-form").addEventListener("submit", (event) => void submitCharacterEditor(event));
$("cancel-character-editor").addEventListener("click", () => $("character-editor-dialog").close());
$("delete-character").addEventListener("click", () => void deleteEditingCharacter());

$("open-video-prompt-builder").addEventListener("click", openVideoPromptBuilder);
$("video-prompt-camera").addEventListener("change", () => syncCameraControls(true));
$("video-prompt-view-angle").addEventListener("change", () => syncViewControls(true));
$("video-prompt-view-subjects").addEventListener("change", (event) => { if (event.target.matches("input")) renderStoryboardCharacterControls(); });
$("video-prompt-action-category").addEventListener("change", () => syncActionControls());
$("video-prompt-action-type").addEventListener("change", (event) => syncActionControls(event.currentTarget.value, true));
$("video-prompt-lighting").addEventListener("change", () => syncLightingControls(true));
$("add-video-dialogue").addEventListener("click", () => { $("video-dialogue-list").append(createDialogueRow()); syncDialogueEmptyState(); });
for (const input of [$("video-prompt-start"), $("video-prompt-end")]) input.addEventListener("input", (event) => event.currentTarget.setCustomValidity(""));
$("video-prompt-builder-form").addEventListener("submit", submitVideoPromptBuilder);
$("cancel-video-prompt-builder").addEventListener("click", () => $("video-prompt-builder-dialog").close());

$("inspect-storyboards").addEventListener("click", () => openStoryboardInspection());
$("analyze-storyboards-ai").addEventListener("click", openStoryboardAiConfirmation);
$("storyboard-ai-confirm-form").addEventListener("submit", confirmStoryboardAiAnalysis);
$("cancel-storyboard-ai").addEventListener("click", () => $("storyboard-ai-confirm-dialog").close());
$("reflow-storyboard-times").addEventListener("click", reflowStoryboardTimes);
$("close-storyboard-inspection").addEventListener("click", () => $("storyboard-inspection-dialog").close());

$("export-video-project").addEventListener("click", openVideoProjectExport);
$("export-video-project-form").addEventListener("submit", (event) => void exportVideoProject(event));
$("cancel-export-video-project").addEventListener("click", () => $("export-video-project-dialog").close());
$("select-video-project").addEventListener("click", () => $("video-project-input").click());
$("video-project-input").addEventListener("change", (event) => void selectVideoProject(event));
$("import-video-project-form").addEventListener("submit", (event) => void importVideoProject(event));
$("cancel-import-video-project").addEventListener("click", () => $("import-video-project-dialog").close());
$("import-video-project-dialog").addEventListener("close", () => { pendingVideoProject = null; });
$("clear-video-resources").addEventListener("click", clearVideoWorkspace);

$("mv-play").addEventListener("click", () => {
  const duration = totalDuration();
  if (duration <= 0) return;
  if (!playing) {
    if (previewTime >= duration) previewTime = 0;
    playing = true;
    lastTick = performance.now();
    $("mv-play").textContent = "❚❚";
    $("mv-play").setAttribute("aria-label", "暫停");
    rafId = requestAnimationFrame(tick);
  } else {
    playing = false;
    cancelAnimationFrame(rafId);
    $("mv-play").textContent = "▶";
    $("mv-play").setAttribute("aria-label", "播放");
  }
});
$("mv-seek").addEventListener("input", () => {
  const duration = totalDuration();
  previewTime = (Number($("mv-seek").value) / 1000) * duration;
  renderFrame();
});
$("mv-darkness").addEventListener("input", () => {
  settings.darkness = Number($("mv-darkness").value);
  $("mv-darkness-output").textContent = String(settings.darkness);
  renderFrame();
});
$("mv-aspect-ratio").addEventListener("change", () => {
  const portrait = $("mv-aspect-ratio").value === "9:16";
  $("mv-canvas-wrap").classList.toggle("portrait", portrait);
  canvas.width = portrait ? 720 : 1280;
  canvas.height = portrait ? 1280 : 720;
  renderFrame();
});

const previewFrame = $("mv-canvas-wrap");
const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
function syncPreviewFullscreen() {
  const active = fullscreenElement() === previewFrame;
  previewFrame.classList.toggle("is-fullscreen", active);
  previewFrame.setAttribute("aria-label", active ? "恢復即時預覽原尺寸" : "放大即時預覽至全螢幕");
  previewFrame.querySelector(".fullscreen-hint").textContent = active ? "↙ 點擊恢復" : "⛶ 點擊全螢幕";
}
previewFrame.addEventListener("click", async () => {
  try {
    if (fullscreenElement() === previewFrame) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    } else if (previewFrame.requestFullscreen) await previewFrame.requestFullscreen();
    else if (previewFrame.webkitRequestFullscreen) await previewFrame.webkitRequestFullscreen();
  } catch {}
});
previewFrame.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); previewFrame.click(); }
});
document.addEventListener("fullscreenchange", syncPreviewFullscreen);
document.addEventListener("webkitfullscreenchange", syncPreviewFullscreen);

$("generate-video").addEventListener("click", () => void generateVideo());

window.addEventListener("beforeunload", (event) => {
  if (controller) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("unload", () => {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  characterPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
});

$("mv-darkness-output").textContent = String(settings.darkness);
renderStoryboardCharacterControls([], "", "");
renderDialogueRows();
syncViewControls();
syncActionControls();
syncLightingControls();
syncCameraControls();
syncGenerateAvailability();
renderFrame();
void restoreCharacterTemplates();
