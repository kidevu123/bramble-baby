/** Verifies installable-PWA basics: manifest, icons, service worker control, offline app shell, push handler. */
import { chromium, devices } from 'playwright'
const BASE = process.argv[2] ?? 'http://localhost:4173'
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined })
const ctx = await browser.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()
const out = {}
await page.goto(BASE + '/', { waitUntil: 'load' })
const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href')
const manifest = await (await page.request.get(new URL(manifestHref, BASE).href)).json()
out.manifest = { name: manifest.name, display: manifest.display, start_url: manifest.start_url, icons: manifest.icons?.map((i) => `${i.sizes}${i.purpose ? '/' + i.purpose : ''}`) }
for (const i of manifest.icons ?? []) out[`icon ${i.sizes}`] = (await page.request.get(new URL(i.src, BASE).href)).status()
out.metaThemeColor = await page.locator('meta[name="theme-color"]').count()
out.appleCapable = await page.getAttribute('meta[name="apple-mobile-web-app-capable"]', 'content')
out.viewportFit = (await page.getAttribute('meta[name="viewport"]', 'content'))?.includes('viewport-fit=cover')
// Wait for the service worker to take control.
await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller !== null, null, { timeout: 20000 }).catch(() => null)
if (!(await page.evaluate(() => Boolean(navigator.serviceWorker?.controller)))) { await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500) }
out.swController = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller))
out.swScope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope ?? null)
out.pushManager = await page.evaluate(() => 'PushManager' in window)
const swText = await (await page.request.get(BASE + '/sw.js')).text()
out.swHandlesPush = /addEventListener\(\s*["'`]push["'`]/.test(swText)
out.swHandlesClick = /notificationclick/.test(swText)
// Offline: the app shell must still load from the precache.
await ctx.setOffline(true)
await page.goto(BASE + '/reports', { waitUntil: 'load' }).catch(() => null)
out.offlineShellTitle = await page.title()
out.offlineHasRoot = await page.locator('#root *').count().then((n) => n > 0)
await ctx.setOffline(false)
// Notifications permission flow (granted context) → local notification path works.
const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 800 } })
await ctx2.grantPermissions(['notifications'], { origin: BASE })
const p2 = await ctx2.newPage()
await p2.goto(BASE + '/', { waitUntil: 'load' })
await p2.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller !== null, null, { timeout: 20000 }).catch(() => null)
out.notificationPermission = await p2.evaluate(() => Notification.permission)
out.localShowNotification = await p2.evaluate(async () => {
  try { const reg = await navigator.serviceWorker.ready; await reg.showNotification('Bramble test', { body: 'ok', tag: 't' }); const list = await reg.getNotifications(); return list.length > 0 } catch (e) { return 'error: ' + e.message }
})
out.pushSubscribe = await p2.evaluate(async () => {
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' }); return sub.endpoint.slice(0, 40) + '…' } catch (e) { return 'error: ' + e.message }
})
await browser.close()
console.log(JSON.stringify(out, null, 1))
