/**
 * How long the stash lasts: the Stash tab divides the usable stash by the breast-milk bottles a day of the
 * last week; Settings › Pumps takes a goal in days of bottles and the card shows progress and the date it
 * is reached from the net surplus. Exits non-zero when a step fails.
 *   node e2e/stash-runway.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack (the script creates the child and seeds a week of bottles and pumping).
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/stash-runway'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const SCHEME = process.argv[4] === 'dark' ? 'dark' : 'light'
const TOKEN = 'mocktoken0000000000000000000000000000000'
mkdirSync(OUT, { recursive: true })

let fails = 0
const problems = []
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || detail === undefined ? '' : ` — ${detail}`}`)
  if (!cond) fails += 1
}
const squash = (t) => t.replace(/\s+/g, ' ').trim()
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const daysAgo = (n, h = 9, m = 0) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d }
const headers = { Authorization: `Token ${TOKEN}`, 'Content-Type': 'application/json' }

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, colorScheme: SCHEME })
await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml', weight: 'lb', length: 'in', temp: 'f' } })) })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/profile')) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`) })
const settle = (ms = 500) => page.waitForTimeout(ms)
let n = 0
const shot = async (name) => { n += 1; await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}-${SCHEME}.png`, fullPage: true }) }

// ---- sign in, a child, a week of bottles (120 mL a day of breast milk + formula that must not count) and pumping (180 mL a day)
await page.goto(BASE + '/')
await page.waitForURL(/\/signin/)
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1200)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Oscar')
  await page.getByLabel('Birth date or due date').fill(ymd(daysAgo(21)))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
}
await settle(1500)
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
const post = (path, data) => page.request.post(BASE + path, { headers, data: { child: child.id, ...data } })
for (const ago of [1, 2, 3, 4, 5, 6, 7]) {
  await post('/api/feedings/', { start: daysAgo(ago, 6).toISOString(), end: daysAgo(ago, 6).toISOString(), type: 'breast milk', method: 'bottle', amount: 60, notes: '', tags: [] })
  await post('/api/feedings/', { start: daysAgo(ago, 12).toISOString(), end: daysAgo(ago, 12).toISOString(), type: 'breast milk', method: 'bottle', amount: 60, notes: '', tags: [] })
  await post('/api/feedings/', { start: daysAgo(ago, 18).toISOString(), end: daysAgo(ago, 18).toISOString(), type: 'formula', method: 'bottle', amount: 50, notes: '', tags: [] })
  await post('/api/pumping/', { start: daysAgo(ago, 8).toISOString(), end: daysAgo(ago, 8, 20).toISOString(), amount: 180, notes: '', tags: [] })
}

// ---- an empty stash
await page.goto(BASE + '/milk')
await settle(1200)
const card = page.getByTestId('stash-runway')
let t = squash(await card.innerText())
check('an empty stash says there is nothing to pour', /^Nothing to pour/.test(t) && /no usable milk/.test(t), t)
await shot('empty')

// ---- two bags of 120 mL: two days at 120 mL a day
const companion = (path, body) => fetch(`${BASE}/bramble${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
await companion('/milk', { child: child.id, pumped_at: daysAgo(3, 8).toISOString(), volume_ml: 120, location: 'freezer', client_key: `runway-a-${Date.now()}` })
await companion('/milk', { child: child.id, pumped_at: daysAgo(2, 8).toISOString(), volume_ml: 120, location: 'freezer', client_key: `runway-b-${Date.now()}` })
await page.reload()
await settle(1500)
t = squash(await card.innerText())
check('the card divides the stash by the breast-milk bottles a day, formula left out', /^2 days/.test(t) && /240 mL in the stash at Oscar’s 120 mL a day by bottle \(over 7 days\)/.test(t), t)
check('no goal line without a goal', !/Goal/.test(t))
await shot('two-days')

// ---- the goal lives in Settings › Pumps
await page.goto(BASE + '/settings')
await settle(900)
await page.getByRole('button', { name: /^Pumps/ }).click()
await settle(600)
const goal = page.getByTestId('stash-goal')
check('Settings › Pumps has the stash goal', (await goal.count()) === 1 && /days of bottles/.test(await goal.innerText()))
await goal.getByLabel('Stash goal in days of bottles').fill('10')
await shot('settings-goal')
await page.getByRole('button', { name: 'Save pumps' }).click()
await settle(800)
const saved = await (await fetch(`${BASE}/bramble/settings/${child.id}`, { headers })).json()
check('the goal is a shared child setting', saved.stashGoalDays === 10, JSON.stringify(saved.stashGoalDays))

// ---- progress and the date, from the net surplus (180 pumped − 120 drunk = 60 mL a day)
await page.goto(BASE + '/milk')
await settle(1500)
t = squash(await card.innerText())
check('the goal line shows progress and when it is reached', /Goal: 10 days of bottles \(1200 mL\) · 20% there\. Pumping 60 mL a day more than Oscar drinks, you get there by/.test(t), t)
check('the progress bar carries the percentage', (await card.getByRole('progressbar').getAttribute('aria-valuenow')) === '20')
await shot('goal')

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
