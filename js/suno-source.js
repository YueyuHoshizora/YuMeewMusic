import { clientIdentityHeaders } from "./client-identity.js";

export const SUNO_PROXY_URL = "https://model-proxy.yustellar.idv.tw/suno/resolve";
export const SUNO_MAX_AUDIO_BYTES = 300 * 1024 * 1024;

function base64Bytes(value) {
  try { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
  catch { throw Error("Suno 播放授權格式不正確。"); }
}

export async function decryptSunoAudio(blob, result) {
  const rights = result.playbackRights;
  if (!rights?.key || !rights?.iv || !rights?.glt || !result.songId) throw Error("無法取得這首歌的公開播放授權。");
  const text = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", text.encode(rights.glt));
  const userKey = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
  const unwrap = async value => {
    const wrapped = base64Bytes(value);
    if (wrapped.length <= 12) throw Error("Suno 播放授權內容不完整。");
    return new Uint8Array(await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: wrapped.slice(0, 12),
      additionalData: text.encode(result.songId),
    }, userKey, wrapped.slice(12)));
  };
  const [rawKey, iv] = await Promise.all([unwrap(rights.key), unwrap(rights.iv)]);
  if (iv.length !== 16) throw Error("Suno 音訊初始向量格式不正確。");
  const contentKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-CTR" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-CTR", counter: iv, length: 128 }, contentKey, await blob.arrayBuffer());
  const bytes = new Uint8Array(decrypted);
  if (bytes.length < 12 || String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp") throw Error("Suno 音訊解密後不是可辨識的 M4A。");
  return new Blob([bytes], { type: "audio/mp4" });
}

export async function readSunoAudioResponse(response, { maxBytes = SUNO_MAX_AUDIO_BYTES, onProgress = () => {}, allowEncryptedBinary = false } = {}) {
  if (!response.ok) throw Error(`音樂下載失敗（${response.status}）`);
  const contentType = response.headers.get("Content-Type") || "";
  const encryptedBinary = allowEncryptedBinary && /^application\/octet-stream(?:;|$)/i.test(contentType);
  if (!/^audio\//i.test(contentType) && !encryptedBinary) throw Error("取得的內容不是可播放的音樂檔案。");
  const contentLength = Number(response.headers.get("Content-Length")) || 0;
  if (contentLength > maxBytes) throw Error(`音樂檔案超過 ${Math.round(maxBytes / 1024 ** 2)} MB，已停止下載。`);
  if (!response.body) return response.blob();
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw Error(`音樂檔案超過 ${Math.round(maxBytes / 1024 ** 2)} MB，已停止下載。`);
    }
    chunks.push(value);
    onProgress({ received, total: contentLength, percent: contentLength ? Math.round(received / contentLength * 100) : null });
  }
  return new Blob(chunks, { type: contentType || "audio/mp4" });
}

export async function resolveSunoAudio(url, { onProgress } = {}) {
  const response = await fetch(SUNO_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...clientIdentityHeaders() },
    body: JSON.stringify({ url }),
  });
  const metadata = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(metadata.error || metadata.message || `分享連結解析失敗（${response.status}）`);
  const encrypted = await readSunoAudioResponse(await fetch(metadata.audioUrl, { cache: "no-store" }), {
    onProgress,
    allowEncryptedBinary: Boolean(metadata.encrypted),
  });
  const blob = metadata.encrypted ? await decryptSunoAudio(encrypted, metadata) : encrypted;
  return { blob, metadata };
}
