import { videoProfileConfig } from "./video-profile.js";
import { chooseVideoAcceleration } from "./video-acceleration.js";
import { videoDimensions } from "./dimensions.js";
import { draw } from "./visualizer.js";
import { getFormat } from "./formats.js";

const registrations = new Map();
async function registerAudioEncoder(codec) {
  if (!registrations.has(codec)) {
    const task =
      codec === "mp3"
        ? import("../vendor/mediabunny-mp3-encoder.min.mjs").then((m) => m.registerMp3Encoder())
        : import("../vendor/mediabunny-flac-encoder.min.mjs").then((m) => m.registerFlacEncoder());
    registrations.set(
      codec,
      task.catch((error) => {
        registrations.delete(codec);
        throw error;
      }),
    );
  }
  await registrations.get(codec);
}

export function frameTiming(index, fps, duration) {
  const timestamp = index / fps;
  return { timestamp, duration: Math.min(1 / fps, duration - timestamp) };
}

/** Local WebCodecs encoding; no upload or remote encoding fallback. */
export async function encodeMedia({
  format = "mp4",
  buffer,
  image,
  settings,
  resolution,
  aspectRatio = "16:9",
  fps,
  signal,
  onProgress,
  onEncodingMode = () => {},
}) {
  const m = await import("../vendor/mediabunny.min.mjs");
  const type = getFormat(format);
  const height = Number(resolution),
    rate = Number(fps);
  if (type.video && (![480, 720, 1080].includes(height) || ![30, 60].includes(rate)))
    throw Error("無效的影片設定。");
  const dimensions = type.video ? videoDimensions(resolution, aspectRatio) : null;
  const checkCanceled = () => {
    if (signal.aborted) throw Error("已取消匯出。");
  };
  checkCanceled();
  if (type.codec === "mp3") {
    await registerAudioEncoder("mp3");
    // LAME accepts at most stereo, with one of these sample rates.
    const sampleRate = [32000, 44100, 48000].includes(buffer.sampleRate)
      ? buffer.sampleRate
      : 44100;
    if (sampleRate !== buffer.sampleRate || buffer.numberOfChannels > 2) {
      const context = new OfflineAudioContext(
        Math.min(2, buffer.numberOfChannels),
        Math.ceil(buffer.duration * sampleRate),
        sampleRate,
      );
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start();
      buffer = await context.startRendering();
      checkCanceled();
    }
  } else if (type.codec === "flac") await registerAudioEncoder("flac");
  if (
    !(await m.canEncodeAudio(type.codec, {
      numberOfChannels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
    }))
  ) {
    throw Error(
      `此瀏覽器無法編碼 ${format.toUpperCase()}，請使用最新版 Chrome 或 Edge 再試。檔案不會改送至伺服器。`,
    );
  }
  checkCanceled();
  const bitrate = height === 1080 ? 8_000_000 : height === 720 ? 4_000_000 : 2_000_000;
  const profileOptions = type.video ? videoProfileConfig(settings?.profile ?? "auto", dimensions, rate) : {};
  const hardwareAcceleration = type.video
    ? await chooseVideoAcceleration(m.canEncodeVideo, {...dimensions, bitrate, framerate:rate, ...profileOptions}, signal)
    : null;
  if (type.video) onEncodingMode(hardwareAcceleration);
  checkCanceled();
  const canvas = type.video ? document.createElement("canvas") : null;
  if (canvas) {
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
  }
  const target = new m.BufferTarget();
  const output = new m.Output({ format: new m[type.container](), target });
  try {
    const video = type.video
      ? new m.CanvasSource(canvas, {
          codec: "avc",
          ...profileOptions,
          bitrate,
          hardwareAcceleration,
        })
      : null;
    const audio = new m.AudioBufferSource({
      codec: type.codec,
      ...(type.codec === "flac" ? {} : { bitrate: 192_000 }),
    });
    if (video) output.addVideoTrack(video, { frameRate: rate });
    output.addAudioTrack(audio);
    await output.start();
    const count = type.video
      ? Math.ceil(buffer.duration * rate)
      : Math.ceil(buffer.length / buffer.sampleRate);
    let audioOffset = 0;
    for (let i = 0; i < count; i++) {
      checkCanceled();
      if (video) {
        const frame = frameTiming(i, rate, buffer.duration);
        draw(canvas, frame.timestamp, buffer, image, settings);
        await video.add(frame.timestamp, frame.duration);
      }
      // Feed small audio blocks alongside video to bound muxer buffering and allow cancellation.
      if (!type.video || i % rate === 0) {
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
      if (!type.video || i % 10 === 0) {
        onProgress(Math.round((i / count) * 98));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    checkCanceled();
    video?.close();
    audio.close();
    await output.finalize();
    checkCanceled();
    onProgress(100);
    return new Blob([target.buffer], { type: type.mime });
  } catch (error) {
    if (output.state !== "finalized" && output.state !== "canceled")
      await output.cancel().catch(() => {});
    throw error;
  }
}
