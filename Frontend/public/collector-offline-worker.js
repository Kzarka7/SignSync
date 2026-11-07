const cacheName = 'signsync-collector-offline-v1'

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    if (url.pathname !== '/dataset-collector' && url.pathname !== '/dataset-collector/') return
    event.respondWith(fetch(request).catch(async error => {
      const shell = await (await caches.open(cacheName)).match('/index.html')
      if (!shell) throw error
      return shell
    }))
    return
  }
  if (!url.pathname.startsWith('/assets/') && !url.pathname.startsWith('/vision/')) return
  // Build files are fixed bytes. Module requests can send different headers
  // from the requests used to populate the cache.
  event.respondWith((async () =>
    (await (await caches.open(cacheName)).match(request, { ignoreVary: true })) ?? fetch(request))())
})
