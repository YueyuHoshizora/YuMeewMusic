import { draw } from "./visualizer.js";

export function frameTiming(index, fps, duration) {
  const timestamp = index / fps;
  return { timestamp, duration: Math.min(1 / fps, duration - timestamp) };
}

/** Local WebCodecs encoding; no upload or remote encoding fallback. */
export async function encodeVideo({
  buffer,
  image,
  settings,
  resolution,
  fps,
  signal,
  onProgress,
}) {
  const m = await import("../vendor/mediabunny.min.mjs");
  const height = Number(resolution),
    rate = Number(fps);
  if (![720, 1080].includes(height) || ![30, 60].includes(rate)) throw Error("無效的影片設定。");
  const checkCanceled = () => {
    if (signal.aborted) throw Error("已取消匯出。");
  };
  checkCanceled();
  if (
    !(await m.canEncodeVideo("avc", { width: (height * 16) / 9, height })) ||
    !(await m.canEncodeAudio("aac", {
      numberOfChannels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
    }))
  ) {
    throw Error(
      "此瀏覽器無法編碼 H.264／AAC，請使用最新版 Chrome 或 Edge 再試。檔案不會改送至伺服器。",
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = (height * 16) / 9;
  canvas.height = height;
  const target = new m.BufferTarget();
  const output = new m.Output({ format: new m.Mp4OutputFormat(), target });
  try {
    const video = new m.CanvasSource(canvas, {
      codec: "avc",
      bitrate: height === 1080 ? 8_000_000 : 4_000_000,
    });
    const audio = new m.AudioBufferSource({ codec: "aac", bitrate: 192_000 });
    output.addVideoTrack(video, { frameRate: rate });
    output.addAudioTrack(audio);
    await output.start();
    const count = Math.ceil(buffer.duration * rate);
    let audioOffset = 0;
    for (let i = 0; i < count; i++) {
      checkCanceled();
      const frame = frameTiming(i, rate, buffer.duration);
      draw(canvas, frame.timestamp, buffer, image, settings);
      await video.add(frame.timestamp, frame.duration);
      // Feed small audio blocks alongside video to bound muxer buffering and allow cancellation.
      if (i % rate === 0) {
        const length = Math.min(buffer.sampleRate, buffer.length - audioOffset);
        if (length > 0) {
          const part = new AudioBuffer({
            length,
            numberOfChannels: buffer.numberOfChannels,
            sampleRate: buffer.sampleRate,
          });
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            part.copyToChannel(
              buffer.getChannelData(channel).subarray(audioOffset, audioOffset + length),
              channel,
            );
          }
          await audio.add(part);
          audioOffset += length;
        }
      }
      if (i % 10 === 0) {
        onProgress(Math.round((i / count) * 98));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    checkCanceled();
    video.close();
    audio.close();
    await output.finalize();
    checkCanceled();
    onProgress(100);
    return new Blob([target.buffer], { type: "video/mp4" });
  } catch (error) {
    if (output.state !== "finalized" && output.state !== "canceled")
      await output.cancel().catch(() => {});
    throw error;
  }
}
