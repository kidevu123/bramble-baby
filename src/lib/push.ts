import { companion } from './api/companion'

export type PushSupport = 'ok' | 'insecure' | 'unsupported' | 'ios-needs-install'

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
}

/** Why push may not be available on this device, in one word the UI can explain. */
export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return 'insecure'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'ios-needs-install' : 'unsupported'
  }
  if (isIos() && !isStandalone()) return 'ios-needs-install'
  return 'ok'
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function bytesEqual(a: ArrayBuffer | ArrayBufferView | null | undefined, b: Uint8Array): boolean {
  if (!a) return false
  const av = a instanceof ArrayBuffer ? new Uint8Array(a) : new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  if (av.length !== b.length) return false
  for (let i = 0; i < av.length; i++) if (av[i] !== b[i]) return false
  return true
}

/** "apple", "google", "mozilla", "microsoft" or the endpoint's host: tells us which push service a device uses. */
export function pushProvider(endpoint: string): string {
  try {
    const host = new URL(endpoint).host
    if (host.endsWith('push.apple.com')) return 'Apple'
    if (host.includes('fcm.googleapis.com') || host.includes('android.googleapis.com')) return 'Google'
    if (host.includes('mozilla.com')) return 'Mozilla'
    if (host.includes('notify.windows.com')) return 'Microsoft'
    return host
  } catch {
    return 'unknown'
  }
}

/** Wait for the service worker, but never forever (dev mode has no SW; a stuck SW must not hang the UI). */
async function readyRegistration(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sw-timeout')), timeoutMs))
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null
  const reg = await readyRegistration()
  return reg.pushManager.getSubscription()
}

/**
 * Ask for permission. Must be called straight from a tap handler: iOS only grants the prompt inside a
 * user gesture, and React Query mutations run a few microtasks later, which is enough to lose it on
 * some Safari builds. Returns the resulting permission.
 */
export function requestPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return Promise.resolve('denied')
  if (Notification.permission === 'granted') return Promise.resolve('granted')
  try {
    const result = Notification.requestPermission()
    // Old Safari used a callback API and returned undefined.
    return result instanceof Promise ? result : new Promise((resolve) => Notification.requestPermission(resolve))
  } catch {
    return Promise.resolve('denied')
  }
}

/**
 * Subscribe with the server's current VAPID key and register the subscription. If the browser still
 * holds a subscription made with an older server key (e.g. the companion was reinstalled) it is
 * dropped and recreated, otherwise the push service answers 403 forever.
 */
export async function enablePush(child: number | null): Promise<PushSubscription> {
  const support = pushSupport()
  if (support !== 'ok') throw new Error(support)
  const permission = await requestPermission()
  if (permission !== 'granted') throw new Error('denied')
  const reg = await readyRegistration()
  const { publicKey } = await companion.push.vapidPublicKey()
  if (!publicKey) throw new Error('server-push-unconfigured')
  const key = urlBase64ToUint8Array(publicKey)
  let sub = await reg.pushManager.getSubscription()
  if (sub && !bytesEqual(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => undefined)
    sub = null
  }
  sub =
    sub ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key as unknown as BufferSource,
    }))
  await companion.push.subscribe(sub.toJSON(), child)
  return sub
}

/**
 * Re-register the browser's current subscription with the server (idempotent upsert). Cheap, and it
 * heals the two silent failure modes: a server database that was reset, and a subscription the push
 * service rotated behind our back (pushsubscriptionchange while the app was closed).
 */
export async function syncSubscription(child: number | null): Promise<boolean> {
  const sub = await currentSubscription().catch(() => null)
  if (!sub || Notification.permission !== 'granted') return false
  try {
    await companion.push.subscribe(sub.toJSON(), child)
    return true
  } catch {
    return false
  }
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await companion.push.unsubscribe(sub.endpoint).catch(() => undefined)
  await sub.unsubscribe()
}

/** Local, in-app notification (works while the app is open, even without push). */
export async function showLocalNotification(title: string, body: string, tag = 'bramble'): Promise<boolean> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false
  try {
    const reg = await readyRegistration()
    await reg.showNotification(title, { body, tag, icon: '/icons/icon-192.png', data: { url: '/' } })
    return true
  } catch {
    return false
  }
}

/**
 * Take Bramble's delivered notifications off the phone's notification list (the lock screen and Notification
 * Centre). They pile up there otherwise: a web app's notifications stay until each is tapped or swiped. Called when
 * the app is opened or comes to the front (whatever they said is on Home or in the Inbox by then) and from the
 * Inbox's Clear. Returns how many were closed; 0 where the browser cannot list them.
 */
export async function clearDeliveredNotifications(): Promise<number> {
  try {
    if (!('serviceWorker' in navigator)) return 0
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg || typeof reg.getNotifications !== 'function') return 0
    const shown = await reg.getNotifications()
    for (const n of shown) n.close()
    return shown.length
  } catch {
    return 0
  }
}

/** Clear them now and every time the app comes back to the front. Call once at start-up. */
export function clearNotificationsOnOpen(): void {
  void clearDeliveredNotifications()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void clearDeliveredNotifications()
  })
}

const INBOX_CLEARED = 'bramble.inbox-cleared'

/** When this phone last cleared the Inbox's "Recently sent" (an ISO time), or '' when it never did. */
export function inboxClearedAt(): string {
  try {
    return localStorage.getItem(INBOX_CLEARED) ?? ''
  } catch {
    return ''
  }
}

/** Remember that everything sent up to `now` has been cleared on this phone. The server's own record stays (it is what keeps a note from going out twice). */
export function markInboxCleared(now = new Date()): string {
  const at = now.toISOString()
  try {
    localStorage.setItem(INBOX_CLEARED, at)
  } catch {
    /* private mode: cleared for this visit only */
  }
  return at
}

/** The sent reminders still to show: those sent after the last Clear, newest first, at most `limit`. */
export function recentlySent<T extends { at: string; sent: boolean }>(reminders: T[], clearedAt: string, limit = 10): T[] {
  const after = clearedAt ? new Date(clearedAt).getTime() : -Infinity
  return reminders
    .filter((r) => r.sent && new Date(r.at).getTime() > after)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
}
