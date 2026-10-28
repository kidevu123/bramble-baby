/**
 * Walks Settings › Hatch scale through every state against the mock stack and saves a screenshot of each.
 * It is also a probe: it exits non-zero when a step does not behave (see `check`).
 *
 *   node e2e/mock-babybuddy.mjs 8000 &  node e2e/mock-hatch.mjs 8231 &
 *   BRAMBLE_PORT=8100 BRAMBLE_DB=/tmp/b.db BRAMBLE_VAPID_DIR=/tmp BABYBUDDY_URL=http://127.0.0.1:8000 \
 *     BRAMBLE_HATCH_URL=http://127.0.0.1:8231 python3 server/bramble_server.py &
 *   BB_UPSTREAM=http://127.0.0.1:8000 BRAMBLE_UPSTREAM=http://127.0.0.1:8100 npm run dev &
 *   node e2e/hatch-shots.mjs ./e2e/out/hatch http://localhost:5173 http://127.0.0.1:8231 light
 *
 * Start from a fresh mock stack for each theme (the script creates the child and types two weights by hand).
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/hatch'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const HATCH = process.argv[4] ?? 'http://127.0.0.1:8231'
const THEME = process.argv[5] === 'dark' ? 'dark' : 'light'
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
const mock = (body) => fetch(`${HATCH}/__mock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const sheet = () => page.locator('dialog[open]')
const view = () => sheet().locator('.conn-sheet').getAttribute('data-hatch-view')
// A sync runs on the companion's own thread: wait until the sheet (and the Settings row behind it) stop saying it is checking.
const idle = async () => { await settle(400); await page.waitForFunction(() => !document.querySelector('dialog[open] .conn-sync .btn[aria-busy]') && !/Checking Hatch/.test(document.body.innerText), null, { timeout: 15000 }); await settle(300) }
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

await mock({ reset: true })
await page.goto(BASE + '/')
await page.waitForURL(/\/signin/)
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(800)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Oscar')
  await page.getByLabel('Birth date or due date').fill(day(24))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
}
await settle(1500) // the app records the household's storage units on first load

const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
// Two weights typed by hand before Hatch is connected: one is the same weighing Hatch has (12 days ago), one is not in Hatch.
for (const [n, lb] of [[12, 5.95], [18, 5.56]]) await page.request.post(BASE + '/api/weight/', { headers, data: { child: child.id, weight: lb, date: day(n), notes: '' } })
const weights = async () => (await (await page.request.get(`${BASE}/api/weight/?child=${child.id}&limit=100`, { headers })).json()).results

// ---- Settings row, not connected
await page.goto(BASE + '/settings')
await settle(900)
const row = page.getByRole('button', { name: /Hatch scale/ })
check('Settings › Tracking has a Hatch scale row', await row.count() === 1, (await row.innerText()).replace(/\n/g, ' · '))
await shot('01-settings-row')

// ---- Sign in
await row.click()
await settle(600)
check('sheet opens on the sign-in view', (await view()) === 'signin')
check('Sign in is disabled until both fields are filled', await sheet().getByRole('button', { name: 'Sign in to Hatch' }).isDisabled())
await shot('02-signin-empty')
await sheet().getByLabel('Hatch email').fill('owner@example.com')
await sheet().getByLabel('Hatch password').fill('not-the-password')
await sheet().getByLabel('Hatch password').focus()
await shot('03-signin-filled-focus')
await sheet().getByRole('button', { name: 'Sign in to Hatch' }).click()
await sheet().getByRole('alert').waitFor()
check('a wrong password is explained in words', /did not accept that email and password/.test(await sheet().getByRole('alert').innerText()))
await shot('04-signin-wrong-password')
await sheet().getByLabel('Hatch password').fill('hatch')
await sheet().getByRole('button', { name: 'Sign in to Hatch' }).click()
await page.waitForFunction(() => document.querySelector('dialog[open] .conn-sheet')?.getAttribute('data-hatch-view') === 'connected', null, { timeout: 15000 })
await idle()

// ---- Connected
const stats = (await sheet().locator('.conn-stats').innerText()).replace(/\n/g, ' ')
check('first import: 5 Hatch weighings imported, the hand-typed day left alone', /5 weights imported/.test(stats) && /1 already in Bramble/.test(stats), stats)
check('one baby and one child are mapped without asking', /Oscar on Hatch is Oscar in Bramble/.test(await sheet().locator('.conn-map-line').innerText()))
const after = await weights()
check('Baby Buddy holds 7 weights: 2 typed + 5 from Hatch, none doubled', after.length === 7 && after.filter((w) => w.date === day(12)).length === 1, `${after.length} entries`)
const fromHatch = after.filter((w) => w.notes.startsWith('Hatch Grow scale'))
check('imported entries are in pounds with a Hatch note', fromHatch.length === 5 && fromHatch.every((w) => w.weight > 5 && w.weight < 7), fromHatch.map((w) => `${w.weight} "${w.notes}"`).join(' | '))
await shot('05-connected')
await shot('05-connected-full', { fullPage: false })
await sheet().getByText('Connection report').click()
await settle(300)
await sheet().locator('.conn-report').scrollIntoViewIfNeeded()
await shot('06-connected-report')
await sheet().getByText('Connection report').click()

// ---- A new weighing arrives
await mock({ weigh: 3190 })
await sheet().getByRole('button', { name: 'Sync now' }).click()
await idle()
check('Sync now brings in a new weighing', /6 weights imported/.test((await sheet().locator('.conn-stats').innerText()).replace(/\n/g, ' ')))
await sheet().getByRole('button', { name: 'Sync now' }).click()
await idle()
check('syncing again does not double it', (await weights()).length === 8)

// ---- Weights appear where weights already appear
await sheet().getByLabel('Close').click()
await settle(400)
check('the Settings row shows the count', /6 weights imported/.test(await row.innerText()), (await row.innerText()).replace(/\n/g, ' · '))
await shot('07-settings-row-connected')
await page.goto(BASE + '/child')
await settle(1200)
await page.locator('.growth-history').scrollIntoViewIfNeeded()
check('the Child page lists the imported weights', await page.locator('.growth-row').count() >= 5)
await shot('08-child-weights')

// ---- Unrecognised answer from Hatch
await mock({ listKey: 'weightList', weigh: 3200 })
await page.goto(BASE + '/settings')
await settle(700)
await row.click()
await settle(500)
await sheet().getByRole('button', { name: 'Sync now' }).click()
await sheet().locator('.conn-problem.error').waitFor({ timeout: 15000 })
await idle()
check('an unrecognised answer is a plain-language problem', /not in the form Bramble expects/.test(await sheet().locator('.conn-problem').innerText()))
const report = await sheet().locator('.conn-report-text').innerText()
check('the report names the route, the status and the keys Hatch sent', /pagedRefresh\/v1\/fetch\/501/.test(report) && /-> 200 shape/.test(report) && /weightList\[/.test(report))
check('the report holds no token and no email', !/owner@example\.com/.test(report) && !/NDMyMT/.test(report))
await shot('09-problem-unrecognised')
await sheet().locator('.conn-report').scrollIntoViewIfNeeded()
await shot('10-problem-report')
await page.goto(BASE + '/settings')
await settle(700)
check('the Settings row says it needs attention', /Needs attention/.test(await row.innerText()))
await shot('11-settings-row-attention')
await mock({ listKey: 'weights' })
await row.click()
await settle(500)
await sheet().getByRole('button', { name: 'Sync now' }).click()
await page.waitForFunction(() => !document.querySelector('dialog[open] .conn-problem'), null, { timeout: 15000 })
await idle()
check('once the answer is readable again the problem clears and the weighing is imported', /7 weights imported/.test((await sheet().locator('.conn-stats').innerText()).replace(/\n/g, ' ')))

// ---- A passing hiccup (shown, but nothing for the owner to do): stub the status the sheet reads
await page.route('**/bramble/hatch', async (route) => {
  if (route.request().method() !== 'GET') return route.continue()
  const res = await route.fetch()
  const body = await res.json()
  await route.fulfill({ response: res, json: { ...body, problem: { code: 'hatch_unreachable', message: 'Bramble could not reach Hatch. It will keep trying.', at: new Date().toISOString() } } })
})
await page.goto(BASE + '/settings')
await settle(700)
await row.click()
await sheet().locator('.conn-problem.warn').waitFor({ timeout: 10000 })
await settle(600) // let the sheet finish sliding in
await shot('12-hiccup')
await page.unroute('**/bramble/hatch')

