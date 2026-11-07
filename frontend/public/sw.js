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
async function isCurrentBinding(binding) {
  try {
    const response = await fetch('/api/push/binding', { method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ binding }) })
    return response.ok && (await response.json()).active === true
  } catch { return false }
}
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { return }
  if (typeof data.binding !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.binding)) return
  let url = '/notifications'
  try {
    const candidate = new URL(typeof data.url === 'string' ? data.url : url, self.location.origin)
    if (candidate.origin === self.location.origin && /^https?:$/.test(candidate.protocol)) url = candidate.pathname + candidate.search + candidate.hash
  } catch { /* use notifications */ }
  event.waitUntil((async () => {
    if (!await isCurrentBinding(data.binding)) return
    await self.registration.showNotification('ДещоТреба', { body: 'У вас нове сповіщення.', icon: '/brand/pwa-192.png', data: { url, binding: data.binding } })
    if (!await isCurrentBinding(data.binding)) {
      const shown = await self.registration.getNotifications()
      shown.filter(notification => notification.data?.binding === data.binding).forEach(notification => notification.close())
    }
  })())
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const candidate = new URL(event.notification.data?.url || '/notifications', self.location.origin)
  const url = candidate.origin === self.location.origin ? candidate.href : new URL('/notifications', self.location.origin).href
  event.waitUntil((async () => {
    if (await isCurrentBinding(event.notification.data?.binding)) await clients.openWindow(url)
  })())
})
