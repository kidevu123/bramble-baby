/**
 * The screenshots in docs/screenshots (shown in the README): a made-up baby, Leo, with a week of made-up entries on the
 * mock stack. Never run against a real Baby Buddy; nothing real goes in these pictures.
 *   node e2e/readme-shots.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack (the companion with BRAMBLE_PRINTER unset or a file printer).
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './docs/screenshots'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const SCHEME = process.argv[4] === 'dark' ? 'dark' : 'light'
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this script writes made-up entries. Use the isolated stack from docs/DEVELOPMENT.md.`)
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const at = (daysBack, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() - daysBack); d.setHours(h, m, 0, 0); return d }
const BORN = 49

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: SCHEME })
await ctx.addInitScript(() => {
  if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml', weight: 'lb', length: 'in', temp: 'f' } }))
})
const page = await ctx.newPage()
const settle = (ms = 800) => page.waitForTimeout(ms)
const shot = (name) => page.screenshot({ path: `${OUT}/${name}${SCHEME === 'dark' ? '-dark' : ''}.jpg`, type: 'jpeg', quality: 82 })

await page.goto(BASE + '/signin')
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1200)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Leo')
  await page.getByLabel('Birth date or due date').fill(ymd(at(BORN, 12)))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
}
await settle(1000)
const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
const post = (path, data) => page.request.post(BASE + path, { headers, data: { child: child.id, ...data } })
await page.request.put(`${BASE}/bramble/settings/${child.id}`, { headers, data: { sex: 'male', weightGoalGPerDay: 25, pumps: [{ name: 'Spectra', minutes: 20 }, { name: 'Medela', minutes: 20 }], pumpsDecided: 2 } })

// A made-up week: bottles every three hours, diapers, a night and three naps a day, pumping, and a weighing every
// other day.
const now = new Date()
const past = (d) => d.getTime() < now.getTime() - 20 * 60_000
for (let d = 6; d >= 0; d--) {
  for (const [h, ml] of [[1, 90], [4, 85], [7, 100], [10, 95], [13, 100], [16, 90], [19, 105], [22, 95]]) {
    const s = at(d, h, 10)
    if (past(s)) await post('/api/feedings/', { start: s.toISOString(), end: new Date(s.getTime() + 20 * 60_000).toISOString(), type: 'breast milk', method: 'bottle', amount: ml + (d % 3) * 5, notes: '', tags: [] })
  }
  for (const [h, wet, solid] of [[2, true, false], [6, true, true], [9, true, false], [12, true, false], [15, false, true], [18, true, false], [21, true, false]]) {
    const t = at(d, h, 30)
    if (past(t)) await post('/api/changes/', { time: t.toISOString(), wet, solid, color: '', amount: null, notes: '', tags: [] })
  }
  for (const [h0, m0, h1, m1, nap] of [[8, 0, 9, 30, true], [11, 15, 12, 45, true], [14, 30, 16, 0, true], [17, 30, 18, 10, true]]) {
    const s = at(d, h0, m0)
    const e = at(d, h1, m1)
    if (past(e)) await post('/api/sleep/', { start: s.toISOString(), end: e.toISOString(), nap, notes: '', tags: [] })
  }
  const ns = at(d + 1, 22, 30)
  const ne = d === 0 && at(0, 6, 0).getTime() > now.getTime() - 60 * 60_000 ? new Date(now.getTime() - 60 * 60_000) : at(d, 6, 0)
  if (past(ne)) await post('/api/sleep/', { start: ns.toISOString(), end: ne.toISOString(), nap: false, notes: '', tags: [] })
  for (const [h, ml, pump] of [[3, 120, 'Spectra'], [7, 140, 'Spectra'], [11, 110, 'Medela'], [15, 100, 'Spectra'], [19, 115, 'Medela'], [23, 95, 'Spectra']]) {
    const s = at(d, h)
    if (past(s)) await post('/api/pumping/', { start: s.toISOString(), end: new Date(s.getTime() + 20 * 60_000).toISOString(), amount: ml, notes: '', tags: [`pump:${pump}`] })
  }
}
let lb = 7.1
for (let d = BORN; d >= 0; d -= 3) {
  const t = at(d, 8, 40)
  if (past(t)) await post('/api/weight/', { weight: Math.round(lb * 100) / 100, date: ymd(t), notes: '8:40 AM' })
  lb += 0.2 + ((d % 5) - 2) * 0.012
}
// The stash: the fridge, the freezer, and one bottle out on the counter.
const milk = (h, back, ml, location) => page.request.post(BASE + '/bramble/milk', { headers, data: { child: child.id, pumped_at: at(back, h).toISOString(), volume_ml: ml, location, client_key: `readme-${back}-${h}-${ml}-${Date.now()}` } })
for (const [h, back, ml, loc] of [[7, 1, 140, 'fridge'], [11, 1, 110, 'fridge'], [3, 0, 120, 'fridge'], [19, 2, 115, 'fridge'], [7, 9, 150, 'freezer'], [11, 12, 130, 'freezer'], [3, 15, 120, 'freezer'], [7, 20, 140, 'freezer']]) await milk(h, back, ml, loc)
const recent = new Date(now.getTime() - 50 * 60_000)
await page.request.post(BASE + '/bramble/milk', { headers, data: { child: child.id, pumped_at: recent.toISOString(), volume_ml: 90, location: 'room', client_key: `readme-room-${Date.now()}` } })

await page.goto(BASE + '/')
await settle(1800)
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 1500 }).catch(() => {})
await shot('home')

await page.goto(BASE + '/reports')
await settle(1500)
await page.getByRole('tab', { name: 'Day' }).click().catch(() => {})
await page.getByRole('button', { name: 'Previous day' }).click().catch(() => {})
await settle(1200)
await shot('reports-day')

await page.getByRole('tab', { name: 'Summary' }).click()
await settle(500)
await page.getByRole('button', { name: 'Growth', exact: true }).click()
await settle(1200)
await page.getByRole('tab', { name: 'Growth chart' }).click().catch(() => {})
await settle(1000)
await shot('growth-chart')

await page.getByRole('button', { name: 'Pumping', exact: true }).click()
await settle(1500)
await page.getByTestId('pump-compare').scrollIntoViewIfNeeded().catch(() => {})
await settle(500)
await page.getByTestId('pump-compare').screenshot({ path: `${OUT}/pumping${SCHEME === 'dark' ? '-dark' : ''}.jpg`, type: 'jpeg', quality: 82 })

await page.goto(BASE + '/milk')
await settle(1800)
await shot('stash')

await page.locator('.bag-row').first().click()
await settle(700)
await page.getByRole('button', { name: 'Reprint label' }).click()
await settle(2500)
await shot('label')

await page.goto(BASE + '/settings')
await settle(1500)
await shot('settings')

await browser.close()
console.log(`screenshots in ${OUT}`)
