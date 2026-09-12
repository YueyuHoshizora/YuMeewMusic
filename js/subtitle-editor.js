import { applyTheme } from './themes.js';
import { loadSettings } from './settings.js';
import { loadStoredMedia, saveStoredMedia, unpackStoredMedia } from './media-store.js';
import { formatSubtitleTime, generatedSubtitleFilename, parseSubtitleTime, parseSubtitles, serializeSubtitles } from './subtitles.js';
import { createUndoHistory } from './undo-history.js';
import { encodeMedia } from './export.js';
import { SEPARATOR_MAX_DURATION } from './vocal-separator-core.js';

const $ = id => document.getElementById(id);
const audio = $('editor-audio');
const state = { cues: [], selected: -1, duration: 60, subtitleName: 'edited-subtitles.srt', dirty: false, audioUrl: '', audioFile: null, waveformBuffer: null };
const editHistory = createUndoHistory(10);
const MAX_RECOGNITION_FILE_SIZE = 150 * 1024 * 1024;
const recognition = { busy: false, worker: null, controller: null, run: 0, vocalsUrl: '' };
let textHistoryCue = null;
const settings = loadSettings();
applyTheme(settings.mode, settings.theme);

function status(text, kind = '') {
  const target = $('editor-status');
  target.textContent = text;
  target.className = `editor-status ${kind}`.trim();
}

function editorTime(value) {
  return formatSubtitleTime(value, '.');
}

function normalizeCues(cues, duration) {
  return cues.map(cue => {
    const start = Math.max(0, Number(cue.start) || 0);
    const fallbackEnd = Math.min(duration || start + 3, start + 3);
    const end = Number.isFinite(cue.end) && cue.end > start ? cue.end : Math.max(start + .1, fallbackEnd);
    return { start, end, text: String(cue.text || '') };
  }).filter(cue => cue.text.trim()).sort((a, b) => a.start - b.start || a.end - b.end);
}

function currentCue() {
  return state.cues[state.selected] || null;
}

function editorSnapshot() {
  return { cues: state.cues.map(cue => ({ ...cue })), selected: state.selected };
}

function syncHistoryButtons() {
  $('undo-edit').disabled = !editHistory.canUndo;
  $('redo-edit').disabled = !editHistory.canRedo;
}

function recordHistory() {
  editHistory.checkpoint(editorSnapshot());
  syncHistoryButtons();
}

function restoreHistory(snapshot, action) {
  if (!snapshot) return;
  state.cues = snapshot.cues;
  state.selected = Math.max(-1, Math.min(snapshot.selected, state.cues.length - 1));
  state.dirty = true;
  textHistoryCue = null;
  status(`已${action}上一個操作`, 'success');
  render();
}

function undoEdit() {
  restoreHistory(editHistory.undo(editorSnapshot()), '復原');
}

function redoEdit() {
  restoreHistory(editHistory.redo(editorSnapshot()), '恢復');
}

function markDirty() {
  state.dirty = true;
  status('尚未儲存的修改', '');
}

function setRecognitionProgress(value, stage, text) {
  const progress = Math.max(0, Math.min(100, Math.round(value)));
  $('recognition-progress-area').hidden = false;
  $('recognition-progress').value = progress;
  $('recognition-percent').textContent = `${progress}%`;
  if (stage) $('recognition-stage').textContent = stage;
  if (text) $('recognition-status').textContent = text;
}

function setRecognitionBusy(value) {
  recognition.busy = value;
  $('recognize-subtitles').disabled = value || !state.audioFile || !state.waveformBuffer;
  $('recognition-language').disabled = value;
  $('return-to-main').disabled = value;
  for (const className of ['editor-player', 'editor-workspace', 'editor-actions']) {
    const element = document.querySelector(`.${className}`);
    if (element) element.inert = value;
  }
  document.querySelector('.subtitle-editor-main').classList.toggle('recognition-busy', value);
}

