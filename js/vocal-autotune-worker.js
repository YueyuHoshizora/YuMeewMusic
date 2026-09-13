import { autoTuneStereoWav } from "./vocal-autotune-core.js";

self.addEventListener("message", event => {
  if (event.data?.type !== "tune" || !(event.data.buffer instanceof ArrayBuffer)) return;
  try {
    let lastProgress = -1;
    const output = autoTuneStereoWav(event.data.buffer, event.data.options, fraction => {
      const progress = Math.min(100, Math.max(0, Math.round(fraction * 100)));
      if (progress !== lastProgress) {
        lastProgress = progress;
        self.postMessage({ type: "progress", value: progress });
      }
    });
    self.postMessage({ type: "complete", buffer: output }, [output]);
  } catch (error) {
    self.postMessage({ type: "error", text: error?.message || "自動調音失敗。" });
  }
});
