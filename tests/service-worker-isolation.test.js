import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync("service-worker.js", "utf8");

for (const cached of [false, true]) {
  test(`isolated workers receive COEP from ${cached ? "existing cache" : "network"}`, async () => {
    const handlers = {};
    const response = () => new Response("self.postMessage('ready')", {
      headers: { "Content-Type": "text/javascript" },
    });
    runInNewContext(source, {
      self: { location: { origin: "https://the-music.app" }, addEventListener: (type, handler) => { handlers[type] = handler; } },
      Headers, Response, URL,
      fetch: async () => response(),
      caches: {
        match: async () => cached ? response() : undefined,
        open: async () => ({ put: async () => {} }),
      },
    });
    let pending;
    handlers.fetch({
      request: { method: "GET", mode: "same-origin", destination: "worker", url: "https://the-music.app/js/music-rating-worker.js?v=build&threads=4" },
      respondWith: value => { pending = value; },
    });
    const result = await pending;
    assert.equal(result.headers.get("Cross-Origin-Embedder-Policy"), "credentialless");
    assert.equal(result.headers.get("Content-Type"), "text/javascript");
    assert.equal(await result.text(), "self.postMessage('ready')");
  });
}