function releaseRecognition() {
  recognition.worker?.terminate();
  recognition.worker = null;
  recognition.controller = null;
}

function clearVocalsPreview() {
  const previewAudio = $('recognition-vocals-audio');
  previewAudio.pause();
  previewAudio.removeAttribute('src');
  previewAudio.load();
  $('recognition-vocals-preview').hidden = true;
  if (recognition.vocalsUrl) URL.revokeObjectURL(recognition.vocalsUrl);
  recognition.vocalsUrl = '';
}

function showVocalsPreview(mp3) {
  clearVocalsPreview();
  recognition.vocalsUrl = URL.createObjectURL(mp3);
  $('recognition-vocals-audio').src = recognition.vocalsUrl;
  $('recognition-vocals-preview').hidden = false;
}

function recognitionFailed(message, run) {
  if (run !== recognition.run) return;
  releaseRecognition();
  setRecognitionBusy(false);
  setRecognitionProgress($('recognition-progress').value, '辨識失敗', message);
  status(message, 'error');
}

function vocalsAudioBuffer(left, right) {
  const length = Math.min(left.length, right.length);
  const buffer = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: state.waveformBuffer.sampleRate });
  buffer.copyToChannel(left.subarray(0, length), 0);
  buffer.copyToChannel(right.subarray(0, length), 1);
  return buffer;
}

async function uploadVocals(mp3, run) {
  if (run !== recognition.run) return;
  setRecognitionProgress(72, '第三階段：辨識字幕', '正在上傳分離後的人聲 MP3 並等待辨識…');
  const form = new FormData();
  const baseName = state.audioFile.name.replace(/\.[^.]+$/, '') || 'audio';
  form.append('audio', mp3, `${baseName}-vocals.mp3`);
  form.append('language', $('recognition-language').value);
  const response = await fetch('https://lyrics-transcriber.yustellar.idv.tw', {
    method: 'POST',
    body: form,
    signal: recognition.controller.signal,
  });
  const text = await response.text();
  if (!response.ok) throw Error(text.trim().slice(0, 300) || `字幕辨識服務回應錯誤（HTTP ${response.status}）。`);
  const parsed = parseSubtitles(text, 'srt');
  if (!parsed.cues.length) throw Error('辨識服務沒有回傳有效的 SRT 字幕。');
  if (run !== recognition.run) return;
  recordHistory();
  state.cues = normalizeCues(parsed.cues, state.duration);
  state.selected = state.cues.length ? 0 : -1;
  state.subtitleName = generatedSubtitleFilename();
  state.dirty = true;
  textHistoryCue = null;
  $('editor-subtitle-name').textContent = `AI 辨識草稿 · ${state.cues.length} 句`;
  releaseRecognition();
  setRecognitionBusy(false);
  setRecognitionProgress(100, '辨識完成', `已載入 ${state.cues.length} 句 SRT 字幕，請檢查後保存。`);
  status(`AI 已載入 ${state.cues.length} 句字幕，尚未保存。`, 'success');
  render();
}

async function encodeAndUploadVocals(data, run) {
  try {
    if (run !== recognition.run) return;
    recognition.worker?.terminate();
    recognition.worker = null;
    if (!(data.vocalsLeft instanceof Float32Array) || !(data.vocalsRight instanceof Float32Array))
      throw Error('Spleeter 沒有產生可用的人聲軌道。');
    setRecognitionProgress(56, '第二階段：轉換 MP3', '正在瀏覽器內將人聲轉換為 MP3…');
    const mp3 = await encodeMedia({
      format: 'mp3',
      buffer: vocalsAudioBuffer(data.vocalsLeft, data.vocalsRight),
      settings: { exportVolume: 100, eqBass: 0, eqMid: 0, eqTreble: 0 },
      resolution: '1080',
      fps: '60',
      signal: recognition.controller.signal,
      onProgress: value => setRecognitionProgress(56 + value * .15, '第二階段：轉換 MP3', `正在編碼人聲 MP3 · ${value}%`),
    });
    if (run !== recognition.run) return;
    showVocalsPreview(mp3);
    await uploadVocals(mp3, run);
  } catch (error) {
    if (error?.name !== 'AbortError') recognitionFailed(error?.message || '字幕辨識失敗。', run);
  }
}

