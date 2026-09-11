import * as ort from "../vendor/onnxruntime-web/ort.all.min.mjs";
import {
  SEPARATOR_CHUNK_SIZE,
  SEPARATOR_STEP,
  decodeFloat16,
  hannWindow,
  prepareSeparatorInput,
  reconstructVocals,
  separatorTensorShape,
} from "./vocal-separator-core.js";

const MODEL_BASE = "https://huggingface.co/bgkb/bs_polarformer/resolve/9158719ee2173edd480a735764627526506fe4af";
const MODEL_PATHS = {
  webgpu: `${MODEL_BASE}/bs_polarformer_webgpu_fp16.onnx`,
  wasm: `${MODEL_BASE}/bs_polarformer_fp16.onnx`,
};
const MODEL_CACHE = "yumeew-vocal-models-v1";
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

async function loadModel(provider) {
  const url = MODEL_PATHS[provider];
  if (!("caches" in self)) return url;

  let cache;
  try {
    cache = await caches.open(MODEL_CACHE);
    const stored = await cache.match(url);
    if (stored) {
      sendStatus("正在從瀏覽器儲存讀取 AI 模型…", provider);
      return new Uint8Array(await stored.arrayBuffer());
    }
  } catch {
    sendStatus("瀏覽器模型儲存不可用，正在直接載入…", provider);
    return url;
  }

  sendStatus("首次下載 AI 模型；完成後會保存在這個瀏覽器…", provider);
  const response = await fetch(url);
  if (!response.ok) throw Error(`AI 模型下載失敗（HTTP ${response.status}）。`);
  try {
    await cache.put(url, response.clone());
  } catch {
    sendStatus("模型已下載，但瀏覽器儲存空間不足，本次仍會繼續。", provider);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function createSession(candidates = navigator.gpu ? ["webgpu", "wasm"] : ["wasm"]) {
  if (!navigator.gpu) reportGpuFailure("不可用", "目前瀏覽器環境未提供 WebGPU。");
  let lastError;
  for (const provider of candidates) {
    let session;
    try {
      sendStatus(provider === "webgpu" ? "正在載入 AI 模型並啟用 GPU…" : "正在載入 AI 模型並啟用 CPU…", provider);
      const options = { executionProviders: [provider], graphOptimizationLevel: "all" };
      if (provider === "webgpu") {
        ort.env.webgpu.powerPreference = "high-performance";
        const frames = Math.floor((SEPARATOR_CHUNK_SIZE - 2048) / 512) + 1;
        options.freeDimensionOverrides = { batch: 1, time_frames: frames };
      }
      const model = await loadModel(provider);
      sendStatus(provider === "webgpu" ? "正在建立 GPU 模型工作階段…" : "正在建立 CPU 模型工作階段…", provider);
      session = await ort.InferenceSession.create(model, options);
      return { session, provider };
    } catch (error) {
      session?.release?.();
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

async function separateWithSession(left, right, { session, provider }) {
  const total = left.length;
  const vocalsLeft = new Float32Array(total), vocalsRight = new Float32Array(total);
  const weights = new Float32Array(total), window = hannWindow();
  const starts = [];
  for (let start = -SEPARATOR_STEP; start < total; start += SEPARATOR_STEP) starts.push(start);
  const started = performance.now();

  for (let index = 0; index < starts.length; index++) {
    const start = starts[index];
    const sourceStart = Math.max(0, start), sourceEnd = Math.min(total, start + SEPARATOR_CHUNK_SIZE);
    const chunkOffset = sourceStart - start, validLength = Math.max(0, sourceEnd - sourceStart);
    const chunkLeft = new Float32Array(SEPARATOR_CHUNK_SIZE), chunkRight = new Float32Array(SEPARATOR_CHUNK_SIZE);
    chunkLeft.set(left.subarray(sourceStart, sourceEnd), chunkOffset);
    chunkRight.set(right.subarray(sourceStart, sourceEnd), chunkOffset);
    const prepared = prepareSeparatorInput(chunkLeft, chunkRight, window);
    const tensor = new ort.Tensor("float32", prepared.input, separatorTensorShape(prepared.frames));
    const result = await session.run({ [session.inputNames[0]]: tensor });
    const reconstructed = reconstructVocals(tensorValues(result[session.outputNames[0]]), prepared, window, SEPARATOR_CHUNK_SIZE);

    for (let i = 0; i < validLength; i++) {
      const chunkIndex = chunkOffset + i, outputIndex = sourceStart + i;
      if (!Number.isFinite(reconstructed.left[chunkIndex]) || !Number.isFinite(reconstructed.right[chunkIndex]))
        throw invalidOutput("AI 模型產生無效音訊。");
      const weight = Math.sin(Math.PI * (chunkIndex + 0.5) / SEPARATOR_CHUNK_SIZE) ** 2;
      vocalsLeft[outputIndex] += reconstructed.left[chunkIndex] * weight;
      vocalsRight[outputIndex] += reconstructed.right[chunkIndex] * weight;
      weights[outputIndex] += weight;
    }
    const fraction = (index + 1) / starts.length;
    const elapsed = (performance.now() - started) / 1000;
    self.postMessage({
      type: "progress",
      value: Math.round(fraction * 100),
      text: `正在分離 ${index + 1}／${starts.length} · 預估剩餘 ${Math.max(0, Math.round(elapsed / fraction * (1 - fraction)))} 秒`,
      provider,
    });
  }
  let inputPeak = 0, vocalsPeak = 0, instrumentalPeak = 0;
  for (let i = 0; i < total; i++) {
    inputPeak = Math.max(inputPeak, Math.abs(left[i]), Math.abs(right[i]));
    if (weights[i] > 1e-8) {
      vocalsLeft[i] /= weights[i];
      vocalsRight[i] /= weights[i];
    }
    left[i] -= vocalsLeft[i];
    right[i] -= vocalsRight[i];
    if (![vocalsLeft[i], vocalsRight[i], left[i], right[i]].every(Number.isFinite))
      throw invalidOutput("AI 分離結果含有無效音訊。");
    vocalsPeak = Math.max(vocalsPeak, Math.abs(vocalsLeft[i]), Math.abs(vocalsRight[i]));
    instrumentalPeak = Math.max(instrumentalPeak, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (inputPeak > 1e-5 && vocalsPeak < 1e-7 && instrumentalPeak < 1e-7)
    throw invalidOutput("AI 分離結果為靜音。");
  self.postMessage({
    type: "complete",
    provider,
    vocalsLeft,
    vocalsRight,
    instrumentalLeft: left,
    instrumentalRight: right,
  }, [vocalsLeft.buffer, vocalsRight.buffer, left.buffer, right.buffer]);
}

async function separate(left, right) {
  let state = await getSession();
  try {
    return await separateWithSession(left, right, state);
  } catch (error) {
    if (state.provider !== "webgpu" || error?.code !== "INVALID_OUTPUT") throw error;
    reportGpuFailure("推論結果無效", error);
    state.session.release?.();
    sendStatus("GPU 分離結果無效，正在自動改用 CPU 重新處理…", "wasm");
    sessionPromise = createSession(["wasm"]);
    try {
      state = await sessionPromise;
      return await separateWithSession(left, right, state);
    } catch (fallbackError) {
      sessionPromise = null;
      throw fallbackError;
    }
  }
}

self.addEventListener("message", event => {
  if (event.data?.type !== "separate") return;
  const left = new Float32Array(event.data.left), right = new Float32Array(event.data.right);
  separate(left, right).catch(error => self.postMessage({
    type: "error",
    text: error?.message || "人聲分離失敗，請重新載入後再試。",
  }));
});
