export const API_KEY_STORAGE_KEY = "yumeew-api-keys-v1";
export const API_BILLING_STORAGE_KEY = "yumeew-api-billing-v1";

const PROVIDER_LABELS = Object.freeze({
  openai: "OpenAI",
  minimax: "MiniMax",
  byteplus: "BytePlus",
  google: "Google AI Studio",
});

const LEGACY_MODEL_PROVIDERS = Object.freeze({
  "gpt-image-2.5-flare": "openai",
  "gpt-image-2.5-sunburst": "openai",
  "MiniMax-H3": "minimax",
  "dreamina-seedance-2-0-260128": "byteplus",
  "dreamina-seedance-2-5-260628": "byteplus",
  "veo-3.1-generate-preview": "google",
});

function readBillingModes() {
  try {
    const value = JSON.parse(localStorage.getItem(API_BILLING_STORAGE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function usesAccountCredits(id) { return readBillingModes()[id] === true; }

export function saveAccountCredits(id, enabled) {
  try {
    const modes = readBillingModes();
    if (enabled) modes[id] = true;
    else delete modes[id];
    localStorage.setItem(API_BILLING_STORAGE_KEY, JSON.stringify(modes));
    return true;
  } catch { return false; }
}

function readRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(API_KEY_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const normalized = {};
    let migrated = false;
    for (const [id, record] of Object.entries(parsed)) {
      if (!record || typeof record !== "object" || typeof record.value !== "string" || !record.value) continue;
      const provider = LEGACY_MODEL_PROVIDERS[id] || id;
      const savedAt = Number(record.savedAt) || 0;
      if (!normalized[provider] || savedAt >= normalized[provider].savedAt) {
        normalized[provider] = {
          label: PROVIDER_LABELS[provider] || String(record.label || provider),
          value: record.value,
          savedAt,
        };
      }
      migrated ||= provider !== id || normalized[provider].label !== record.label;
    }
    if (migrated) writeRecords(normalized);
    return normalized;
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
