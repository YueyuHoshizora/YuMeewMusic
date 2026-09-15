import { loadModelBytes } from "./indexeddb-model-cache.js";
import * as ort from "../vendor/onnxruntime-web/ort.all.min.mjs";

const MODEL_BASE = "https://model-proxy.yustellar.idv.tw/models";
const MERT_URL = `${MODEL_BASE}/mert-apex-uint8.onnx`;
const HEAD_URL = `${MODEL_BASE}/apex-head.onnx`;
const SAMPLE_RATE = 16000;
const SEGMENT_SAMPLES = SAMPLE_RATE * 30;
const HIDDEN_SIZE = 768;

ort.env.wasm.wasmPaths = new URL("../vendor/onnxruntime-web/", import.meta.url).href;
const WASM_THREAD_LIMIT = 16;
ort.env.wasm.numThreads = globalThis.crossOriginIsolated
  ? Math.min(WASM_THREAD_LIMIT, navigator.hardwareConcurrency || WASM_THREAD_LIMIT)
  : 1;

let sessionsPromise = null;
let cancelled = false;

function status(text, provider = "") {
  self.postMessage({ type: "status", text, provider });
}

async function modelBytes(url) {
  return loadModelBytes(url, { onStatus: text => status(text) });
}

async function createSessions() {
  status("正在讀取 APEX 與 MERT 模型…");
  const [mertBytes, headBytes] = await Promise.all([modelBytes(MERT_URL), modelBytes(HEAD_URL)]);
  const candidates = navigator.gpu ? ["webgpu", "wasm"] : ["wasm"];
  let lastError;
  for (const provider of candidates) {
    let mert;
    let head;
    try {
      status(provider === "webgpu" ? "正在啟用 WebGPU 評分引擎…" : "正在啟用 WASM 評分引擎…", provider);
      if (provider === "webgpu") ort.env.webgpu.powerPreference = "high-performance";
      const options = { executionProviders: [provider], graphOptimizationLevel: "all" };
      mert = await ort.InferenceSession.create(mertBytes, options);
      head = await ort.InferenceSession.create(headBytes, options);
      return { mert, head, provider };
    } catch (error) {
      await mert?.release?.();
      await head?.release?.();
      lastError = error;
      if (provider === "webgpu") status("此模型無法使用目前的 WebGPU，正在改用 WASM CPU…", "wasm");
    }
  }
  throw lastError || Error("無法啟動歌曲評分模型。");
}

async function getSessions() {
  sessionsPromise ||= createSessions();
  try {
    return await sessionsPromise;
  } catch (error) {
    sessionsPromise = null;
    throw error;
  }
}

function prepareSegment(audio, start) {
  const segment = new Float32Array(SEGMENT_SAMPLES);
  segment.set(audio.subarray(start, Math.min(audio.length, start + SEGMENT_SAMPLES)));
  let mean = 0;
  for (const value of segment) mean += value;
  mean /= segment.length;
  let variance = 0;
  for (const value of segment) variance += (value - mean) ** 2;
  const scale = Math.sqrt(variance / segment.length + 1e-7);
  for (let index = 0; index < segment.length; index++) segment[index] = (segment[index] - mean) / scale;
  return segment;
}

function meanHidden(tensor) {
  const values = tensor.data;
  const frames = tensor.dims.at(-2);
  if (!values?.length || !frames || tensor.dims.at(-1) !== HIDDEN_SIZE) throw Error("MERT 模型輸出格式不正確。");
  const result = new Float32Array(HIDDEN_SIZE);
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * HIDDEN_SIZE;
    for (let index = 0; index < HIDDEN_SIZE; index++) result[index] += values[offset + index];
  }
  for (let index = 0; index < HIDDEN_SIZE; index++) result[index] /= frames;
  return result;
}

async function analyze(audio) {
  cancelled = false;
  const { mert, head, provider } = await getSessions();
  const segments = Math.max(1, Math.ceil(audio.length / SEGMENT_SAMPLES));
  const hiddenMeans = new Float32Array(4 * HIDDEN_SIZE);
  status(`評分引擎已就緒，正在分析 ${segments} 個音樂片段…`, provider);

  for (let segmentIndex = 0; segmentIndex < segments; segmentIndex++) {
    if (cancelled) throw Object.assign(Error("分析已取消。"), { code: "CANCELLED" });
    const input = new ort.Tensor("float32", prepareSegment(audio, segmentIndex * SEGMENT_SAMPLES), [1, SEGMENT_SAMPLES]);
    let outputs;
    try {
      outputs = await mert.run({ [mert.inputNames[0]]: input });
      const ordered = mert.outputNames.map(name => outputs[name]);
      if (ordered.length !== 4) throw Error("MERT 模型缺少 APEX 所需的音樂特徵。");
      ordered.forEach((tensor, layer) => {
        const mean = meanHidden(tensor);
        for (let index = 0; index < HIDDEN_SIZE; index++) hiddenMeans[layer * HIDDEN_SIZE + index] += mean[index] / segments;
      });
    } finally {
      input.dispose();
      for (const output of Object.values(outputs || {})) output.dispose();
    }
    self.postMessage({ type: "progress", value: Math.round((segmentIndex + 1) / segments * 92), current: segmentIndex + 1, total: segments });
  }

  if (cancelled) throw Object.assign(Error("分析已取消。"), { code: "CANCELLED" });
  status("正在計算歌曲評分…", provider);
  const input = new ort.Tensor("float32", hiddenMeans, [1, 4, HIDDEN_SIZE]);
  let outputs;
  try {
    outputs = await head.run({ [head.inputNames[0]]: input });
    const value = name => Number(outputs[name]?.data?.[0]);
    const result = Object.fromEntries(["streams", "likes", "coherence", "musicality", "memorability", "clarity", "naturalness"].map(name => [name, value(name)]));
    if (Object.values(result).some(number => !Number.isFinite(number))) throw Error("APEX 模型產生無效分數。");
    self.postMessage({ type: "result", result, provider });
  } finally {
    input.dispose();
    for (const output of Object.values(outputs || {})) output.dispose();
  }
}

self.onmessage = event => {
  if (event.data?.type === "cancel") {
    cancelled = true;
    return;
  }
  if (event.data?.type !== "analyze") return;
  analyze(event.data.audio).catch(error => self.postMessage({
    type: error?.code === "CANCELLED" ? "cancelled" : "error",
    message: error?.message || "歌曲評分失敗。",
  }));
};
