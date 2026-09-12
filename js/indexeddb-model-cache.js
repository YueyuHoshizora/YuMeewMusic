const DATABASE = 'yumeew-ai-models-v1';
const STORE = 'model-files';
const MODEL_LABELS = {
  'bgkb/bs_polarformer': 'BS PolarFormer',
  'csukuangfj/sherpa-onnx-spleeter-2stems': 'Spleeter 2-stems',
  'onnx-community/whisper-tiny_timestamped': 'Whisper Tiny',
  'onnx-community/whisper-base_timestamped': 'Whisper Base',
  'onnx-community/whisper-small_timestamped': 'Whisper Small',
};

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error('無法開啟 AI 模型儲存空間。'));
    request.onblocked = () => reject(Error('AI 模型儲存空間正被其他分頁使用。'));
  });
}

function cacheKey(request) {
  return request instanceof Request ? request.url : String(request);
}

export function cachedModelIdentity(key) {
  const text = String(key);
  try {
    const url = new URL(text);
    const parts = url.pathname.split('/').filter(Boolean);
    const resolveAt = parts.indexOf('resolve');
    if (url.hostname === 'huggingface.co' && resolveAt >= 2) {
      const repository = `${parts[resolveAt - 2]}/${parts[resolveAt - 1]}`;
      return {
        id: `huggingface:${repository}`,
        name: MODEL_LABELS[repository] || parts[resolveAt - 1].replaceAll('_', ' '),
        source: repository,
      };
    }
    const directory = `${url.origin}${url.pathname.slice(0, Math.max(1, url.pathname.lastIndexOf('/') + 1))}`;
    return { id: directory, name: url.pathname.split('/').filter(Boolean).at(-2) || url.hostname, source: url.hostname };
  } catch {
    return { id: text, name: text, source: '瀏覽器模型快取' };
  }
}

export function groupCachedModelFiles(files) {
  const groups = new Map();
  for (const file of files) {
    const identity = cachedModelIdentity(file.key);
    const group = groups.get(identity.id) || { ...identity, size: 0, fileCount: 0, savedAt: 0, keys: [] };
    group.size += Math.max(0, Number(file.size) || 0);
    group.fileCount += 1;
    group.savedAt = Math.max(group.savedAt, Number(file.savedAt) || 0);
    group.keys.push(file.key);
    groups.set(identity.id, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

async function transaction(mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error('AI 模型 IndexedDB 操作失敗。'));
      tx.onabort = () => reject(tx.error || Error('AI 模型 IndexedDB 寫入中止。'));
    });
  } finally {
    database.close();
  }
}

export const indexedDbModelCache = {
  async match(request) {
    const stored = await transaction('readonly', store => store.get(cacheKey(request)));
    if (!stored?.blob) return undefined;
    return new Response(stored.blob, {
      status: stored.status || 200,
      statusText: stored.statusText || 'OK',
      headers: stored.headers || [],
    });
  },

  async put(request, response, progressCallback) {
    const total = Number(response.headers.get('Content-Length')) || 0;
    const blob = await response.blob();
    progressCallback?.({ loaded: blob.size, total: total || blob.size, progress: 100 });
    await transaction('readwrite', store => store.put({
      blob,
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      savedAt: Date.now(),
    }, cacheKey(request)));
  },
};

export async function listCachedModels() {
  if (!globalThis.indexedDB) throw Error('此瀏覽器不支援 IndexedDB。');
  const database = await openDatabase();
  try {
    const files = await new Promise((resolve, reject) => {
      const result = [];
      const tx = database.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        result.push({
          key: cursor.key,
          size: cursor.value?.blob?.size || 0,
          savedAt: cursor.value?.savedAt || 0,
        });
        cursor.continue();
      };
      request.onerror = () => reject(request.error || Error('無法讀取模型清單。'));
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || Error('模型清單讀取中止。'));
    });
    return groupCachedModelFiles(files);
  } finally {
    database.close();
  }
}

export async function deleteCachedModel(keys) {
  if (!globalThis.indexedDB) throw Error('此瀏覽器不支援 IndexedDB。');
  const uniqueKeys = [...new Set(Array.isArray(keys) ? keys : [])];
  if (!uniqueKeys.length) return;
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const key of uniqueKeys) store.delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || Error('無法刪除模型。'));
      tx.onabort = () => reject(tx.error || Error('模型刪除中止。'));
    });
  } finally {
    database.close();
  }
}

export async function deleteAllCachedModels() {
  if (!globalThis.indexedDB) throw Error('此瀏覽器不支援 IndexedDB。');
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || Error('無法刪除全部模型。'));
      tx.onabort = () => reject(tx.error || Error('全部模型刪除中止。'));
    });
  } finally {
    database.close();
  }
}

export async function loadModelBytes(url, { legacyCacheName = '', onStatus = () => {} } = {}) {
  if (!globalThis.indexedDB) {
    onStatus('此瀏覽器不支援 IndexedDB，模型只供本次使用。');
    const response = await fetch(url);
    if (!response.ok) throw Error(`AI 模型下載失敗（HTTP ${response.status}）。`);
    return new Uint8Array(await response.arrayBuffer());
  }

  try {
    const stored = await indexedDbModelCache.match(url);
    if (stored) {
      onStatus('正在從 IndexedDB 讀取共用 AI 模型…');
      return new Uint8Array(await stored.arrayBuffer());
    }
  } catch {
    onStatus('IndexedDB 模型儲存暫時不可用，正在直接載入…');
  }

  if (legacyCacheName && globalThis.caches) {
    try {
      const legacy = await caches.open(legacyCacheName);
      const stored = await legacy.match(url);
      if (stored) {
        onStatus('正在將既有模型移到共用 IndexedDB…');
        const bytes = new Uint8Array(await stored.arrayBuffer());
        await indexedDbModelCache.put(url, new Response(bytes));
        await legacy.delete(url);
        return bytes;
      }
    } catch {}
  }

  onStatus('首次下載 AI 模型；完成後會自動保存在共用 IndexedDB…');
  const response = await fetch(url);
  if (!response.ok) throw Error(`AI 模型下載失敗（HTTP ${response.status}）。`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  try {
    await indexedDbModelCache.put(url, new Response(bytes, { headers: response.headers }));
  } catch {
    onStatus('模型已下載，但 IndexedDB 空間不足，本次仍會繼續。');
  }
  return bytes;
}
