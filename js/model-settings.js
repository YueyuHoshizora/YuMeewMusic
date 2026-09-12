import { applyTheme } from './themes.js';
import { loadSettings, saveSettings } from './settings.js';
import { deleteAllCachedModels, deleteCachedModel, listCachedModels } from './indexeddb-model-cache.js';
import { deleteApiKey, listApiKeys, maskApiKey } from './api-keys.js';
import { deleteAllStoredEntries, deleteStoredEntry, listStoredEntries } from './media-store.js';

const $ = id => document.getElementById(id);
const state = { models: [], apiKeys: [], cache: [], pending: null, pendingApiKey: null, pendingCache: null, busy: false, cacheBusy: false };
const settings = loadSettings();
applyTheme(settings.mode, settings.theme);
$('interface-mode').value = settings.mode;
$('interface-theme').value = settings.theme;

function selectSettingsPanel(panelId) {
  for (const button of document.querySelectorAll('[data-settings-panel]')) {
    const selected = button.dataset.settingsPanel === panelId;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  }
  for (const panel of document.querySelectorAll('.settings-panel')) panel.hidden = panel.id !== panelId;
}

function saveAppearance() {
  settings.mode = $('interface-mode').value;
  settings.theme = $('interface-theme').value;
  applyTheme(settings.mode, settings.theme);
  const saved = saveSettings(settings);
  $('interface-status').textContent = saved ? '介面設定已自動保存' : '介面已套用，但瀏覽器無法保存設定';
  $('interface-status').classList.toggle('error', !saved);
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let amount = value;
  let unit = -1;
  do { amount /= 1024; unit += 1; } while (amount >= 1024 && unit < units.length - 1);
  return `${amount.toFixed(amount >= 100 ? 0 : amount >= 10 ? 1 : 2)} ${units[unit]}`;
}

function setStatus(text, kind = '') {
  $('model-status').textContent = text;
  $('model-status').className = `model-status ${kind}`.trim();
}

function render() {
  const total = state.models.reduce((sum, model) => sum + model.size, 0);
  $('model-count').textContent = `${state.models.length} 個模型`;
  $('model-total-size').textContent = `共使用 ${formatBytes(total)} · ${state.models.reduce((sum, model) => sum + model.fileCount, 0)} 個快取檔案`;
  $('delete-all-models').disabled = state.busy || !state.models.length;
  $('model-empty').hidden = Boolean(state.models.length);
  $('model-list').replaceChildren(...state.models.map(model => {
    const row = document.createElement('article');
    row.className = 'model-row';
    const details = document.createElement('div');
    details.className = 'model-details';
    const name = document.createElement('strong');
    name.textContent = model.name;
    const source = document.createElement('span');
    source.textContent = model.source;
    details.append(name, source);
    const size = document.createElement('div');
    size.className = 'model-size';
    const amount = document.createElement('strong');
    amount.textContent = formatBytes(model.size);
    const files = document.createElement('span');
    files.textContent = `${model.fileCount} 個檔案`;
    size.append(amount, files);
    const button = document.createElement('button');
    button.className = 'model-delete';
    button.type = 'button';
    button.textContent = '刪除';
    button.disabled = state.busy;
    button.addEventListener('click', () => requestDelete(model));
    row.append(details, size, button);
    return row;
  }));
}

function refreshApiKeys(message = '') {
  state.apiKeys = listApiKeys();
  $('api-key-empty').hidden = Boolean(state.apiKeys.length);
  $('api-key-list').replaceChildren(...state.apiKeys.map(key => {
    const row = document.createElement('article');
    row.className = 'api-key-row';
    const details = document.createElement('div');
    details.className = 'api-key-details';
    const name = document.createElement('strong');
    name.textContent = key.label;
    const id = document.createElement('span');
    id.textContent = key.id;
    details.append(name, id);
    const masked = document.createElement('code');
    masked.className = 'api-key-masked';
    masked.textContent = maskApiKey(key.value);
    const button = document.createElement('button');
    button.className = 'model-delete';
    button.type = 'button';
    button.textContent = '刪除';
    button.addEventListener('click', () => requestDeleteApiKey(key));
    row.append(details, masked, button);
    return row;
  }));
  $('api-key-status').textContent = message || (state.apiKeys.length ? `共 ${state.apiKeys.length} 組金鑰` : '目前沒有已保存的金鑰');
}

function requestDeleteApiKey(key) {
  state.pendingApiKey = key;
  $('delete-api-key-title').textContent = `刪除「${key.label}」API KEY？`;
  $('delete-api-key-dialog').returnValue = '';
  $('delete-api-key-dialog').showModal();
}

function renderCache() {
  const total = state.cache.reduce((sum, entry) => sum + entry.size, 0);
  $('cache-count').textContent = `${state.cache.length} 個項目`;
  $('cache-total-size').textContent = `共使用 ${formatBytes(total)}`;
  $('delete-all-cache').disabled = state.cacheBusy || !state.cache.length;
  $('cache-empty').hidden = Boolean(state.cache.length);
  $('cache-list').replaceChildren(...state.cache.map(entry => {
    const row = document.createElement('article');
    row.className = 'model-row cache-row';
    const details = document.createElement('div');
    details.className = 'model-details';
    const field = document.createElement('strong');
    field.textContent = entry.field;
    const source = document.createElement('span');
    source.textContent = `${entry.page} · ${entry.name}`;
    details.append(field, source);
    const size = document.createElement('div');
    size.className = 'model-size';
    const amount = document.createElement('strong');
    amount.textContent = formatBytes(entry.size);
    const type = document.createElement('span');
    type.textContent = entry.type || '媒體資料';
    size.append(amount, type);
    const button = document.createElement('button');
    button.className = 'model-delete';
    button.type = 'button';
    button.textContent = '刪除';
    button.disabled = state.cacheBusy;
    button.addEventListener('click', () => requestDeleteCache(entry));
    row.append(details, size, button);
    return row;
  }));
}

