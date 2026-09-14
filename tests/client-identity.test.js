import test from "node:test";
import assert from "node:assert/strict";

test("browser identity is random, stable and persisted locally", async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const module = await import(`../js/client-identity.js?test=${Date.now()}`);
  const first = module.getClientId();
  const second = module.getClientId();
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.equal(second, first);
  assert.equal(values.get("yumeew.client-id.v1"), first);
  assert.deepEqual(module.clientIdentityHeaders(), { "X-YuMeew-Client-ID": first });
  delete globalThis.localStorage;
});