// ---- Hatch ends the session
await mock({ expire: true })
await page.goto(BASE + '/settings')
await settle(700)
await row.click()
await settle(500)
await sheet().getByRole('button', { name: 'Sync now' }).click()
await page.waitForFunction(() => document.querySelector('dialog[open] .conn-sheet')?.getAttribute('data-hatch-view') === 'signin-again', null, { timeout: 15000 })
await settle(400)
check('an ended session asks to sign in again', /Hatch signed Bramble out/.test(await sheet().locator('.conn-band').innerText()))
await shot('13-signin-again')
await page.goto(BASE + '/settings')
await settle(700)
check('the Settings row says Sign in again', /Sign in again/.test(await row.innerText()))
await shot('14-settings-row-signin-again')
await row.click()
await settle(500)
await sheet().getByLabel('Hatch password').fill('hatch')
await sheet().getByRole('button', { name: 'Sign in again' }).click()
await page.waitForFunction(() => document.querySelector('dialog[open] .conn-sheet')?.getAttribute('data-hatch-view') === 'connected', null, { timeout: 15000 })
await idle()
check('signing in again resumes without importing anything twice', (await weights()).length === 9, `${(await weights()).length} entries`)

// ---- Disconnect
await sheet().getByRole('button', { name: 'Disconnect' }).click()
await settle(300)
await sheet().locator('.conn-confirm').scrollIntoViewIfNeeded()
await shot('15-disconnect-confirm')
await sheet().locator('.conn-confirm').getByRole('button', { name: 'Disconnect' }).click()
await page.waitForFunction(() => document.querySelector('dialog[open] .conn-sheet')?.getAttribute('data-hatch-view') === 'signin', null, { timeout: 15000 })
check('Disconnect returns to the sign-in view and keeps the imported weights', (await weights()).length === 9)

