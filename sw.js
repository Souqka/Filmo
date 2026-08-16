/* Service worker: кэш оболочки приложения и постеров TMDB. */
const CACHE_NAME = 'filmo-v1';
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './config.js',
    './manifest.json',
    './assets/placeholder.svg',
    './assets/favicon.svg',
    './assets/icon-192.png',
    './assets/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
            .catch(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const isPoster = url.hostname === 'image.tmdb.org';
    const isApp = url.origin === self.location.origin;

    if (!isPoster && !isApp) return;

    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((response) => {
                if (response && (response.ok || response.type === 'opaque')) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
                }
                return response;
            }).catch(() => cached || (isApp ? caches.match('./index.html') : undefined));
        })
    );
});
