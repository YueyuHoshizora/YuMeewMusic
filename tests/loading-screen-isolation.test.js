import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync("js/loading-screen.js", "utf8");

async function loadPage({ controlled = true, isolated = false, storage = new Map(), path = "/music-rating.html" } = {}) {
  let reloads = 0;
  const handlers = {};
  const serviceWorker = {
    controller: controlled ? {} : null,
    addEventListener: (type, handler) => { handlers[type] = handler; },
    removeEventListener: type => { delete handlers[type]; },
    register: async () => ({ addEventListener() {}, update: async () => {} }),
  };
  runInNewContext(source, {
    document: { readyState: "complete", getElementById: () => null },
    navigator: { serviceWorker },
    location: { hostname: "the-music.app", pathname: path, reload: () => { reloads++; } },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    crossOriginIsolated: isolated,
  });
  await new Promise(resolve => setImmediate(resolve));
  return { reloads: () => reloads, claim: () => { serviceWorker.controller = {}; handlers.controllerchange?.(); } };
}

test("an already controlled rating page retries isolation once, not forever", async () => {
  const storage = new Map([["music-rating-isolation-reload", "1"]]);
  const first = await loadPage({ storage });
  assert.equal(first.reloads(), 1);
  const retry = await loadPage({ storage });
  retry.claim();
  assert.equal(retry.reloads(), 0);
  await loadPage({ storage, isolated: true });
  const laterVisit = await loadPage({ storage });
  assert.equal(laterVisit.reloads(), 1);
});

test("first installation reloads only after a controller claims the rating page", async () => {
  const page = await loadPage({ controlled: false });
  assert.equal(page.reloads(), 0);
  page.claim();
  page.claim();
  assert.equal(page.reloads(), 1);
});

test("isolated rating pages and other tools do not automatically reload", async () => {
  for (const options of [{ isolated: true }, { path: "/index.html" }]) {
    const page = await loadPage(options);
    page.claim();
    assert.equal(page.reloads(), 0);
  }
});
