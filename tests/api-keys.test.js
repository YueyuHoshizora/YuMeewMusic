import test from "node:test";
import assert from "node:assert/strict";
import { API_KEY_STORAGE_KEY, deleteApiKey, getApiKey, listApiKeys, maskApiKey, saveApiKey } from "../js/api-keys.js";

function createStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test("API keys keep only the first and last three characters visible", () => {
  assert.equal(maskApiKey("abc123456xyz"), "abc******xyz");
  assert.equal(maskApiKey("123456"), "******");
  assert.equal(maskApiKey(""), "");
});

test("API keys save to localStorage, list safely and delete individually", () => {
  globalThis.localStorage = createStorage();
  assert.equal(saveApiKey("paid-model", "付費模型", "  abc123456xyz  "), true);
  assert.equal(getApiKey("paid-model").value, "abc123456xyz");
  assert.deepEqual(listApiKeys().map(key => [key.id, key.label]), [["paid-model", "付費模型"]]);
  assert.match(localStorage.getItem(API_KEY_STORAGE_KEY), /abc123456xyz/);
  assert.equal(deleteApiKey("paid-model"), true);
  assert.equal(getApiKey("paid-model"), null);
});