async function startSubtitleRecognition() {
  if (recognition.busy) return;
  if (!state.audioFile || !state.waveformBuffer) {
    status('請先在主畫面選擇可解析的音樂。', 'error');
    return;
  }
  if (state.audioFile.size > MAX_RECOGNITION_FILE_SIZE) {
    status('字幕辨識的音樂檔案上限為 150 MB。', 'error');
    return;
  }
  if (state.waveformBuffer.duration > SEPARATOR_MAX_DURATION + .01) {
    status('字幕辨識目前最多處理 8 分鐘，請先在主畫面裁剪音樂。', 'error');
    return;
  }
  const run = ++recognition.run;
  clearVocalsPreview();
  recognition.controller = new AbortController();
  setRecognitionBusy(true);
  audio.pause();
  setRecognitionProgress(1, '第一階段：分離人聲', '正在準備 Spleeter；原始音樂不會上傳。');
  try { await navigator.storage?.persist?.(); } catch {}
  try {
    const left = Float32Array.from(state.waveformBuffer.getChannelData(0));
    const right = Float32Array.from(state.waveformBuffer.numberOfChannels > 1
      ? state.waveformBuffer.getChannelData(1)
      : state.waveformBuffer.getChannelData(0));
    const worker = new Worker(new URL('./vocal-separator-worker.js', import.meta.url), { type: 'module' });
    recognition.worker = worker;
    worker.addEventListener('error', event => recognitionFailed(event.message || 'Spleeter 處理程序發生錯誤。', run));
    worker.addEventListener('message', event => {
      if (run !== recognition.run || worker !== recognition.worker) return;
      const data = event.data || {};
      if (data.type === 'status') {
        setRecognitionProgress($('recognition-progress').value, '第一階段：分離人聲', data.text);
      } else if (data.type === 'gpu-fallback') {
        setRecognitionProgress($('recognition-progress').value, '第一階段：改用 CPU', data.text);
      } else if (data.type === 'progress') {
        setRecognitionProgress(Math.max(2, data.value * .55), '第一階段：分離人聲', data.text);
      } else if (data.type === 'complete') {
        void encodeAndUploadVocals(data, run);
      } else if (data.type === 'error') {
        recognitionFailed(/fetch|network|load/i.test(data.text) ? '無法下載 Spleeter 模型，請檢查網路後再試。' : data.text, run);
      }
    });
    worker.postMessage({
      type: 'separate',
      mode: 'fast',
      model: 'spleeter',
      left: left.buffer,
      right: right.buffer,
    }, [left.buffer, right.buffer]);
  } catch (error) {
    recognitionFailed(error?.message || '無法開始字幕辨識。', run);
  }
}

function requestSubtitleRecognition() {
  if (recognition.busy) return;
  if (state.cues.length) {
    if (!$('replace-subtitles-dialog').open) $('replace-subtitles-dialog').showModal();
    return;
  }
  void startSubtitleRecognition();
}

function cancelSubtitleRecognition() {
  if (!recognition.busy) return;
  recognition.run += 1;
  recognition.worker?.terminate();
  recognition.controller?.abort();
  releaseRecognition();
  setRecognitionBusy(false);
  setRecognitionProgress(0, '已取消辨識', '處理已取消，原本的字幕沒有變更。');
  status('已取消 AI 字幕辨識。');
}

function selectCue(index, seek = false) {
  if (!state.cues.length) index = -1;
  state.selected = Math.max(-1, Math.min(state.cues.length - 1, index));
  textHistoryCue = null;
  if (seek && currentCue() && audio.src) audio.currentTime = currentCue().start;
  render();
}

