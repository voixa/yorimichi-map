/* Service Worker for Machiaruki Gacha
 * - Cache-first for app shell
 * - Stale-while-revalidate for OSM tiles & Wikimedia photos
 * - Network-first for navigation (HTML)
 * - Network-only for API/Nominatim/Overpass/OSRM (always fresh)
 */
const CACHE = 'yorimichi-v134';
const TILE_CACHE = 'yorimichi-tiles-v44';
const PHOTO_CACHE = 'yorimichi-photos-v44';
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
  './og.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// Cache size limits (Stale-while-revalidate caches)
const TILE_MAX = 200;
const PHOTO_MAX = 50;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))
  );
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
      Promise.all(
        keys
          .filter(k => k !== CACHE && k !== TILE_CACHE && k !== PHOTO_CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Limit cache size
async function trimCache(cacheName, max) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > max) {
      // 古い順から削除
      for (let i = 0; i < keys.length - max; i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch {}
}

// Stale-while-revalidate: 即キャッシュ返し、裏でネットワーク取得
async function staleWhileRevalidate(req, cacheName, sizeLimit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then(res => {
    if (res && res.ok) {
      cache.put(req, res.clone()).then(() => trimCache(cacheName, sizeLimit));
    }
    return res;
  }).catch(() => null);
  return cached || (await networkPromise) || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const req = event.request;

  // 1. API (always network) - never cache
  if (url.hostname.includes('yorimichi-api')) {
    return;
  }

  // 2. OSRM / Nominatim / Overpass - always network
  if (url.hostname.includes('routing.openstreetmap') ||
      url.hostname.includes('nominatim') ||
      url.hostname.includes('overpass')) {
    return;
  }

  // 3. OSM tiles / CartoDB tiles - stale-while-revalidate
  if (url.hostname.includes('tile.openstreetmap') ||
      url.hostname.includes('basemaps.cartocdn.com') ||
      url.hostname.includes('tile.opentopomap')) {
    event.respondWith(staleWhileRevalidate(req, TILE_CACHE, TILE_MAX));
    return;
  }

  // 4. Wikimedia photos - stale-while-revalidate
  if (url.hostname.includes('upload.wikimedia.org')) {
    event.respondWith(staleWhileRevalidate(req, PHOTO_CACHE, PHOTO_MAX));
    return;
  }

  // 5. Navigation (HTML) - network-first with offline fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then(cached => cached || caches.match(OFFLINE_URL))
      )
    );
    return;
  }

  // 6. App shell - cache-first
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).catch(() => {
      if (req.destination === 'document') return caches.match(OFFLINE_URL);
      return new Response('', { status: 504 });
    }))
  );
});

// Push notification (PWA)
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || '街歩きガチャ';
  const body = data.body || 'おはよう！今日の散歩しよう 🚶';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './og.png',
      badge: './og.png',
      data: { url: data.url || './' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      for (const c of clients) {
        if (c.url.includes(url) && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
