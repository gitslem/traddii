/*
 * Traddii push service worker. It only shows forward-test alerts sent by the
 * server runner and opens the Strategies page when one is clicked. It does no
 * caching, so it never changes how the site loads.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Traddii', body: event.data ? event.data.text() : '' }
  }
  const title = typeof data.title === 'string' ? data.title : 'Traddii'
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : '',
    // The same tag as the in-tab alert for the same event, so it shows once
    tag: typeof data.tag === 'string' ? data.tag : undefined,
    icon: '/favicon.svg',
    data: { url: '/strategies' }
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/strategies', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find(w => w.url.startsWith(self.location.origin))
    if (open) {
      await open.focus()
      if ('navigate' in open) await open.navigate(url)
      return
    }
    await self.clients.openWindow(url)
  })())
})
