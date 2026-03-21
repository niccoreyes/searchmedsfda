/**
 * Rx Builder Service Worker
 * Caches static assets and provides offline functionality with update detection
 */

// Cache version - change this value to force cache update on new deployments
const CACHE_VERSION = '2';
const CACHE_NAME = `rx-builder-v${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/main.js',
  '/manifest.json',
  '/favicon.png',
  '/favicon.svg',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      // Force activation - don't wait for tabs to close
      return self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches and claim clients
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    }).then(() => {
      // Notify all clients that a new version is active
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'SW_ACTIVATED',
            version: CACHE_VERSION
          });
        });
      });
    })
  );
});

// Fetch event - stale-while-revalidate strategy with update detection
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip cross-origin requests
  if (!request.url.startsWith(self.location.origin)) {
    return;
  }

  const url = new URL(request.url);
  const isAsset = url.pathname.match(/\.(html|js|css|json)$/);
  const isRoot = url.pathname === '/' || url.pathname === '/index.html';

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      // Always fetch in background to check for updates
      const fetchPromise = fetch(request, { cache: 'no-cache' })
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }

          // Clone for cache update
          const responseToCache = networkResponse.clone();

          // For assets, check if content changed
          if ((isAsset || isRoot) && cachedResponse) {
            // Compare by content length first (fast)
            const cachedLen = cachedResponse.headers.get('content-length');
            const networkLen = networkResponse.headers.get('content-length');

            if (cachedLen && networkLen && cachedLen !== networkLen) {
              console.log('[SW] Update detected (size change):', url.pathname);
              notifyUpdateAvailable();
            } else if (!cachedLen || !networkLen) {
              // Fallback: compare actual content
              Promise.all([
                cachedResponse.clone().text(),
                networkResponse.clone().text()
              ]).then(([cachedText, networkText]) => {
                if (cachedText !== networkText) {
                  console.log('[SW] Update detected (content change):', url.pathname);
                  notifyUpdateAvailable();
                }
              }).catch(() => {});
            }
          }

          // Update cache with new response
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });

          return networkResponse;
        })
        .catch((error) => {
          console.log('[SW] Network failed:', url.pathname, error);
          // Return cached response on network failure
        });

      // Return cached version immediately (stale-while-revalidate)
      if (cachedResponse) {
        return cachedResponse;
      }

      // Wait for network if not in cache
      return fetchPromise;
    })
  );
});

// Track if we've already notified about an update
let updateNotified = false;

function notifyUpdateAvailable() {
  if (updateNotified) return;
  updateNotified = true;

  self.clients.matchAll({ type: 'window' }).then((clients) => {
    clients.forEach((client) => {
      client.postMessage({
        type: 'UPDATE_AVAILABLE',
        message: 'A new version is available. Refresh to update.'
      });
    });
  });
}

// Handle messages from the main app
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'DISMISS_UPDATE') {
    updateNotified = false;
  }
});
