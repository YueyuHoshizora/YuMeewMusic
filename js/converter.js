import { applyTheme } from './themes.js';
import { loadSettings } from './settings.js';
import { FORMATS } from './formats.js';
import {
  CONVERTER_FORMAT_LABELS,
  convertMediaFile,
  converterFilename,
  converterFormats,
  inspectMediaFile,
} from './converter-core.js';

const $ = id => document.getElementById(id);
const MAX_FILE_SIZE = 1024 * 1024 * 1024;
const restored = loadSettings();
applyTheme(restored.mode, restored.theme);

let sourceFile = null;
let sourceInfo = null;
let controller = null;
let downloadUrl = '';

function formatBytes(bytes) {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

function status(text, mode = '') {
  $('converter-status').textContent = text;
  $('converter-status').className = `converter-status ${mode}`.trim();
}

function error(text = '') {
  $('converter-error').textContent = text;
  $('converter-error').hidden = !text;
  $('converter-drop').classList.toggle('invalid', Boolean(text));
  if (text) status(text, 'error');
}

function updateFormatDescription() {
  const type = FORMATS[$('converter-format').value];
  $('converter-format-description').textContent = type
    ? type.description + (type.video ? ' · 保留主要影片軌' : ' · 僅輸出主要音軌')
    : '辨識檔案後會顯示可用格式。';
}

function populateFormats() {
  const formats = converterFormats(sourceInfo.kind, Boolean(sourceInfo.audio));
  $('converter-format').replaceChildren(...formats.map(format => {
    const option = document.createElement('option');
    option.value = format;
    option.textContent = CONVERTER_FORMAT_LABELS[format];
    return option;
  }));
  $('converter-format').disabled = false;
  $('converter-start').disabled = false;
  updateFormatDescription();
}

function describeTracks(info) {
  const parts = [];
  if (info.video) parts.push(`${info.video.codec.toUpperCase()} · ${info.video.width}×${info.video.height}`);
  if (info.audio) parts.push(`${info.audio.codec.toUpperCase()} · ${info.audio.channels} 聲道 · ${Math.round(info.audio.sampleRate / 1000)} kHz`);
  return parts.join(' ＋ ');
}

async function loadFile(file) {
  if (!file) return;
  if (controller) return;
  sourceFile = null;
  sourceInfo = null;
  $('converter-format').disabled = true;
  $('converter-start').disabled = true;
  $('converter-file-info').hidden = true;
  error();
  if (file.size > MAX_FILE_SIZE) {
    error('檔案超過 1 GB，為避免瀏覽器記憶體不足，請選擇較小的檔案。');
    return;
  }
  $('converter-file-name').textContent = file.name;
  $('converter-file-help').textContent = '正在辨識影片與音訊軌…';
  $('converter-drop').disabled = true;
  status('正在讀取檔案…');
  try {
    const info = await inspectMediaFile(file);
    sourceFile = file;
    sourceInfo = info;
    $('converter-kind').textContent = info.kind === 'video' ? '影片輸入' : '音樂輸入';
    $('converter-container').textContent = info.format;
    $('converter-tracks').textContent = describeTracks(info);
    $('converter-duration').textContent = formatTime(info.duration);
    $('converter-size').textContent = formatBytes(file.size);
    $('converter-file-info').hidden = false;
    $('converter-file-help').textContent = '點擊可更換檔案';
    populateFormats();
    status(`已辨識為${info.kind === 'video' ? '影片' : '音樂'}，請選擇輸出格式。`, 'success');
  } catch (cause) {
    $('converter-file-help').textContent = '拖放檔案或點擊重新選擇';
    error(cause.message || '無法讀取這個檔案，請確認格式是否受瀏覽器支援。');
  } finally {
    $('converter-drop').disabled = false;
  }
}

async function startConversion() {
  if (!sourceFile || !sourceInfo || controller) return;
  controller = new AbortController();
  const format = $('converter-format').value;
  $('converter-drop').disabled = true;
  $('converter-format').disabled = true;
  $('converter-start').disabled = true;
  $('converter-start').textContent = '正在轉換 0%';
  $('converter-progress').value = 0;
  $('converter-progress').hidden = false;
  $('converter-progress-text').textContent = '正在準備編碼器…';
  $('converter-progress-text').hidden = false;
  $('converter-cancel').hidden = false;
  error();
  status('正在轉換，請保持此頁面開啟。');
  try {
    const blob = await convertMediaFile({
      file: sourceFile,
      format,
      inputKind: sourceInfo.kind,
      hasAudio: Boolean(sourceInfo.audio),
      audioChannels: sourceInfo.audio?.channels || 2,
      signal: controller.signal,
      onProgress(value) {
        $('converter-progress').value = value;
        $('converter-progress-text').textContent = `轉換進度 ${value}%`;
        $('converter-start').textContent = `正在轉換 ${value}%`;
      },
    });
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = converterFilename(sourceFile.name, format);
    document.body.append(link);
    link.click();
    link.remove();
    $('converter-progress').value = 100;
    status(`${format.toUpperCase()} 轉換完成，下載已開始。`, 'success');
  } catch (cause) {
    const text = cause.message || '轉換失敗，這個來源編碼可能不受目前瀏覽器支援。';
    if (/取消/.test(text)) status('已取消轉換。');
    else error(text);
  } finally {
    controller = null;
    $('converter-drop').disabled = false;
    $('converter-format').disabled = false;
    $('converter-start').disabled = false;
    $('converter-start').textContent = '開始轉換';
    $('converter-cancel').hidden = true;
  }
}

$('converter-drop').addEventListener('click', () => {
  $('converter-input').value = '';
  $('converter-input').click();
});
$('converter-input').addEventListener('change', event => loadFile(event.target.files?.[0]));
for (const eventName of ['dragenter', 'dragover']) {
  $('converter-drop').addEventListener(eventName, event => {
    event.preventDefault();
    if (!controller) $('converter-drop').classList.add('dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  $('converter-drop').addEventListener(eventName, event => {
    event.preventDefault();
    $('converter-drop').classList.remove('dragging');
  });
}
$('converter-drop').addEventListener('drop', event => {
  if (!controller) void loadFile(event.dataTransfer.files?.[0]);
});
$('converter-format').addEventListener('change', updateFormatDescription);
$('converter-start').addEventListener('click', startConversion);
$('converter-cancel').addEventListener('click', () => controller?.abort());
window.addEventListener('beforeunload', event => {
  if (!controller) return;
  event.preventDefault();
  event.returnValue = '';
});
window.addEventListener('unload', () => {
  controller?.abort();
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
});
