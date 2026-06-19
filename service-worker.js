// ═══════════════════════════════════════════════════════════════════════════
//  Study Tracker — Service Worker
//
//  Strategy:
//   • App shell (index.html, manifest, icons) + pinned Firebase SDK CDN
//     files → cached on install, served with "stale-while-revalidate"
//     (instant response from cache, silently refreshed in the background —
//     no "new version available, refresh?" prompts, ever).
//   • Firebase Auth / Firestore / Google API traffic → NEVER intercepted.
//     Those requests are left completely alone so Firestore's offline
//     persistence, write queue, and real-time sync work exactly as the
//     Firebase SDK intends.
//
//  Bump CACHE_VERSION whenever index.html (or any precached asset) changes,
//  so the next visit refreshes the cache.
// ═══════════════════════════════════════════════════════════════════════════

const CACHE_VERSION = 'v1';
const CACHE_NAME = 'study-tracker-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
  './icons/favicon.ico',
  // Pinned (versioned) Firebase SDK modules — same-version URLs never
  // change content, so caching them is safe and removes a network
  // round-trip from every cold start, online or offline.
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
];

// Hosts that must ALWAYS go straight to the network, untouched.
// Intercepting these breaks Firebase Auth popups, Firestore's streaming
// channel, and its offline write queue.
const NETWORK_ONLY_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'accounts.google.com',
  'apis.google.com',
  'www.googleapis.com',
  'oauth2.googleapis.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' }))
            .catch((err) => console.warn('[SW] precache failed:', url, err))
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

function isCacheableRequest(url) {
  return url.origin === self.location.origin || url.hostname === 'www.gstatic.com';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;            // never intercept writes

  const url = new URL(req.url);
  if (NETWORK_ONLY_HOSTS.includes(url.hostname)) return; // Firebase traffic — hands off
  if (!isCacheableRequest(url)) return;                  // anything else — pass through

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached); // offline + not cached yet → nothing we can do
        // Stale-while-revalidate: serve cache immediately if we have it,
        // otherwise wait on the network.
        return cached || network;
      })
    )
  );
});

// Lets the page ask a waiting worker to activate immediately if it ever
// wants to (not used automatically — we already skipWaiting on install —
// but kept available for manual control without ever showing a popup).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