function renderList() {
  const list = $('cue-list');
  list.replaceChildren();
  $('cue-count').textContent = `${state.cues.length} 句`;
  $('cue-empty').hidden = Boolean(state.cues.length);
  state.cues.forEach((cue, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'cue-list-item';
    item.dataset.index = String(index);
    item.innerHTML = `<span class="cue-number">${String(index + 1).padStart(2, '0')}</span><span class="cue-list-time"></span><span class="cue-list-text"></span>`;
    item.querySelector('.cue-list-time').textContent = editorTime(cue.start);
    item.querySelector('.cue-list-text').textContent = cue.text.replace(/\n/g, ' / ');
    item.classList.toggle('selected', index === state.selected);
    item.addEventListener('click', () => selectCue(index, true));
    list.append(item);
  });
}

function startBandDrag(event, index, mode) {
  event.preventDefault();
  event.stopPropagation();
  selectCue(index);
  const band = event.currentTarget.closest('.cue-band') || event.currentTarget;
  const cue = state.cues[index];
  const timelineWidth = $('timeline').getBoundingClientRect().width;
  if (!cue || timelineWidth <= 0) return;
  const drag = { pointerId: event.pointerId, x: event.clientX, start: cue.start, end: cue.end, mode, recorded: false };
  band.setPointerCapture(event.pointerId);
  const move = moveEvent => {
    if (moveEvent.pointerId !== drag.pointerId) return;
    if (!drag.recorded) { recordHistory(); drag.recorded = true; }
    const delta = (moveEvent.clientX - drag.x) / timelineWidth * state.duration;
    if (mode === 'start') cue.start = Math.max(0, Math.min(drag.end - .1, drag.start + delta));
    else if (mode === 'end') cue.end = Math.max(drag.start + .1, Math.min(state.duration, drag.end + delta));
    else {
      const length = drag.end - drag.start;
      cue.start = Math.max(0, Math.min(state.duration - length, drag.start + delta));
      cue.end = cue.start + length;
    }
    markDirty();
    renderTimeline();
    renderForm();
  };
  const finish = upEvent => {
    if (upEvent.pointerId !== drag.pointerId) return;
    band.removeEventListener('pointermove', move);
    band.removeEventListener('pointerup', finish);
    band.removeEventListener('pointercancel', finish);
    const selected = cue;
    state.cues.sort((a, b) => a.start - b.start || a.end - b.end);
    state.selected = state.cues.indexOf(selected);
    render();
  };
  band.addEventListener('pointermove', move);
  band.addEventListener('pointerup', finish);
  band.addEventListener('pointercancel', finish);
}

function renderTimeline() {
  const bands = $('cue-bands');
  bands.replaceChildren();
  state.cues.forEach((cue, index) => {
    const band = document.createElement('div');
    band.className = 'cue-band';
    band.classList.toggle('selected', index === state.selected);
    band.style.left = `${cue.start / state.duration * 100}%`;
    band.style.width = `${Math.max(.4, (cue.end - cue.start) / state.duration * 100)}%`;
    band.style.setProperty('--lane', String(index % 3));
    band.textContent = cue.text.replace(/\n/g, ' / ');
    const start = document.createElement('span'), end = document.createElement('span');
    start.className = 'cue-band-handle start';
    end.className = 'cue-band-handle end';
    start.addEventListener('pointerdown', event => startBandDrag(event, index, 'start'));
    end.addEventListener('pointerdown', event => startBandDrag(event, index, 'end'));
    band.addEventListener('pointerdown', event => {
      if (event.target !== band) return;
      startBandDrag(event, index, 'body');
    });
    band.append(start, end);
    bands.append(band);
  });
  updatePlayhead();
}

