/**
 * Settings › Notifications with the data-driven reminders, and the push-tap hand-off into a log sheet,
 * against the mock stack. Saves screenshots and exits non-zero when a step does not behave.
 *
 *   node e2e/mock-babybuddy.mjs 8000 &
 *   BRAMBLE_PORT=8100 BRAMBLE_DB=/tmp/b.db BRAMBLE_VAPID_DIR=/tmp BABYBUDDY_URL=http://127.0.0.1:8000 python3 server/bramble_server.py &
 *   BB_UPSTREAM=http://127.0.0.1:8000 BRAMBLE_UPSTREAM=http://127.0.0.1:8100 npm run dev &
 *   node e2e/nudges.mjs ./e2e/out/nudges http://localhost:5173 light
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/nudges'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const THEME = process.argv[4] === 'dark' ? 'dark' : 'light'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: THEME })
const page = await ctx.newPage()
const problems = []
const checks = []
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push('console: ' + m.text().slice(0, 300)) })
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
const shot = (name, opts = {}) => page.screenshot({ path: `${OUT}/${name}-${THEME}.png`, ...opts })
const settle = (ms = 500) => page.waitForTimeout(ms)
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }
const sheet = () => page.locator('dialog[open]')
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString()

await page.goto(BASE + '/')
await page.waitForURL(/\/signin/)
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(800)
const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
{
  // Fresh child every run so the plan below is computed from exactly these entries.
  const kids = await (await page.request.get(BASE + '/api/children/', { headers })).json()
  for (const c of kids.results ?? []) await page.request.delete(`${BASE}/api/children/${c.slug}/`, { headers })
  await page.goto(BASE + '/')
  await settle(1000)
}
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Oscar')
  const bd = new Date(); bd.setDate(bd.getDate() - 24)
  await page.getByLabel('Birth date or due date').fill(bd.toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
}
await settle(1200)
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
// What the household logged: three bottles about three hours apart, two pumps, three diapers, one sleep.
for (const h of [8.8, 5.9, 2.9]) await page.request.post(BASE + '/api/feedings/', { headers, data: { child: child.id, start: hoursAgo(h), end: hoursAgo(h - 0.25), type: 'breast milk', method: 'bottle', amount: 60 } })
for (const h of [6, 3]) await page.request.post(BASE + '/api/pumping/', { headers, data: { child: child.id, start: hoursAgo(h), end: hoursAgo(h - 0.3), amount: 45 } })
for (const [h, wet] of [[9, true], [5, true], [1.5, false]]) await page.request.post(BASE + '/api/changes/', { headers, data: { child: child.id, time: hoursAgo(h), wet, solid: !wet, color: '', amount: null } })
await page.request.post(BASE + '/api/sleep/', { headers, data: { child: child.id, start: hoursAgo(7), end: hoursAgo(5.5), nap: true } })
// A registered phone, so the server plans something (it never plans for nobody).
await page.request.post(BASE + '/bramble/push/subscribe', { headers, data: { subscription: { endpoint: 'https://push.example/probe', keys: { p256dh: 'k', auth: 'a' } }, child: child.id } })

// ---- Settings › Notifications
await page.goto(BASE + '/settings')
await settle(900)
const row = page.getByRole('button', { name: /Notifications/ })
check('Settings › Tracking has the Notifications row', (await row.count()) === 1, (await row.innerText()).replace(/\n/g, ' · '))
await row.click()
await settle(1500)
const nudges = sheet().getByTestId('nudge-settings')
check('the sheet shows the grouped reminders', (await nudges.count()) === 1)
const text = (await nudges.innerText()).replace(/\n/g, ' · ')
for (const title of ['Feeding due', 'Pump due', 'Milk expiring', 'No wet diaper', 'Evening summary', 'Weight from the Hatch', 'Pumping down', 'When the other person logs', 'Quiet hours']) check(`row: ${title}`, text.toLowerCase().includes(title.toLowerCase()))
check('feeding plan is computed from the logged bottles', /Next: .*Every 2 h 5\d min lately, from 3 feeds|Quiet hours · Every 2 h 5\d min lately/.test(text), text.match(/Feeding due[^·]*·[^·]*·?[^·]*/)?.[0])
check('pump plan names the cadence and the target', /Every 3 h lately, from 2 sessions · to every phone/.test(text), text.match(/Pump due[^·]*·[^·]*/)?.[0])
check('diaper check names its threshold', /After 6 h without one · ignores quiet hours/.test(text))
check('summary names its time', /Every day at 8:00 PM/.test(text))
check('quiet hours default 10 PM to 7 AM', /between 10:00 PM and 7:00 AM/.test(text))
check('switches are real switches', (await nudges.getByRole('switch').count()) === 8)
// How each reminder decides waits behind one disclosure, so the switches and their plans come first.
const how = nudges.locator('details', { hasText: 'How each one works' })
check('the explanations are folded away by default', (await how.count()) === 1 && !(await how.evaluate((d) => d.open)) && !/One push per gap/.test(text))
await how.locator('summary').click()
await settle(300)
const howText = (await how.innerText()).replace(/\n/g, ' · ')
check('opening it explains each reminder', /One push per gap/.test(howText) && /Comes through in quiet hours/.test(howText) && /Never to the phone that logged it/.test(howText), howText.slice(0, 200))
await how.locator('summary').click()
check('pings between caregivers are off by default', (await nudges.getByRole('switch', { name: 'When the other person logs' }).getAttribute('aria-checked')) === 'false')
check('the supply watch says what it is waiting for', /Watching the last 3 days against the 11 before · 0 of 11 days logged so far, needs 5/.test(text), text.match(/Pumping down[^·]*·[^·]*/)?.[0])
await shot('01-notifications-sheet')
await nudges.getByTestId('nudge-status').scrollIntoViewIfNeeded()
await settle(400)
await shot('02-notifications-sheet-quiet-hours')
await nudges.getByRole('switch', { name: 'Feeding due' }).scrollIntoViewIfNeeded()
await settle(300)

