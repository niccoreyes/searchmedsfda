/**
 * Rx Builder Service Worker
 * Caches static assets and provides offline functionality with update detection
 */

// Cache version - change this value to force cache update on new deployments
const CACHE_VERSION = '3';
const CACHE_NAME = `rx-builder-v${CACHE_VERSION}`;

// Static assets to cache
// NOTE: Main app files (HTML, CSS, JS) are NOT cached to ensure users always
// get the latest UI updates. Only icons and manifest are cached.
const STATIC_ASSETS = [
  '/manifest.json',
  '/favicon.png',
  '/favicon.svg',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

// Critical app files that should never be cached - always fetch from network
const UNCACHED_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/main.js'
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

// Fetch event - network-first for app files, stale-while-revalidate for assets
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

  // NEVER cache critical app files - always fetch from network
  // This ensures users always get the latest UI updates
  if (UNCACHED_ASSETS.includes(url.pathname)) {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(request)) // Only use cache as fallback when offline
    );
    return;
  }

  // For other assets (images, fonts, etc.), use stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }

          // Update cache with new response
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });

          return networkResponse;
        })
        .catch((error) => {
          console.log('[SW] Network failed:', url.pathname, error);
        });

      // Return cached version immediately, or wait for network
      return cachedResponse || fetchPromise;
    })
  );
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
