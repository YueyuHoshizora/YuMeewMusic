const DATABASE = 'yumeew-ai-models-v1';
const STORE = 'model-files';

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
