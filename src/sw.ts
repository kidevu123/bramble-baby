/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { createHandlerBoundToURL } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

// Activation waits for the SKIP_WAITING message from UpdateBanner so a page never mixes old and new assets.
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// SPA navigation fallback, but never for Django/companion paths.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api/, /^\/login/, /^\/logout/, /^\/admin/, /^\/static/, /^\/media/, /^\/bramble/, /^\/user/, /^\/jsi18n/],
  }),
)

registerRoute(({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com', new CacheFirst({ cacheName: 'fonts' }))

interface PushPayload {
  title?: string
  body?: string
  tag?: string
  url?: string
  child?: number
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {}
  try {
    data = event.data ? (event.data.json() as PushPayload) : {}
  } catch {
    data = { body: event.data?.text() }
  }
  const title = data.title ?? 'Bramble'
  const url = data.url ?? '/'
  // A "Log now" button where the platform shows one (Chrome/Android). iOS web apps show none
  // (Notification.maxActions is 0 there), so the tap itself opens the right sheet.
  const actions = url.includes('?log=') && typeof Notification !== 'undefined' && (Notification as unknown as { maxActions?: number }).maxActions ? [{ action: 'log', title: 'Log now' }] : []
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body ?? '',
      tag: data.tag ?? 'bramble',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url },
      actions,
      // Re-alert if the same tag fires again (e.g. nap window near → now).
      renotify: true,
    } as NotificationOptions),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // The "Log now" action and a plain tap go to the same place: the URL names the sheet to open.
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          void client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})

// The push service rotated our subscription (it happens on iOS after updates). Re-subscribe with the
// same server key; the app re-registers the new endpoint with the companion the next time it opens.
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as ExtendableEvent & { oldSubscription?: PushSubscription | null; newSubscription?: PushSubscription | null }
  const key = e.oldSubscription?.options.applicationServerKey
  if (!key || e.newSubscription) return
  e.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(() => undefined))
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
