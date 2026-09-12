import { SPLEETER_CHUNK, SPLEETER_SHAPE, spleeterStarts, prepareSpleeter, reconstructSpleeter } from "./spleeter-core.js";
import { downmixAndResample } from "./lyrics-recognition-core.js";
import { loadModelBytes } from "./indexeddb-model-cache.js";
import * as ort from "../vendor/onnxruntime-web/ort.all.min.mjs";
import {
  SEPARATOR_CHUNK_SIZE,
  separatorChunkStarts,
  decodeFloat16,
  hannWindow,
  prepareSeparatorInput,
  reconstructVocals,
  separatorTensorShape,
} from "./vocal-separator-core.js";

const MODEL_BASE = "https://huggingface.co/bgkb/bs_polarformer/resolve/9158719ee2173edd480a735764627526506fe4af";
const MODEL_PATHS = {
  webgpu: `${MODEL_BASE}/bs_polarformer_webgpu.onnx`,
  wasm: `${MODEL_BASE}/bs_polarformer_fp16.onnx`,
};
const SPLEETER_BASE = "https://huggingface.co/csukuangfj/sherpa-onnx-spleeter-2stems/resolve/7001ba316a615cacddb3f9ef3ec416661a277e26";
let activeModel = "spleeter";
const LEGACY_MODEL_CACHE = "yumeew-vocal-models-v1";
ort.env.wasm.wasmPaths = new URL("../vendor/onnxruntime-web/", import.meta.url).href;
ort.env.wasm.numThreads = 1;

const sendStatus = (text, provider = "") => self.postMessage({ type: "status", text, provider });
let sessionPromise = null;

function reportGpuFailure(stage, error) {
  const reason = error?.message || String(error);
  console.warn(`[人聲分離 GPU：${stage}]`, error);
  self.postMessage({ type: "gpu-fallback", text: `GPU ${stage}：${reason}` });
}

function invalidOutput(message) {
  const error = Error(message);
  error.code = "INVALID_OUTPUT";
  return error;
}

function tensorValues(tensor) {
  const values = tensor.type === "float16" && tensor.data instanceof Uint16Array
    ? decodeFloat16(tensor.data)
    : tensor.data;
  if (!values?.length) throw invalidOutput("AI 模型沒有產生音訊資料。");
  for (const value of values) if (!Number.isFinite(value))
    throw invalidOutput("AI 模型產生無效數值。");
  return values;
}

async function loadModel(provider, url = MODEL_PATHS[provider]) {
  return loadModelBytes(url, {
    legacyCacheName: LEGACY_MODEL_CACHE,
    onStatus: text => sendStatus(text, provider),
  });
}

async function createSession(candidates = navigator.gpu ? ["webgpu", "wasm"] : ["wasm"]) {
  if (!navigator.gpu) reportGpuFailure("不可用", "目前瀏覽器環境未提供 WebGPU。");
  let lastError;
  for (const provider of candidates) {
    let session, accompaniment;
    try {
      sendStatus(provider === "webgpu" ? "正在載入 AI 模型並啟用 GPU…" : "正在載入 AI 模型並啟用 CPU…", provider);
      const options = { executionProviders: [provider], graphOptimizationLevel: "all" };
      if (provider === "webgpu") {
        ort.env.webgpu.powerPreference = "high-performance";
        const frames = Math.floor((SEPARATOR_CHUNK_SIZE - 2048) / 512) + 1;
        options.freeDimensionOverrides = activeModel === "spleeter" ? { num_splits: 1 } : { batch: 1, time_frames: frames };
      }
      const model = await loadModel(provider, activeModel === "spleeter" ? `${SPLEETER_BASE}/vocals.onnx` : MODEL_PATHS[provider]);
      sendStatus(provider === "webgpu" ? "正在建立 FP32 GPU 模型工作階段…" : "正在建立 CPU 模型工作階段…", provider);
      session = await ort.InferenceSession.create(model, options);
      if (activeModel === "spleeter") {
        sendStatus("正在載入 Spleeter 伴奏模型…", provider);
        accompaniment = await ort.InferenceSession.create(await loadModel(provider, `${SPLEETER_BASE}/accompaniment.onnx`), options);
      }
      return { session, accompaniment, provider, model: activeModel };
    } catch (error) {
      await session?.release?.();
      await accompaniment?.release?.();
      lastError = error;
      if (provider === "webgpu") {
        reportGpuFailure("初始化失敗", error);
        sendStatus("GPU 無法執行此模型，正在改用 CPU…", "wasm");
      }
    }
  }
  throw lastError || Error("無法啟動人聲分離模型。");
}