// Toggle a nudge off: the server confirms, the plan line says Off.
await nudges.getByRole('switch', { name: 'Feeding due' }).click()
await settle(900)
check('feeding switch turns off', (await nudges.getByRole('switch', { name: 'Feeding due' }).getAttribute('aria-checked')) === 'false')
const status = await (await page.request.get(`${BASE}/bramble/nudges/${child.id}`, { headers })).json()
check('the server stored the switch', status.settings.feed === false && status.settings.units?.volume, JSON.stringify(status.settings))
check('no feeding reminder is planned while off', status.next.feed?.note === 'Off', JSON.stringify(status.next.feed))
// Pings between caregivers: on, the server says who else there is to tell (one phone in this stack: nobody).
await nudges.getByRole('switch', { name: 'When the other person logs' }).click()
await settle(900)
const statusPings = await (await page.request.get(`${BASE}/bramble/nudges/${child.id}`, { headers })).json()
check('the pings switch reaches the server and the plan says there is nobody else to tell', statusPings.settings.activity === true && /Only one phone has notifications on/.test(statusPings.next.activity?.note ?? ''), JSON.stringify(statusPings.next.activity))
// Pump cadence override.
await nudges.getByRole('tab', { name: '3 h' }).click()
await settle(900)
const status2 = await (await page.request.get(`${BASE}/bramble/nudges/${child.id}`, { headers })).json()
check('pump cadence override reaches the server', status2.settings.pumpEveryMinutes === 180, String(status2.settings.pumpEveryMinutes))
check('the pump plan now says it is set in Settings', /set in Settings/.test(status2.next.pump?.note ?? ''), status2.next.pump?.note)
await shot('03-notifications-sheet-changed')
await nudges.getByRole('switch', { name: 'Feeding due' }).click()
await settle(600)

// Inbox lists the computed ones without a delete button.
await page.goto(BASE + '/')
await settle(900)
await page.getByRole('button', { name: /inbox|notifications/i }).first().click()
await settle(900)
const inbox = (await sheet().innerText()).replace(/\n/g, ' · ')
check('inbox shows the planned nudges', /Pump due|Feeding due|Evening summary/.test(inbox), inbox.slice(0, 200))
await shot('04-inbox')
await sheet().getByLabel('Close').click()
await settle(400)

// ---- Push tap hand-off: the service worker opens /?log=bottle; the app strips it and opens the bottle sheet.
await page.goto(BASE + '/?log=bottle')
await settle(1500)
check('the address is cleaned at once', new URL(page.url()).search === '', page.url())
const title = await sheet().locator('h2, .sheet-title').first().innerText().catch(() => '')
check('the bottle sheet is open', /feeding|bottle/i.test(title), title)
await shot('05-push-tap-bottle')
await page.reload()
await settle(1200)
check('a reload does not reopen it', (await sheet().count()) === 0)
await page.goto(BASE + '/?log=pumping')
await settle(1500)
check('pumping opens the pumping sheet', /pumping/i.test(await sheet().locator('h2, .sheet-title').first().innerText().catch(() => '')))
await page.goto(BASE + '/?log=nothing')
await settle(1200)
check('an unknown kind just lands on Home', new URL(page.url()).search === '' && (await sheet().count()) === 0)

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed (${THEME})`)
if (problems.length) console.log('PROBLEMS:\n' + [...new Set(problems)].join('\n'))
await browser.close()
process.exit(failed.length || problems.length ? 1 : 0)