function renderForm() {
  const cue = currentCue();
  $('cue-form').hidden = false;
  $('cue-form-empty').hidden = true;
  $('selected-label').textContent = cue ? `第 ${state.selected + 1} 句` : '目前沒有字幕';
  $('previous-cue').disabled = state.selected <= 0;
  $('next-cue').disabled = state.selected < 0 || state.selected >= state.cues.length - 1;
  $('delete-cue').disabled = !cue;
  $('cue-form').querySelectorAll('input, textarea, button').forEach(control => { control.disabled = !cue; });
  $('cue-start').value = cue ? editorTime(cue.start) : '';
  $('cue-end').value = cue ? editorTime(cue.end) : '';
  $('cue-text').value = cue?.text || '';
  $('cue-error').hidden = true;
}

function render() {
  renderList();
  renderTimeline();
  renderForm();
  syncHistoryButtons();
}

function applyTimeField(id, key) {
  const cue = currentCue();
  if (!cue) return;
  const value = parseSubtitleTime($(id).value);
  const valid = Number.isFinite(value) && value >= 0 && (key === 'start' ? value < cue.end : value > cue.start);
  if (!valid) {
    $('cue-error').textContent = key === 'start' ? '開始時間必須早於結束時間。' : '結束時間必須晚於開始時間。';
    $('cue-error').hidden = false;
    $(id).value = editorTime(cue[key]);
    return;
  }
  recordHistory();
  cue[key] = key === 'end' ? Math.min(state.duration, value) : value;
  const selected = cue;
  state.cues.sort((a, b) => a.start - b.start || a.end - b.end);
  state.selected = state.cues.indexOf(selected);
  markDirty();
  render();
}

function adjustCueTime(key, delta) {
  const cue = currentCue();
  if (!cue || !['start', 'end'].includes(key) || !Number.isFinite(delta)) return;
  const value = Math.round((cue[key] + delta) * 1000) / 1000;
  const adjusted = key === 'start'
    ? Math.max(0, Math.min(cue.end - .1, value))
    : Math.max(cue.start + .1, Math.min(state.duration, value));
  if (adjusted === cue[key]) return;
  recordHistory();
  cue[key] = adjusted;
  const selected = cue;
  state.cues.sort((a, b) => a.start - b.start || a.end - b.end);
  state.selected = state.cues.indexOf(selected);
  markDirty();
  render();
}

function addCue() {
  recordHistory();
  const start = Math.max(0, Math.min(state.duration - .1, audio.currentTime || currentCue()?.end || 0));
  const cue = { start, end: Math.min(state.duration, start + 3), text: '新字幕' };
  if (cue.end <= cue.start) cue.end = cue.start + 3;
  state.duration = Math.max(state.duration, cue.end);
  state.cues.push(cue);
  state.cues.sort((a, b) => a.start - b.start || a.end - b.end);
  state.selected = state.cues.indexOf(cue);
  markDirty();
  render();
  $('cue-text').focus();
  $('cue-text').select();
}

function deleteCue() {
  if (!currentCue()) return;
  recordHistory();
  state.cues.splice(state.selected, 1);
  state.selected = Math.min(state.selected, state.cues.length - 1);
  markDirty();
  render();
}

function duplicateCue() {
  const cue = currentCue();
  if (!cue) return;
  recordHistory();
  const length = cue.end - cue.start;
  const copy = { start: Math.min(state.duration, cue.end), end: Math.min(state.duration, cue.end + length), text: cue.text };
  if (copy.end <= copy.start) { copy.start = cue.start; copy.end = cue.end; }
  state.cues.push(copy);
  state.cues.sort((a, b) => a.start - b.start || a.end - b.end);
  state.selected = state.cues.indexOf(copy);
  markDirty();
  render();
}

function subtitleFile() {
  return new File([serializeSubtitles({ cues: state.cues })], generatedSubtitleFilename(), { type: 'application/x-subrip', lastModified: Date.now() });
}

