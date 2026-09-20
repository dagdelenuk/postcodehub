// PostcodeHub service worker: lets the site install as an app and keeps it usable on a flaky connection.
//  - Pages: network first (data changes), falling back to the last copy you visited, then to /offline/.
//  - Built assets and images: cache first (file names are hashed, so they never change).
//  - Everything else on this site: stale-while-revalidate.
//  - Other sites (live TfL, Environment Agency, weather, map tiles) are never touched, so live data is always live.
// Bump VERSION to drop every old cache on the next visit.
const VERSION = "v1";
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;
const MAX_PAGES = 60;
const PRECACHE = ["/offline/", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE && key !== PAGE_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key); // oldest first
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      // ?highlight= pages share one HTML file, so key on the path alone to avoid caching the same page repeatedly.
      cache.put(new URL(request.url).pathname, response.clone()).then(() => trimCache(PAGE_CACHE, MAX_PAGES));
    }
    return response;
  } catch {
    const cached = await cache.match(new URL(request.url).pathname);
    return cached || (await caches.match("/offline/")) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(STATIC_CACHE)).put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || refresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Sign-in and the CMS must always hit the network.
  if (["/auth", "/callback"].includes(url.pathname) || url.pathname.startsWith("/admin")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
  } else if (url.pathname.startsWith("/_astro/") || url.pathname.startsWith("/images/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/logos/")) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});
