const CACHE = 'deshchotreba-static-v1'
const OFFLINE = '/offline.html'
const STATIC = [OFFLINE, '/brand/pwa-192.png', '/brand/pwa-512.png', '/brand/pwa-maskable-512.png']
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)))
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('deshchotreba-static-') && key !== CACHE).map(key => caches.delete(key)))))
})
self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)))
  } else if (STATIC.includes(url.pathname) && !url.search) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)))
  }
})
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* generic notification */ }
  let url = '/notifications'
  try {
    const candidate = new URL(typeof data.url === 'string' ? data.url : url, self.location.origin)
    if (candidate.origin === self.location.origin && /^https?:$/.test(candidate.protocol)) url = candidate.pathname + candidate.search + candidate.hash
  } catch { /* use notifications */ }
  const title = typeof data.title === 'string' ? data.title.slice(0, 100) : 'ДещоТреба'
  const body = typeof data.body === 'string' ? data.body.slice(0, 200) : 'У вас нове сповіщення.'
  event.waitUntil(self.registration.showNotification(title, { body, icon: '/brand/pwa-192.png', data: { url } }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const candidate = new URL(event.notification.data?.url || '/notifications', self.location.origin)
  const url = candidate.origin === self.location.origin ? candidate.href : new URL('/notifications', self.location.origin).href
  event.waitUntil(clients.openWindow(url))
})
