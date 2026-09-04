const SHELL_CACHE_NAME = /* __SHELL_CACHE_NAME__ */ "choir-shell-v1";
const PRECACHE_MANIFEST = /* __PRECACHE_MANIFEST__ */ [];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE_NAME)
      .then(async (cache) => {
        if (PRECACHE_MANIFEST.length > 0) {
          await Promise.all(
            PRECACHE_MANIFEST.map((url) =>
              cache.add(url).catch((err) => {
                console.warn("SW precache skipped:", url, err);
              }),
            ),
          );
        }
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== SHELL_CACHE_NAME) {
              return caches.delete(cacheName);
            }
            return undefined;
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Never intercept /sw.js itself so updates are always retrieved directly from network.
  if (url.pathname === "/sw.js") {
    return;
  }

  // Do not intercept any API requests. Operational data and offline metadata are handled
  // explicitly via IndexedDB in the client application.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 1. Navigation requests: Network-first, fallback to cached document (/index.html).
  // Never cache URLs with search query parameters (e.g. ?token=...) to avoid unbounded
  // cache growth and prevent persisting sensitive signed tokens into Cache Storage keys.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            void caches.open(SHELL_CACHE_NAME).then((cache) => {
              void cache.put("/index.html", responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE_NAME);
          const cachedResponse = (await cache.match("/index.html")) || (await cache.match("/"));
          if (cachedResponse) {
            return cachedResponse;
          }
          return new Response(
            "<!doctype html><html><body><p>You are currently offline.</p></body></html>",
            {
              headers: { "Content-Type": "text/html; charset=utf-8" },
              status: 503,
              statusText: "Offline",
            },
          );
        }),
    );
    return;
  }

  // 2. Static application assets: Cache-first with network fallback.
  const isStaticAsset =
    url.pathname.startsWith("/assets/") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".woff2");

  if (isStaticAsset) {
    event.respondWith(
      caches.open(SHELL_CACHE_NAME).then(async (cache) => {
        const cached = (await cache.match(request)) || (await cache.match(url.pathname));
        if (cached) {
          return cached;
        }
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.status === 200) {
            void cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          return new Response(null, { status: 404 });
        }
      }),
    );
    return;
  }
});
