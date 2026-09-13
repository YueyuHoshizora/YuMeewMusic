const DATABASE = "yumeew-media-v1";
const STORE = "files";
const ALLOWED_KINDS = new Set(["audio", "image", "subtitle", "generated-image", "generated-video"]);
const ALLOWED_VALUE_KINDS = new Set(["image-video-project"]);
const ENTRY_DETAILS = Object.freeze({
  audio: { page: "主畫面／人聲分離", field: "音樂檔案" },
  image: { page: "主畫面", field: "背景素材" },
  subtitle: { page: "主畫面／字幕編輯器", field: "字幕檔案" },
  "generated-image": { page: "文生圖", field: "最後生成結果" },
  "generated-video": { page: "影像產生器", field: "最後生成結果" },
  "image-video-project": { page: "圖轉影片", field: "素材專案" },
});

function requireKind(kind, values = false) {
  if (!(values ? ALLOWED_VALUE_KINDS : ALLOWED_KINDS).has(kind)) throw Error("不支援的本機媒體類型。");
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

async function accessStore(mode, operation, factory) {
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

async function transact(kind, mode, operation, factory, values = false) {
  requireKind(kind, values);
  return accessStore(mode, operation, factory);
}

export function storedValueSize(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value);
  if (value instanceof Blob) return value.size;
  return Object.values(value).reduce((total, item) => total + storedValueSize(item, seen), 0);
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

export function saveStoredValue(kind, value, factory) {
  return transact(kind, "readwrite", store => store.put(value, kind), factory, true);
}

export function loadStoredValue(kind, factory) {
  return transact(kind, "readonly", store => store.get(kind), factory, true);
}

export function deleteStoredValue(kind, factory) {
  return transact(kind, "readwrite", store => store.delete(kind), factory, true);
}

export async function listStoredEntries(factory) {
  const entries = await Promise.all(Object.keys(ENTRY_DETAILS).map(async key => {
    const value = await accessStore("readonly", store => store.get(key), factory);
    if (!value) return null;
    const media = ALLOWED_KINDS.has(key);
    return {
      key,
      ...ENTRY_DETAILS[key],
      name: media ? value.name || "本機媒體" : "專案資料",
      type: media ? value.type || value.blob?.type || "" : "application/x-yumeew-project",
      size: storedValueSize(media ? value.blob : value),
      savedAt: media ? Number(value.lastModified) || 0 : Number(value.updatedAt) || 0,
    };
  }));
  return entries.filter(Boolean);
}

export function deleteStoredEntry(kind, factory) {
  if (ALLOWED_KINDS.has(kind)) return deleteStoredMedia(kind, factory);
  return deleteStoredValue(kind, factory);
}

export function deleteAllStoredEntries(factory) {
  return accessStore("readwrite", store => store.clear(), factory);
}
