const CACHE_PREFIX = "tagore-offline-";
const CACHE_NAME = CACHE_PREFIX + "v1";
const OFFLINE_PAGE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(new Request(OFFLINE_PAGE, { cache: "reload" }))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    request.mode !== "navigate" ||
    url.origin !== self.location.origin ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/")
  ) return;

  // Keep manuscripts and app code on the network. Cache only the reconnect page.
  event.respondWith(fetch(request).catch(async () => {
    const page = await caches.match(OFFLINE_PAGE, { cacheName: CACHE_NAME });
    return page ?? new Response("Tagore is offline. Reload to try again.", { status: 503 });
  }));
});
