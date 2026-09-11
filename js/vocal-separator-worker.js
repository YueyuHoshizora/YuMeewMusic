import * as ort from "../vendor/onnxruntime-web/ort.all.min.mjs";
import {
  SEPARATOR_CHUNK_SIZE,
  SEPARATOR_STEP,
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
ort.env.wasm.wasmPaths = new URL("../vendor/onnxruntime-web/", import.meta.url).href;
ort.env.wasm.numThreads = 1;

const sendStatus = (text, provider = "") => self.postMessage({ type: "status", text, provider });
let sessionPromise = null;

async function createSession() {
  const candidates = navigator.gpu ? ["webgpu", "wasm"] : ["wasm"];
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
      session = await ort.InferenceSession.create(MODEL_PATHS[provider], options);
      const frames = Math.floor((SEPARATOR_CHUNK_SIZE - 2048) / 512) + 1;
      const probe = new ort.Tensor("float32", new Float32Array(frames * 4100), separatorTensorShape(frames));
      await session.run({ [session.inputNames[0]]: probe });
      return { session, provider };
    } catch (error) {
      session?.release?.();
      lastError = error;
      if (provider === "webgpu") sendStatus("GPU 無法執行此模型，正在改用 CPU…", "wasm");
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

async function separate(left, right) {
  const { session, provider } = await getSession();
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
    const reconstructed = reconstructVocals(result[session.outputNames[0]].data, prepared, window, SEPARATOR_CHUNK_SIZE);

    for (let i = 0; i < validLength; i++) {
      const chunkIndex = chunkOffset + i, outputIndex = sourceStart + i;
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
  for (let i = 0; i < total; i++) {
    if (weights[i] > 1e-8) {
      vocalsLeft[i] /= weights[i];
      vocalsRight[i] /= weights[i];
    }
    left[i] -= vocalsLeft[i];
    right[i] -= vocalsRight[i];
  }
  self.postMessage({
    type: "complete",
    provider,
    vocalsLeft,
    vocalsRight,
    instrumentalLeft: left,
    instrumentalRight: right,
  }, [vocalsLeft.buffer, vocalsRight.buffer, left.buffer, right.buffer]);
}

self.addEventListener("message", event => {
  if (event.data?.type !== "separate") return;
  const left = new Float32Array(event.data.left), right = new Float32Array(event.data.right);
  separate(left, right).catch(error => self.postMessage({
    type: "error",
    text: error?.message || "人聲分離失敗，請重新載入後再試。",
  }));
});
