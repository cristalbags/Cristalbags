const CACHE_VERSION = "cb-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/main.js",
  "./data/products.json",
  "./video/hero.mp4"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k.startsWith("cb-") && k !== STATIC_CACHE) ? caches.delete(k) : null)))
      .then(() => self.clients.claim())
  );
});

function isImage(request){
  return request.destination === "image" || /\.(png|jpe?g|webp|gif|svg)$/i.test(new URL(request.url).pathname);
}
function isMedia(request){
  return request.destination === "video" || /\.(mp4|webm)$/i.test(new URL(request.url).pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if(req.method !== "GET") return;

  const url = new URL(req.url);

  // Only handle same-origin
  if(url.origin !== self.location.origin) return;

  // Images & media: cache-first (best for repeat visitors)
  if(isImage(req) || isMedia(req)){
    event.respondWith(
      caches.match(req).then((cached) => {
        if(cached) return cached;
        return fetch(req).then((resp) => {
          const copy = resp.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
          return resp;
        });
      })
    );
    return;
  }

  // HTML/CSS/JS: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
        return resp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