async function saveAndReturn() {
  if (!state.cues.length) { status('請先新增至少一句字幕。', 'error'); return; }
  try {
    $('save-subtitles').disabled = true;
    status('正在保存字幕…');
    const file = subtitleFile();
    await saveStoredMedia('subtitle', file);
    state.subtitleName = file.name;
    state.dirty = false;
    status('字幕已保存，正在返回主畫面。', 'success');
    location.href = `./?subtitleUpdated=${Date.now()}`;
  } catch (error) {
    $('save-subtitles').disabled = false;
    status(`無法保存字幕：${error.message}`, 'error');
  }
}

function downloadSrt() {
  if (!state.cues.length) { status('目前沒有可下載的字幕。', 'error'); return; }
  const file = subtitleFile();
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  status(`已下載 ${file.name}`, 'success');
}

function updatePlayhead() {
  const time = audio.currentTime || 0;
  $('playhead').style.left = `${Math.max(0, Math.min(100, time / state.duration * 100))}%`;
  $('editor-current-time').textContent = editorTime(time);
  document.querySelectorAll('.cue-list-item').forEach((item, index) => {
    const cue = state.cues[index];
    item.classList.toggle('active', time >= cue.start && time < cue.end);
  });
}

function drawWaveform(buffer = null) {
  const canvas = $('waveform');
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  const width = rect.width, height = rect.height;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border');
  context.lineWidth = 1;
  for (let second = 0; second <= state.duration; second += state.duration > 600 ? 60 : state.duration > 180 ? 30 : 10) {
    const x = second / state.duration * width;
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 88); context.stroke();
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted');
    context.font = '10px monospace'; context.fillText(editorTime(second).replace(/\.000$/, ''), x + 4, 13);
  }
  if (!buffer) return;
  const data = buffer.getChannelData(0), center = 52, amplitude = 31;
  context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary');
  context.beginPath();
  for (let x = 0; x < width; x++) {
    const from = Math.floor(x / width * data.length), to = Math.max(from + 1, Math.floor((x + 1) / width * data.length));
    let peak = 0;
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(data[i]));
    context.moveTo(x + .5, center - peak * amplitude); context.lineTo(x + .5, center + peak * amplitude);
  }
  context.stroke();
}

async function loadWorkspace() {
  try {
    const [audioRecord, subtitleRecord] = await Promise.all([loadStoredMedia('audio'), loadStoredMedia('subtitle')]);
    let decoded = null;
    if (audioRecord) {
      const file = unpackStoredMedia(audioRecord);
      state.audioFile = file;
      state.audioUrl = URL.createObjectURL(file);
      audio.src = state.audioUrl;
      $('editor-audio-name').textContent = file.name;
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContextClass({ sampleRate: 44100 });
        decoded = await context.decodeAudioData(await file.arrayBuffer());
        state.waveformBuffer = decoded;
        state.duration = decoded.duration;
        await context.close();
      } catch { status('音樂波形無法解析，但仍可編輯字幕。', 'error'); }
    }
    if (subtitleRecord) {
      const file = unpackStoredMedia(subtitleRecord);
      state.subtitleName = file.name;
      const extension = file.name.split('.').pop().toLowerCase();
      const parsed = parseSubtitles(await file.text(), extension);
      state.cues = normalizeCues(parsed.cues, state.duration);
      state.duration = Math.max(state.duration, ...state.cues.map(cue => cue.end));
      state.selected = state.cues.length ? 0 : -1;
      $('editor-subtitle-name').textContent = `${file.name} · 匯入後以 SRT 編輯`;
    }
    $('editor-duration').textContent = editorTime(state.duration);
    drawWaveform(decoded);
    render();
    $('recognize-subtitles').disabled = !state.audioFile || !state.waveformBuffer;
    status(state.cues.length ? `已載入 ${state.cues.length} 句字幕` : '尚無字幕，可從目前時間新增。', state.cues.length ? 'success' : '');
  } catch (error) {
    drawWaveform();
    render();
    status(`無法讀取保存的素材：${error.message}`, 'error');
  }
}

