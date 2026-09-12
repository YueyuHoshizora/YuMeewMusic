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

