// NTH SHELF V2.79.02 — ONE-SEARCH LOCAL CONSENSUS FAST PATH

const CACHE_NAME = "nth-shelf-shell-2.79.02";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/db.js",
  "./js/library.js",
  "./js/panels.js",
  "./js/panels-frame-envelope.js",
  "./js/panels-geometry-orthogonal.js",
  "./js/panels-geometry-skewed.js",
  "./js/panels-geometry.js",
  "./js/bubbles.js",
  "./js/page-turn.js",
  "./js/reader.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./assets/nth-shelf-empty.png",
  "./assets/nth-shelf-dystopian-shelf.jpg",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL_FILES).catch((err) => {
        // Don't fail install if the CDN is briefly unreachable; retry on next fetch.
        console.warn("Shell precache partial failure:", err);
      })
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.ok && (req.url.startsWith(self.location.origin) || req.url.includes("cdnjs.cloudflare.com"))) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
