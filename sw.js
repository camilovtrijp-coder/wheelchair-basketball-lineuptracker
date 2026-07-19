// Minimale service worker: cache-first voor de app shell, zodat de app
// blijft werken zonder verbinding (sporthallen met slechte/geen wifi).
// Cachet alleen eigen bestanden, geen CDN's.
//
// __CACHE_VERSION__ wordt door de Netlify build (zie netlify.toml) vervangen
// door een hash van index.html/manifest.json/icons/sw.js, zodat de cachenaam
// automatisch verandert zodra een van die bestanden wijzigt — geen
// handmatige versie-ophoging meer nodig. Bij lokaal testen zonder build-stap
// blijft de placeholder letterlijk staan; dat werkt functioneel prima, het
// is dan alleen geen "verse" naam.
var CACHE_NAME = "lineup-tracker-__CACHE_VERSION__";
var APP_SHELL = [
  "index.html",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) {
            return key !== CACHE_NAME;
          })
          .map(function (key) {
            return caches.delete(key);
          })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return (
        cached ||
        fetch(event.request).then(function (response) {
          if (response && response.ok) {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, copy);
            });
          }
          return response;
        })
      );
    })
  );
});
