import { env, pipeline } from '../vendor/transformers-js/transformers.web.min.js';
import { appendWhisperCues, recognitionChunks } from './lyrics-recognition-core.js';
import { indexedDbModelCache } from './indexeddb-model-cache.js';

if (env.backends.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = new URL('../vendor/transformers-js/', import.meta.url).href;
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = indexedDbModelCache;

const MODELS = {
  fast: 'onnx-community/whisper-tiny_timestamped',
  quality: 'onnx-community/whisper-small_timestamped',
};
const DEVICE_OPTIONS = {
  webgpu: { device: 'webgpu', dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' } },
  wasm: { device: 'wasm', dtype: 'q8' },
};

let transcriber = null;
let activeKey = '';

function send(type, details = {}) {
  self.postMessage({ type, ...details });
}

async function disposeTranscriber() {
  const current = transcriber;
  transcriber = null;
  activeKey = '';
  if (current) await current.dispose?.();
}

async function getTranscriber(mode, device) {
  const model = MODELS[mode] || MODELS.quality;
  const key = `${model}:${device}`;
  if (transcriber && activeKey === key) return transcriber;
  await disposeTranscriber();
  send('status', { text: `正在從 IndexedDB 讀取或下載 ${mode === 'fast' ? '快速' : '品質'}辨識模型…`, device });
  transcriber = await pipeline('automatic-speech-recognition', model, {
    ...DEVICE_OPTIONS[device],
    progress_callback: progress => {
      if (progress?.status === 'progress') send('model-progress', {
        value: Number(progress.progress) || 0,
        file: progress.file || '',
        device,
      });
    },
  });
  activeKey = key;
  return transcriber;
}

async function transcribeWithDevice(audio, mode, language, device) {
  const recognize = await getTranscriber(mode, device);
  send('status', { text: device === 'webgpu' ? 'Whisper 已使用 WebGPU，正在辨識歌詞…' : 'Whisper 正以 WASM CPU 辨識歌詞…', device });
  const chunks = recognitionChunks(audio);
  let cues = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    const options = { return_timestamps: true, task: 'transcribe' };
    if (language) options.language = language;
    const result = await recognize(chunk.audio, options);
    cues = appendWhisperCues(cues, result, chunk.start, chunk.end);
    send('progress', {
      value: Math.round((index + 1) / chunks.length * 100),
      current: index + 1,
      total: chunks.length,
      device,
    });
  }
  return cues;
}

async function transcribe(data) {
  const audio = new Float32Array(data.audio);
  const preferred = navigator.gpu ? 'webgpu' : 'wasm';
  try {
    const cues = await transcribeWithDevice(audio, data.mode, data.language, preferred);
    send('complete', { cues, device: preferred });
  } catch (error) {
    if (preferred !== 'webgpu') throw error;
    send('fallback', { text: `WebGPU 辨識失敗，正在改用 WASM CPU：${error?.message || error}` });
    await disposeTranscriber();
    const cues = await transcribeWithDevice(audio, data.mode, data.language, 'wasm');
    send('complete', { cues, device: 'wasm' });
  }
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'transcribe') return;
  transcribe(event.data).catch(error => send('error', {
    text: error?.message || '無法在瀏覽器中辨識歌詞。',
  }));
});
