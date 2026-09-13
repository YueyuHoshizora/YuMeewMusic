const RESOURCE_PREFIX = Object.freeze({ image: "Image", audio: "Audio", video: "Video" });

export function resourceKind(file) {
  const mime = String(file?.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"].includes(extension)) return "image";
  if (["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"].includes(extension)) return "audio";
  if (["mp4", "mov", "webm", "mkv", "m4v"].includes(extension)) return "video";
  return "";
}

export function nextResourceReference(resources, kind, counters = {}) {
  const prefix = RESOURCE_PREFIX[kind];
  if (!prefix) throw Error("不支援的資源類型。");
  const usedMaximum = resources.reduce((maximum, resource) => {
    const match = resource.kind === kind && String(resource.referenceName || "").match(new RegExp(`^${prefix}(\\d+)$`));
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  const number = Math.max(Number(counters[kind]) || 0, usedMaximum) + 1;
  return { referenceName: `${prefix}${number}`, nextNumber: number };
}

export function formatResourceSize(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}

export function resourceTypeLabel(kind) {
  return kind === "image" ? "圖片" : kind === "audio" ? "音頻" : kind === "video" ? "影片" : "資源";
}