async function getSession() {
  if (sessionPromise) {
    const state = await sessionPromise;
    sendStatus("沿用已載入的 AI 模型，正在準備分離…", state.provider);
    return state;
  }
  sessionPromise = createSession();
  try {
    return await sessionPromise;
  } catch (error) {
    sessionPromise = null;
    throw error;
  }
}

async function separateWithSession(left, right, { session, accompaniment, provider, model }, mode, output) {
  const total = left.length;
  const light = model === "spleeter";
  const chunkSize = light ? SPLEETER_CHUNK : SEPARATOR_CHUNK_SIZE;
  const vocalsLeft = new Float32Array(total), vocalsRight = new Float32Array(total);
  const weights = new Float32Array(total), window = hannWindow();
  const starts = light ? spleeterStarts(total) : separatorChunkStarts(total, mode);
  const recentDurations = [];
  const blendWeights = Float32Array.from({ length: chunkSize }, (_, i) => Math.sin(Math.PI * (i + 0.5) / chunkSize) ** 2);

  for (let index = 0; index < starts.length; index++) {
    const chunkStarted = performance.now();
    const start = starts[index];
    const sourceStart = Math.max(0, start), sourceEnd = Math.min(total, start + chunkSize);
    const chunkOffset = sourceStart - start, validLength = Math.max(0, sourceEnd - sourceStart);
    const chunkLeft = new Float32Array(chunkSize), chunkRight = new Float32Array(chunkSize);
    chunkLeft.set(left.subarray(sourceStart, sourceEnd), chunkOffset);
    chunkRight.set(right.subarray(sourceStart, sourceEnd), chunkOffset);
    const prepared = light ? prepareSpleeter(chunkLeft, chunkRight) : prepareSeparatorInput(chunkLeft, chunkRight, window);
    const tensor = new ort.Tensor("float32", prepared.input, light ? SPLEETER_SHAPE : separatorTensorShape(prepared.frames));
    let result, other, reconstructed;
    try {
      result = await session.run({ [session.inputNames[0]]: tensor });
      if (light) other = await accompaniment.run({ [accompaniment.inputNames[0]]: tensor });
      reconstructed = light
        ? reconstructSpleeter(tensorValues(result[session.outputNames[0]]), tensorValues(other[accompaniment.outputNames[0]]), prepared)
        : reconstructVocals(tensorValues(result[session.outputNames[0]]), prepared, window, chunkSize);
    } finally {
      tensor.dispose();
      for (const output of Object.values(result || {})) output.dispose();
      for (const output of Object.values(other || {})) output.dispose();
    }

    for (let i = 0; i < validLength; i++) {
      const chunkIndex = chunkOffset + i, outputIndex = sourceStart + i;
      if (!Number.isFinite(reconstructed.left[chunkIndex]) || !Number.isFinite(reconstructed.right[chunkIndex]))
        throw invalidOutput("AI 模型產生無效音訊。");
      const weight = blendWeights[chunkIndex];
      vocalsLeft[outputIndex] += reconstructed.left[chunkIndex] * weight;
      vocalsRight[outputIndex] += reconstructed.right[chunkIndex] * weight;
      weights[outputIndex] += weight;
    }
    const fraction = (index + 1) / starts.length;
    const seconds = (performance.now() - chunkStarted) / 1000;
    if (index > 0) recentDurations.push(seconds);
    if (recentDurations.length > 8) recentDurations.shift();
    const average = recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length;
    const estimate = index === 0 ? "首次推論完成，正在估算" : `預估剩餘 ${Math.round(average * (starts.length - index - 1))} 秒`;
    self.postMessage({
      type: "progress",
      value: Math.round(fraction * 100),
      text: `正在分離 ${index + 1}／${starts.length} · ${estimate} · 本段 ${seconds.toFixed(1)} 秒`,
      provider,
      model,
    });
  }
  const instrumentalLeft = new Float32Array(total), instrumentalRight = new Float32Array(total);
  let inputPeak = 0, vocalsPeak = 0, instrumentalPeak = 0;
  for (let i = 0; i < total; i++) {
    inputPeak = Math.max(inputPeak, Math.abs(left[i]), Math.abs(right[i]));
    if (weights[i] > 1e-8) {
      vocalsLeft[i] /= weights[i];
      vocalsRight[i] /= weights[i];
    }
    instrumentalLeft[i] = left[i] - vocalsLeft[i];
    instrumentalRight[i] = right[i] - vocalsRight[i];
    if (![vocalsLeft[i], vocalsRight[i], instrumentalLeft[i], instrumentalRight[i]].every(Number.isFinite))
      throw invalidOutput("AI 分離結果含有無效音訊。");
    vocalsPeak = Math.max(vocalsPeak, Math.abs(vocalsLeft[i]), Math.abs(vocalsRight[i]));
    instrumentalPeak = Math.max(instrumentalPeak, Math.abs(instrumentalLeft[i]), Math.abs(instrumentalRight[i]));
  }
  if (inputPeak > 1e-5 && vocalsPeak < 1e-7 && instrumentalPeak < 1e-7)
    throw invalidOutput("AI 分離結果為靜音。");
  if (output === "vocals-16k") {
    sendStatus("人聲分離完成，正在準備歌詞辨識音訊…", provider);
    const recognitionAudio = downmixAndResample(vocalsLeft, vocalsRight);
    self.postMessage({ type: "complete", provider, recognitionAudio }, [recognitionAudio.buffer]);
    return;
  }
  self.postMessage({
    type: "complete",
    provider,
    vocalsLeft,
    vocalsRight,
    instrumentalLeft,
    instrumentalRight,
  }, [vocalsLeft.buffer, vocalsRight.buffer, instrumentalLeft.buffer, instrumentalRight.buffer]);
}

