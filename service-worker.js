const CACHE_NAME = "yumeew-static-__BUILD_VERSION__";
const STATIC_DESTINATIONS = new Set(["style", "script", "font", "image", "worker", "manifest"]);
const NAVIGABLE_PATHS = new Set(["/", "/index.html", "/account.html", "/settings.html", "/subtitle-editor.html", "/converter.html", "/video-editor.html", "/image-video.html", "/vocal-separator.html", "/music-rating.html", "/suno-tool.html", "/image-generator.html", "/video-generator.html", "/ai-mastering.html"]);

function isMusicRatingPage(url) {
  return url.pathname.endsWith("/music-rating.html");
}

function withCrossOriginIsolation(response, url, destination = "") {
  if ((!isMusicRatingPage(url) && destination !== "worker") || !response || response.type === "error") return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("yumeew-static-") && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    if (!NAVIGABLE_PATHS.has(url.pathname)) return;
    const cacheKey = new Request(`${url.origin}${url.pathname}`);
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" });
        const isolatedResponse = withCrossOriginIsolation(response, url);
        if (isolatedResponse.ok) void caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, isolatedResponse.clone()));
        return isolatedResponse;
      } catch {
        const cached = await caches.match(cacheKey);
        return cached ? withCrossOriginIsolation(cached, url) : Response.error();
      }
    })());
    return;
  }

  if (!STATIC_DESTINATIONS.has(request.destination)) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return withCrossOriginIsolation(cached, url, request.destination);
    const response = withCrossOriginIsolation(await fetch(request), url, request.destination);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
