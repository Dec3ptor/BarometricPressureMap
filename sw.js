// Service worker: keeps the app shell available offline and loads it
// instantly. Weather data and map tiles always come from the network
// (the app caches data itself).

const VERSION = 'bpm-v1';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js', 'js/api.js', 'js/store.js', 'js/units.js', 'js/analysis.js', 'js/ui.js', 'js/wx.js',
  'js/gauge.js', 'js/charts.js', 'js/pressure-layer.js', 'js/cities.js',
  'js/views/home.js', 'js/views/location.js', 'js/views/map.js', 'js/views/world.js', 'js/views/learn.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/chartjs/chart.umd.js',
  'assets/fonts/inter-latin-wght-normal.woff2',
  'assets/icon.svg', 'assets/icon-192.png', 'assets/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Same-origin files: serve from cache, refresh in the background.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