async function separate(left, right, mode, model, output) {
  const selected = model === "polarformer" ? "polarformer" : "spleeter";
  if (selected !== activeModel) {
    if (sessionPromise) {
      const old = await sessionPromise;
      await old.session.release();
      await old.accompaniment?.release();
    }
    sessionPromise = null;
    activeModel = selected;
  }
  let state = await getSession();
  try {
    return await separateWithSession(left, right, state, mode, output);
  } catch (error) {
    if (state.provider !== "webgpu" || error?.code !== "INVALID_OUTPUT") throw error;
    reportGpuFailure("推論結果無效", error);
    await state.session.release?.();
    await state.accompaniment?.release?.();
    sendStatus("GPU 分離結果無效，正在自動改用 CPU 重新處理…", "wasm");
    sessionPromise = createSession(["wasm"]);
    try {
      state = await sessionPromise;
      return await separateWithSession(left, right, state, mode, output);
    } catch (fallbackError) {
      sessionPromise = null;
      throw fallbackError;
    }
  }
}

self.addEventListener("message", event => {
  if (event.data?.type !== "separate") return;
  const left = new Float32Array(event.data.left), right = new Float32Array(event.data.right);
  separate(left, right, event.data.mode, event.data.model, event.data.output).catch(error => self.postMessage({
    type: "error",
    text: error?.message || "人聲分離失敗，請重新載入後再試。",
  }));
});
