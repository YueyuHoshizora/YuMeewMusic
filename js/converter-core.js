import { FORMATS, getFormat } from "./formats.js";
import { registerAudioEncoder } from "./export.js";

export const CONVERTER_FORMAT_LABELS = Object.freeze({
  mp4: "MP4 · 影片",
  mov: "MOV · 影片",
  webm: "WebM · 影片",
  mp3: "MP3 · 純音訊",
  m4a: "M4A · 純音訊",
  flac: "FLAC · 純音訊",
  wav: "WAV · 純音訊",
});

export function converterFormats(kind, hasAudio = true) {
  if (!['video', 'audio'].includes(kind)) return [];
  return Object.keys(FORMATS).filter(format => {
    const type = FORMATS[format];
    if (kind === 'audio') return !type.video;
    return type.video || hasAudio;
  });
}

export function converterFilename(name, format) {
  getFormat(format);
  const base = String(name || '').replace(/\.[^.]+$/, '') || 'yumeew';
  return `${base}-converted.${format}`;
}

export async function inspectMediaFile(file) {
  const m = await import('../vendor/mediabunny.min.mjs');
  const input = new m.Input({ source: new m.BlobSource(file), formats: m.ALL_FORMATS });
  try {
    const [format, videoTrack, audioTrack, duration] = await Promise.all([
      input.getFormat(),
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
      input.computeDuration(),
    ]);
    if (!videoTrack && !audioTrack) throw Error('檔案中找不到可用的影片或音訊軌。');
    const video = videoTrack
      ? {
          codec: (await videoTrack.getCodec()) || '未知',
          width: await videoTrack.getDisplayWidth(),
          height: await videoTrack.getDisplayHeight(),
        }
      : null;
    const audio = audioTrack
      ? {
          codec: (await audioTrack.getCodec()) || '未知',
          channels: await audioTrack.getNumberOfChannels(),
          sampleRate: await audioTrack.getSampleRate(),
        }
      : null;
    return {
      kind: video ? 'video' : 'audio',
      format: format.name,
      duration: Number.isFinite(duration) ? duration : 0,
      video,
      audio,
    };
  } finally {
    input.dispose();
  }
}

export async function convertMediaFile({ file, format, inputKind, hasAudio = true, audioChannels = 2, signal, onProgress = () => {} }) {
  const type = getFormat(format);
  if (inputKind === 'audio' && type.video) throw Error('音樂檔只能轉換成音訊格式。');
  if (!type.video && !hasAudio) throw Error('這個影片沒有音軌，無法轉換成純音訊。');
  if (signal?.aborted) throw Error('已取消轉換。');
  if (['mp3', 'flac'].includes(type.codec)) await registerAudioEncoder(type.codec);

  const m = await import('../vendor/mediabunny.min.mjs');
  const input = new m.Input({ source: new m.BlobSource(file), formats: m.ALL_FORMATS });
  const target = new m.BufferTarget();
  const output = new m.Output({ format: new m[type.container](), target });
  let conversion = null;
  const cancel = () => { if (conversion) void conversion.cancel(); };
  signal?.addEventListener('abort', cancel);
  try {
    conversion = await m.Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: type.video
        ? { codec: type.videoCodec, hardwareAcceleration: 'prefer-hardware' }
        : { discard: true },
      audio: type.video
        ? hasAudio ? { codec: type.codec, bitrate: 192_000 } : { discard: true }
        : {
            codec: type.codec,
            ...(['aac', 'mp3'].includes(type.codec) ? { bitrate: 192_000 } : {}),
            ...(type.codec === 'mp3' ? { numberOfChannels: Math.max(1, Math.min(2, audioChannels)) } : {}),
          },
    });
    if (signal?.aborted) {
      await conversion.cancel();
      throw Error('已取消轉換。');
    }
    if (!conversion.isValid) throw Error('目前的瀏覽器無法將這個檔案轉成所選格式。');
    conversion.onProgress = value => onProgress(Math.round(value * 100));
    await conversion.execute();
    if (signal?.aborted) throw Error('已取消轉換。');
    return new Blob([target.buffer], { type: type.mime });
  } catch (error) {
    if (signal?.aborted || error instanceof m.ConversionCanceledError) throw Error('已取消轉換。');
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    input.dispose();
  }
}
