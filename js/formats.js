export const FORMATS = Object.freeze({
  mp4: {
    video: true,
    codec: "aac",
    container: "Mp4OutputFormat",
    mime: "video/mp4",
    description: "影片 · H.264 / AAC",
  },
  mov: {
    video: true,
    codec: "aac",
    container: "MovOutputFormat",
    mime: "video/quicktime",
    description: "影片 · H.264 / AAC",
  },
  mp3: {
    video: false,
    codec: "mp3",
    container: "Mp3OutputFormat",
    mime: "audio/mpeg",
    description: "純音訊 · MP3 192 kbps",
  },
  m4a: {
    video: false,
    codec: "aac",
    container: "Mp4OutputFormat",
    mime: "audio/mp4",
    description: "純音訊 · AAC 192 kbps",
  },
  flac: {
    video: false,
    codec: "flac",
    container: "FlacOutputFormat",
    mime: "audio/flac",
    description: "純音訊 · FLAC 無損編碼",
  },
});
export function getFormat(format) {
  if (!Object.hasOwn(FORMATS, format)) throw Error("不支援的輸出格式。");
  return FORMATS[format];
}
export function exportFilename(name, format, resolution, fps) {
  const type = getFormat(format);
  const base = name.replace(/\.[^.]+$/, "") || "yumeew";
  return `${base}${type.video ? `-${resolution}p-${fps}fps` : ""}.${format}`;
}
