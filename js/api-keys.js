export const API_KEY_STORAGE_KEY = "yumeew-api-keys-v1";

function readRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(API_KEY_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, record]) => (
      record && typeof record === "object" && typeof record.value === "string" && record.value
    )));
  } catch {
    return {};
  }
}

function writeRecords(records) {
  try {
    localStorage.setItem(API_KEY_STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

export function maskApiKey(value) {
  const key = String(value || "");
  if (!key) return "";
  if (key.length <= 6) return "*".repeat(Math.min(key.length, 5));
  return `${key.slice(0, 3)}${"*".repeat(Math.min(key.length - 6, 5))}${key.slice(-3)}`;
}

export function listApiKeys() {
  return Object.entries(readRecords())
    .map(([id, record]) => ({
      id,
      label: typeof record.label === "string" && record.label ? record.label : id,
      value: record.value,
      savedAt: Number(record.savedAt) || 0,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-Hant"));
}

export function getApiKey(id) {
  const record = readRecords()[id];
  return record ? { id, ...record } : null;
}

export function saveApiKey(id, label, value) {
  const normalizedId = String(id || "").trim();
  const normalizedValue = String(value || "").trim();
  if (!normalizedId || !normalizedValue) return false;
  const records = readRecords();
  records[normalizedId] = {
    label: String(label || normalizedId),
    value: normalizedValue,
    savedAt: Date.now(),
  };
  return writeRecords(records);
}

export function deleteApiKey(id) {
  const records = readRecords();
  if (!Object.hasOwn(records, id)) return true;
  delete records[id];
  return writeRecords(records);
}
