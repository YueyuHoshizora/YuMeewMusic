const DATABASE = "yumeew-media-v1";
const STORE = "files";
const ALLOWED_KINDS = new Set(["audio", "image", "subtitle"]);

function requireKind(kind) {
  if (!ALLOWED_KINDS.has(kind)) throw Error("不支援的本機媒體類型。");
}

export function packStoredMedia(file) {
  return {
    blob: file,
    name: typeof file.name === "string" ? file.name : "stored-media",
    type: typeof file.type === "string" ? file.type : "",
    lastModified: Number.isFinite(file.lastModified) ? file.lastModified : Date.now(),
  };
}

export function unpackStoredMedia(record, FileClass = globalThis.File) {
  if (!record?.blob || typeof record.name !== "string") throw Error("保存的媒體資料無效。");
  return new FileClass([record.blob], record.name, {
    type: record.type || record.blob.type || "",
    lastModified: record.lastModified,
  });
}

function openDatabase(factory = globalThis.indexedDB) {
  if (!factory) return Promise.reject(Error("此瀏覽器不支援 IndexedDB。"));
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error("無法開啟本機媒體儲存空間。"));
    request.onblocked = () => reject(Error("本機媒體儲存空間正被其他分頁使用。"));
  });
}

async function transact(kind, mode, operation, factory) {
  requireKind(kind);
  const database = await openDatabase(factory);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || Error("本機媒體儲存失敗。"));
      transaction.onabort = () => reject(transaction.error || Error("本機媒體儲存已中止。"));
    });
  } finally {
    database.close();
  }
}

export function saveStoredMedia(kind, file, factory) {
  return transact(kind, "readwrite", store => store.put(packStoredMedia(file), kind), factory);
}

export function loadStoredMedia(kind, factory) {
  return transact(kind, "readonly", store => store.get(kind), factory);
}

export function deleteStoredMedia(kind, factory) {
  return transact(kind, "readwrite", store => store.delete(kind), factory);
}
