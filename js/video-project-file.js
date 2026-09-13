const MAGIC_TEXT = "YMVPROJ1";
const MAGIC = new TextEncoder().encode(MAGIC_TEXT);
const HEADER_BYTES = MAGIC.length + 4;
const MAX_METADATA_BYTES = 16 * 1024 * 1024;

function projectFilename(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `video_prompt_${day}_${time}.zip`;
}

function binaryDescriptor(blob, index) {
  return {
    index,
    size: blob.size,
    type: blob.type || "application/octet-stream",
    name: typeof blob.name === "string" && blob.name ? blob.name : `media-${index + 1}`,
    lastModified: Number(blob.lastModified) || Date.now(),
  };
}

export async function createVideoProjectFile(metadata, blobs = [], date = new Date()) {
  if (!metadata || typeof metadata !== "object") throw new TypeError("專案設定格式無效。");
  if (!blobs.every(blob => blob instanceof Blob)) throw new TypeError("專案媒體格式無效。");
  const manifest = {
    format: "YuMeew Video Prompt",
    version: 1,
    metadata,
    binaries: blobs.map(binaryDescriptor),
  };
  const encoded = new TextEncoder().encode(JSON.stringify(manifest));
  if (encoded.byteLength > MAX_METADATA_BYTES) throw new Error("專案設定資料過大。");
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC, 0);
  new DataView(header.buffer).setUint32(MAGIC.length, encoded.byteLength, true);
  return new File([header, encoded, ...blobs], projectFilename(date), { type: "application/octet-stream", lastModified: date.getTime() });
}

export async function readVideoProjectFile(file) {
  if (!(file instanceof Blob) || file.size < HEADER_BYTES) throw new Error("不是有效的 YuMeew 影片設定檔。");
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  if (!MAGIC.every((value, index) => header[index] === value)) throw new Error("不是有效的 YuMeew 影片設定檔。");
  const metadataLength = new DataView(header.buffer).getUint32(MAGIC.length, true);
  if (!metadataLength || metadataLength > MAX_METADATA_BYTES || HEADER_BYTES + metadataLength > file.size) throw new Error("影片設定檔已損壞。");
  let manifest;
  try {
    manifest = JSON.parse(await file.slice(HEADER_BYTES, HEADER_BYTES + metadataLength).text());
  } catch {
    throw new Error("影片設定檔的資料無法解析。");
  }
  if (manifest?.format !== "YuMeew Video Prompt" || manifest?.version !== 1 || !manifest.metadata || !Array.isArray(manifest.binaries)) {
    throw new Error("不支援這個影片設定檔版本。");
  }
  let offset = HEADER_BYTES + metadataLength;
  const binaries = manifest.binaries.map((descriptor, index) => {
    const size = Number(descriptor?.size);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > file.size) throw new Error("影片設定檔的媒體資料已損壞。");
    const blob = file.slice(offset, offset + size, descriptor.type || "application/octet-stream");
    offset += size;
    return new File([blob], descriptor.name || `media-${index + 1}`, {
      type: descriptor.type || "application/octet-stream",
      lastModified: Number(descriptor.lastModified) || Date.now(),
    });
  });
  if (offset !== file.size) throw new Error("影片設定檔包含無法辨識的資料。");
  return { metadata: manifest.metadata, binaries };
}

export { projectFilename };
