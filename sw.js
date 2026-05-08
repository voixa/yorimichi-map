/* Service Worker for Machiaruki Gacha (basic offline cache) */
const CACHE = 'yorimichi-v42';
const OFFLINE_URL = './offline.html';
const ASSETS = [
  './',
  './index.html',
  './lp.html',
  './about.html',
  './offline.html',
  './style.css',
  './app.js',
  './courses.js',
  './photos.js',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))
  );
  // Force activation immediately (override old buggy SWs)
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-first for tiles + APIs (always fresh)
  if (url.hostname.includes('tile.openstreetmap') ||
      url.hostname.includes('nominatim') ||
      url.hostname.includes('overpass') ||
      url.hostname.includes('routing.openstreetmap') ||
      url.hostname.includes('upload.wikimedia.org') ||
      url.hostname.includes('basemaps.cartocdn.com')) {
    return; // let browser handle
  }

  // For navigation requests (HTML pages), fall back to offline.html if network fails
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request).then(cached => cached || caches.match(OFFLINE_URL)))
    );
    return;
  }

  // Cache-first for our app shell
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).catch(() => {
      if (event.request.destination === 'document') return caches.match(OFFLINE_URL);
      return new Response('', { status: 504 });
    }))
  );
});