// ---- Two babies in the Hatch account: the owner chooses
await mock({ babies: 2 })
await sheet().getByLabel('Hatch email').fill('owner@example.com')
await sheet().getByLabel('Hatch password').fill('hatch')
await sheet().getByRole('button', { name: 'Sign in to Hatch' }).click()
await page.waitForFunction(() => document.querySelector('dialog[open] .conn-sheet')?.getAttribute('data-hatch-view') === 'choose', null, { timeout: 15000 })
await settle(400)
check('with two Hatch babies nothing is imported until the owner chooses', (await weights()).length === 9)
await shot('16-choose-child')
await sheet().getByLabel('Bramble child for Nico').selectOption('0')
await settle(600)
await sheet().getByLabel('Bramble child for Oscar').selectOption(String(child.id))
await page.waitForFunction(() => document.querySelector('dialog[open] .conn-sheet')?.getAttribute('data-hatch-view') === 'connected', null, { timeout: 15000 })
await idle()
check('after choosing, the same weights are recognised and nothing is doubled', (await weights()).length === 9, `${(await weights()).length} entries`)
await shot('17-chosen')

// ---- No horizontal overflow at 320
await page.setViewportSize({ width: 320, height: 640 })
await settle(400)
check('no horizontal overflow at 320 px', await page.evaluate(() => { const d = document.querySelector('dialog[open] .sheet-body'); return d.scrollWidth <= d.clientWidth + 1 }))
await shot('18-connected-320')

await browser.close()
const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed (${THEME})`)
console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : 'NO CONSOLE PROBLEMS')
process.exit(failed.length || problems.length ? 1 : 0)