$('timeline').addEventListener('pointerdown', event => {
  if (event.target !== $('timeline') && event.target !== $('waveform') && event.target !== $('cue-bands')) return;
  const rect = $('timeline').getBoundingClientRect();
  audio.currentTime = Math.max(0, Math.min(state.duration, (event.clientX - rect.left) / rect.width * state.duration));
  updatePlayhead();
});
$('timeline').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  audio.currentTime = Math.max(0, Math.min(state.duration, (audio.currentTime || 0) + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 5 : .1)));
  updatePlayhead();
});
audio.addEventListener('timeupdate', updatePlayhead);
audio.addEventListener('loadedmetadata', () => { if (Number.isFinite(audio.duration)) { state.duration = audio.duration; $('editor-duration').textContent = editorTime(state.duration); renderTimeline(); } });
audio.addEventListener('play', () => $('recognition-vocals-audio').pause());
$('recognition-vocals-audio').addEventListener('play', () => audio.pause());
$('add-cue').addEventListener('click', addCue);
$('delete-cue').addEventListener('click', deleteCue);
$('duplicate-cue').addEventListener('click', duplicateCue);
$('previous-cue').addEventListener('click', () => selectCue(state.selected - 1, true));
$('next-cue').addEventListener('click', () => selectCue(state.selected + 1, true));
$('preview-cue').addEventListener('click', async () => { const cue = currentCue(); if (cue && audio.src) { audio.currentTime = cue.start; await audio.play(); } });
$('cue-start').addEventListener('change', () => applyTimeField('cue-start', 'start'));
$('cue-end').addEventListener('change', () => applyTimeField('cue-end', 'end'));
$('cue-form').querySelectorAll('[data-time-field]').forEach(button => button.addEventListener('click', () => {
  adjustCueTime(button.dataset.timeField, Number(button.dataset.timeDelta));
}));
$('cue-text').addEventListener('input', () => {
  const cue = currentCue();
  if (!cue) return;
  if (textHistoryCue !== cue) { recordHistory(); textHistoryCue = cue; }
  cue.text = $('cue-text').value;
  markDirty();
  renderList();
  renderTimeline();
});
$('cue-text').addEventListener('blur', () => { textHistoryCue = null; });
$('undo-edit').addEventListener('click', undoEdit);
$('redo-edit').addEventListener('click', redoEdit);
$('recognize-subtitles').addEventListener('click', requestSubtitleRecognition);
$('cancel-recognition').addEventListener('click', cancelSubtitleRecognition);
$('replace-subtitles-cancel').addEventListener('click', () => $('replace-subtitles-dialog').close());
$('replace-subtitles-confirm').addEventListener('click', () => {
  $('replace-subtitles-dialog').close();
  void startSubtitleRecognition();
});
$('download-subtitles').addEventListener('click', downloadSrt);
$('save-subtitles').addEventListener('click', saveAndReturn);
$('return-to-main').addEventListener('click', () => {
  if (!$('return-dialog').open) $('return-dialog').showModal();
});
$('return-dialog-cancel').addEventListener('click', () => $('return-dialog').close());
$('return-dialog').addEventListener('close', () => $('return-to-main').focus());
$('return-dialog-confirm').addEventListener('click', () => {
  if (!$('return-dialog').open) return;
  state.dirty = false;
  location.href = './';
});
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || !['z', 'y'].includes(event.key.toLowerCase())) return;
  if (event.target?.matches?.('input, textarea, [contenteditable="true"]')) return;
  event.preventDefault();
  if (event.key.toLowerCase() === 'y' || event.shiftKey) redoEdit();
  else undoEdit();
});
window.addEventListener('resize', () => drawWaveform(state.waveformBuffer));
window.addEventListener('beforeunload', event => { if (!state.dirty) return; event.preventDefault(); event.returnValue = ''; });
window.addEventListener('unload', () => {
  recognition.worker?.terminate();
  recognition.controller?.abort();
  if (recognition.vocalsUrl) URL.revokeObjectURL(recognition.vocalsUrl);
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
});

void loadWorkspace();
