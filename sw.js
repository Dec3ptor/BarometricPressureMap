// Service worker: keeps the app shell available offline. Online, files are
// always revalidated with the server so updates show up straight away.
// Weather data and map tiles always come from the network (the app caches
// data itself).

const VERSION = 'bpm-v4';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js', 'js/api.js', 'js/store.js', 'js/units.js', 'js/analysis.js', 'js/ui.js', 'js/wx.js',
  'js/gauge.js', 'js/charts.js', 'js/pressure-layer.js', 'js/cities.js', 'js/world-data.js',
  'js/ads.js', 'js/report-data.js', 'js/report-export.js', 'js/views/report.js',
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

// Same-origin files: network first (revalidated), cached copy when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      try {
        const res = await fetch(e.request, { cache: 'no-cache' });
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        const cached = await cache.match(e.request, { ignoreSearch: true });
        return cached || Response.error();
      }
    }),
  );
});
