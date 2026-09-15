import test from "node:test";
import assert from "node:assert/strict";
import { API_BILLING_STORAGE_KEY, API_KEY_STORAGE_KEY, deleteApiKey, getApiKey, listApiKeys, maskApiKey, saveAccountCredits, saveApiKey, usesAccountCredits } from "../js/api-keys.js";

function createStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test("API keys keep only the first and last three characters visible with at most five stars", () => {
  assert.equal(maskApiKey("abc123456xyz"), "abc*****xyz");
  assert.equal(maskApiKey("abc1xyz"), "abc*xyz");
  assert.equal(maskApiKey("123456"), "*****");
  assert.equal(maskApiKey(""), "");
});

test("API keys save to localStorage by service provider, list safely and delete individually", () => {
  globalThis.localStorage = createStorage();
  assert.equal(saveApiKey("openai", "OpenAI", "  abc123456xyz  "), true);
  assert.equal(getApiKey("openai").value, "abc123456xyz");
  assert.deepEqual(listApiKeys().map(key => [key.id, key.label]), [["openai", "OpenAI"]]);
  assert.match(localStorage.getItem(API_KEY_STORAGE_KEY), /abc123456xyz/);
  assert.equal(deleteApiKey("openai"), true);
  assert.equal(getApiKey("openai"), null);
});

test("legacy per-model API keys migrate to the newest key for each provider", () => {
  globalThis.localStorage = createStorage();
  localStorage.setItem(API_KEY_STORAGE_KEY, JSON.stringify({
    "gpt-image-2.5-flare": { label: "GPT-Image-2.5 Flare", value: "older", savedAt: 10 },
    "gpt-image-2.5-sunburst": { label: "GPT-Image-2.5 Sunburst", value: "newer", savedAt: 20 },
    "dreamina-seedance-2-0-260128": { label: "Seedance 2.0", value: "byteplus-key", savedAt: 15 },
  }));
  assert.equal(getApiKey("openai").value, "newer");
  assert.equal(getApiKey("byteplus").value, "byteplus-key");
  assert.deepEqual(listApiKeys().map(key => [key.id, key.label]), [["byteplus", "BytePlus"], ["openai", "OpenAI"]]);
  assert.doesNotMatch(localStorage.getItem(API_KEY_STORAGE_KEY), /gpt-image|dreamina/);
});

test("account credit billing preference persists per model", () => {
  localStorage.removeItem(API_BILLING_STORAGE_KEY);
  assert.equal(usesAccountCredits("paid-model"), false);
  assert.equal(saveAccountCredits("paid-model", true), true);
  assert.equal(usesAccountCredits("paid-model"), true);
  assert.equal(saveAccountCredits("paid-model", false), true);
  assert.equal(usesAccountCredits("paid-model"), false);
});