async function refreshCache(successMessage = '') {
  state.cacheBusy = true;
  renderCache();
  $('cache-error').hidden = true;
  $('cache-status').textContent = '正在讀取 IndexedDB 媒體…';
  $('cache-status').className = 'model-status';
  try {
    state.cache = await listStoredEntries();
    $('cache-status').textContent = successMessage || (state.cache.length ? '媒體快取清單已更新' : '目前沒有媒體快取');
    $('cache-status').className = 'model-status success';
  } catch (error) {
    state.cache = [];
    $('cache-error').textContent = error?.message || '無法讀取媒體快取。';
    $('cache-error').hidden = false;
    $('cache-status').textContent = '媒體快取讀取失敗';
    $('cache-status').className = 'model-status error';
  } finally {
    state.cacheBusy = false;
    renderCache();
  }
}

function requestDeleteCache(entry = null) {
  if (state.cacheBusy || (!entry && !state.cache.length)) return;
  state.pendingCache = entry;
  $('delete-cache-dialog').returnValue = '';
  $('delete-cache-title').textContent = entry ? `刪除「${entry.field}」？` : '刪除全部媒體快取？';
  $('delete-cache-message').textContent = entry
    ? `將刪除 ${entry.page} 的「${entry.name}」，相關頁面將無法自動恢復這份媒體。是否刪除？`
    : '將刪除所有頁面保存在 IndexedDB 的媒體與專案資料，是否刪除全部？';
  $('delete-cache-dialog').showModal();
}

async function confirmDeleteCache() {
  if (state.cacheBusy) return;
  const target = state.pendingCache;
  state.pendingCache = null;
  state.cacheBusy = true;
  renderCache();
  $('cache-status').textContent = target ? `正在刪除 ${target.field}…` : '正在刪除全部媒體快取…';
  try {
    if (target) await deleteStoredEntry(target.key);
    else await deleteAllStoredEntries();
    await refreshCache(target ? `已刪除 ${target.field}` : '已刪除全部媒體快取');
  } catch (error) {
    state.cacheBusy = false;
    renderCache();
    $('cache-error').textContent = error?.message || '媒體快取刪除失敗。';
    $('cache-error').hidden = false;
    $('cache-status').textContent = '媒體快取刪除失敗';
    $('cache-status').className = 'model-status error';
  }
}

async function refreshModels(successMessage = '') {
  state.busy = true;
  render();
  $('model-error').hidden = true;
  setStatus('正在讀取 IndexedDB 模型…');
  try {
    state.models = await listCachedModels();
    setStatus(successMessage || (state.models.length ? '模型清單已更新' : '目前沒有已下載的模型'), 'success');
  } catch (error) {
    state.models = [];
    $('model-error').textContent = error?.message || '無法讀取模型清單。';
    $('model-error').hidden = false;
    setStatus('模型清單讀取失敗', 'error');
  } finally {
    state.busy = false;
    render();
  }
}

function requestDelete(model = null) {
  if (state.busy || (!model && !state.models.length)) return;
  state.pending = model;
  $('delete-model-dialog').returnValue = '';
  $('delete-model-title').textContent = model ? `刪除「${model.name}」？` : '刪除全部模型？';
  $('delete-model-message').textContent = model
    ? '下次使用將重新下載，是否刪除？'
    : '下次使用相關功能時將重新下載模型，是否刪除全部？';
  $('delete-model-dialog').showModal();
}

async function confirmDelete() {
  if (state.busy) return;
  const target = state.pending;
  state.pending = null;
  state.busy = true;
  render();
  setStatus(target ? `正在刪除 ${target.name}…` : '正在刪除全部模型…');
  try {
    if (target) await deleteCachedModel(target.keys);
    else await deleteAllCachedModels();
    await refreshModels(target ? `已刪除 ${target.name}` : '已刪除全部模型');
  } catch (error) {
    state.busy = false;
    render();
    $('model-error').textContent = error?.message || '模型刪除失敗。';
    $('model-error').hidden = false;
    setStatus('模型刪除失敗', 'error');
  }
}

$('delete-all-models').addEventListener('click', () => requestDelete());
$('delete-all-cache').addEventListener('click', () => requestDeleteCache());
$('interface-mode').addEventListener('change', saveAppearance);
$('interface-theme').addEventListener('change', saveAppearance);
for (const button of document.querySelectorAll('[data-settings-panel]')) {
  button.addEventListener('click', () => selectSettingsPanel(button.dataset.settingsPanel));
}
$('delete-model-dialog').addEventListener('close', () => {
  if ($('delete-model-dialog').returnValue === 'confirm') void confirmDelete();
  else state.pending = null;
});
$('delete-api-key-dialog').addEventListener('close', () => {
  const key = state.pendingApiKey;
  state.pendingApiKey = null;
  if ($('delete-api-key-dialog').returnValue !== 'confirm' || !key) return;
  const deleted = deleteApiKey(key.id);
  refreshApiKeys(deleted ? `已刪除 ${key.label} 的 API KEY` : '瀏覽器無法刪除 API KEY');
  $('api-key-status').classList.toggle('error', !deleted);
});
$('delete-cache-dialog').addEventListener('close', () => {
  if ($('delete-cache-dialog').returnValue === 'confirm') void confirmDeleteCache();
  else state.pendingCache = null;
});

void refreshModels();
void refreshCache();
refreshApiKeys();
