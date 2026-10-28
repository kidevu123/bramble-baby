/**
 * A new label for the freezer (Settings › Milk labels & printer › "Print a new label for the freezer"): a bag moved
 * into the freezer prints its label again, a bag thawed out of it prints a THAWED label, a move between the counter
 * and the fridge prints nothing, and with the switch off nothing prints.
 *   node e2e/freezer-reprint.mjs <out-dir> <base-url> <label-dir> [light|dark]
 * Start from a fresh mock stack whose companion prints to files (BRAMBLE_PRINTER=file://<label-dir>).
 */
import { mkdirSync, readdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/freezer-reprint'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const LABEL_DIR = process.argv[4]
const SCHEME = process.argv[5] === 'dark' ? 'dark' : 'light'
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this probe writes entries. Use the isolated stack from docs/DEVELOPMENT.md.`)
  process.exit(2)
}
if (!LABEL_DIR) {
  console.error('Pass the folder the companion prints labels into (its BRAMBLE_PRINTER=file://… folder).')
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })
let fails = 0
const problems = []
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} [${SCHEME}] ${name}${cond || detail === undefined ? '' : ` — ${detail}`}`)
  if (!cond) fails += 1
}
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, colorScheme: SCHEME })
await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml', weight: 'lb', length: 'in', temp: 'f' } })) })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`console: ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('response', (r) => { if (r.status() >= 400 && !/\/api\/profile|\/login\//.test(r.url())) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`) })
const settle = (ms = 700) => page.waitForTimeout(ms)
let n = 0
const shot = async (name) => { n += 1; await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}-${SCHEME}.png` }) }
const sheet = () => page.locator('dialog[open]').last()
const labels = () => readdirSync(LABEL_DIR).length
const notice = () => page.getByTestId('print-notice')

await page.goto(BASE + '/signin')
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1200)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Birth date or due date').fill(ymd(new Date(Date.now() - 30 * 86_400_000)))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
}
await settle(1000)
const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
const pumped = new Date(Date.now() - 2 * 3_600_000).toISOString()
const makeBag = async (ml, key) => (await page.request.post(`${BASE}/bramble/milk`, { headers, data: { child: child.id, pumped_at: pumped, volume_ml: ml, location: 'fridge', client_key: `freeze-${key}-${Date.now()}` } })).json()
const bagNow = async (id) => (await (await page.request.get(`${BASE}/bramble/milk?child=${child.id}`, { headers })).json()).find((b) => b.id === id)
const a = await makeBag(120, 'a')
const b = await makeBag(90, 'b')
const c = await makeBag(60, 'c')

const openBag = async (bag) => {
  await page.goto(BASE + '/milk')
  await settle(1500)
  const showMore = page.locator('.stash-more')
  if (await showMore.count()) await showMore.first().click().catch(() => {})
  await page.locator('.bag-row', { hasText: bag.code }).first().click()
  await settle(600)
}
const waitSent = () => page.waitForFunction(() => /Label sent to the printer/.test(document.querySelector('[data-testid="print-notice"]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {})

// Into the freezer: the label prints again.
let before = labels()
await openBag(a)
await sheet().getByRole('button', { name: 'Move to freezer' }).click()
await waitSent()
await shot('freezer-printed')
check('moving a bag to the freezer prints its label again', labels() === before + 1, `${before} → ${labels()}`)
const sentText = await notice().innerText().catch(() => '')
check('… the notice names the bag', /Label sent to the printer/.test(sentText) && /\b120\b/.test(sentText) && new RegExp(`ID\\s+${a.code}`).test(sentText), sentText)
check('… and the bag is in the freezer', (await bagNow(a.id)).location === 'freezer')

// Out of it to thaw: a THAWED label prints.
await page.waitForFunction(() => !document.querySelector('[data-testid="print-notice"]'), null, { timeout: 12000 }).catch(() => {})
before = labels()
await openBag(a)
await sheet().getByRole('button', { name: 'Thaw in fridge' }).click()
await waitSent()
const thawed = await bagNow(a.id)
check('thawing it prints a new label (the thawed one)', labels() === before + 1 && thawed.thawed && thawed.location === 'fridge', `${before} → ${labels()}, ${JSON.stringify({ thawed: thawed.thawed, location: thawed.location })}`)

// Fridge → counter: nothing on the label changes, nothing prints.
await page.waitForFunction(() => !document.querySelector('[data-testid="print-notice"]'), null, { timeout: 12000 }).catch(() => {})
before = labels()
await openBag(b)
await sheet().getByRole('button', { name: 'Out on counter' }).click()
await settle(2500)
check('a move between the fridge and the counter prints nothing', labels() === before && (await bagNow(b.id)).location === 'room', `${before} → ${labels()}`)

// The switch in Settings › Milk labels & printer; off, nothing prints.
await page.goto(BASE + '/settings')
await settle(1200)
await page.getByRole('button', { name: /^Milk labels/ }).click()
await settle(800)
const toggle = sheet().getByRole('switch', { name: 'Print a new label for the freezer' })
check('Settings has the switch beside "Print when a pumping is saved", on by default', (await toggle.count()) === 1 && (await toggle.getAttribute('aria-checked')) === 'true')
await sheet().locator('.ls-auto').nth(1).scrollIntoViewIfNeeded()
await shot('settings-switch')
await toggle.click()
await settle(400)
check('… it turns off', (await toggle.getAttribute('aria-checked')) === 'false')
before = labels()
await openBag(c)
await sheet().getByRole('button', { name: 'Move to freezer' }).click()
await settle(2500)
check('with the switch off, a move to the freezer prints nothing', labels() === before && (await bagNow(c.id)).location === 'freezer', `${before} → ${labels()}`)
check('nothing wider than the screen', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
