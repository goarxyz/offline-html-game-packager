const DOCUMENT_CACHE = "offline-arcade-documents-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.includes("/offline-html-game-packager/play/")) return;

  event.respondWith((async () => {
    const cache = await caches.open(DOCUMENT_CACHE);
    const response = await cache.match(event.request.url);
    if (response) return response;
    return new Response("<!doctype html><title>Game unavailable</title><h1>Game unavailable</h1><p>Return to the library and launch the game again.</p>", {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  })());
});