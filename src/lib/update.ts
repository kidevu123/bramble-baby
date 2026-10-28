import { registerSW } from 'virtual:pwa-register'

/** App build identity, stamped by Vite at build time. */
export const BUILD = { version: __APP_VERSION__, sha: __BUILD_SHA__, date: __BUILD_DATE__ }

type Listener = (ready: boolean) => void
const listeners = new Set<Listener>()
let ready = false
let apply: ((reload?: boolean) => Promise<void>) | null = null

const CHECK_EVERY_MS = 15 * 60_000

/**
 * Registers the service worker and checks for a new build on launch, when the app comes back to the
 * foreground, and every 15 minutes. iPhone home-screen apps only look for updates on their own when
 * relaunched, which is how a phone can sit on an old build for days.
 */
export function startUpdateWatch(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  apply = registerSW({
    immediate: true,
    onNeedRefresh() {
      ready = true
      listeners.forEach((l) => l(true))
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => void registration.update().catch(() => undefined)
      setInterval(check, CHECK_EVERY_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })
}

export function onUpdateReady(listener: Listener): () => void {
  listeners.add(listener)
  listener(ready)
  return () => listeners.delete(listener)
}

/** Activate the waiting build and reload. */
export async function applyUpdate(): Promise<void> {
  if (apply) await apply(true)
  else window.location.reload()
}
