/**
 * Reports › Day on a past day: the growth rows show only what was measured that day (no height from days
 * before), and "Everything logged" lists the day's entries by kind (Feeds, Diapers, Sleep, Pumping, …), oldest
 * first, with counts matching the tiles and the longest gap between feeds, each row opening the entry to edit.
 *   node e2e/day-log.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack (the script creates the child and seeds the entries).
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/day-log'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const SCHEME = process.argv[4] === 'dark' ? 'dark' : 'light'
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

await page.goto(BASE + '/')
await page.waitForURL(/\/signin/)
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1200)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Birth date or due date').fill(ymd(daysAgo(14)))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
}
await settle(1500)
const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
const post = (path, data) => page.request.post(BASE + path, { headers, data: { child: child.id, ...data } })

// ---- yesterday, inside the report day whether it starts at midnight or at 7 AM: four bottles (the longest gap
// 1:30 – 7:00 PM), two diapers, a pump, a nap; a feed two days ago that must not count
for (const [h, m] of [[8, 0], [11, 0], [13, 30], [19, 0]]) await post('/api/feedings/', { start: daysAgo(1, h, m).toISOString(), end: daysAgo(1, h, m).toISOString(), type: 'breast milk', method: 'bottle', amount: 60, notes: '', tags: [] })
await post('/api/feedings/', { start: daysAgo(2, 20).toISOString(), end: daysAgo(2, 20).toISOString(), type: 'breast milk', method: 'bottle', amount: 50, notes: '', tags: [] })
await post('/api/changes/', { time: daysAgo(1, 9, 30).toISOString(), wet: true, solid: false, color: '', amount: null, notes: '', tags: [] })
await post('/api/changes/', { time: daysAgo(1, 16).toISOString(), wet: true, solid: true, color: 'yellow', amount: null, notes: '', tags: [] })
await post('/api/pumping/', { start: daysAgo(1, 10).toISOString(), end: daysAgo(1, 10, 20).toISOString(), amount: 90, notes: '', tags: [] })
await post('/api/sleep/', { start: daysAgo(1, 14).toISOString(), end: daysAgo(1, 15, 30).toISOString(), nap: true, notes: '', tags: [] })
// growth: weighed yesterday and the day before; height and head three days ago
await post('/api/weight/', { weight: 5.3, date: ymd(daysAgo(2)), notes: '9:00 AM' })
await post('/api/weight/', { weight: 5.35, date: ymd(daysAgo(1)), notes: '9:00 AM' })
await post('/api/height/', { height: 18.3, date: ymd(daysAgo(3)), notes: '' })
await post('/api/head-circumference/', { head_circumference: 13.2, date: ymd(daysAgo(3)), notes: '' })

await page.goto(BASE + '/reports')
await settle(1200)
await page.getByRole('tab', { name: 'Day' }).click()
await settle(400)
await page.getByRole('button', { name: 'Previous day' }).click()
await page.getByTestId('day-log').waitFor()
await settle(800)
check('the Day view is on Yesterday', squash(await page.locator('.week-label').innerText()) === 'Yesterday')

const extras = squash(await page.locator('.extra-row').allInnerTexts().then((t) => t.join(' | ')))
check('yesterday’s weight is there, with the change since the day before', /Weight .* since/.test(extras), extras)
check('no height or head from three days before', !/Height|Head/.test(extras), extras)

const log = page.getByTestId('day-log')
// 4 feeds, 2 diapers, the nap and the pump; not the feed two days before, and not the weighing (the row above)
check('"Everything logged" counts the day’s entries', /^Everything logged 8 entries/.test(squash(await log.innerText())), squash(await log.innerText()).slice(0, 60))
const groupKeys = await log.locator('.day-log-group').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('day-log-', '')))
check('grouped Feeds, Diapers, Sleep, Pumping; the weighing is not listed twice', JSON.stringify(groupKeys) === JSON.stringify(['feeds', 'diapers', 'sleep', 'pumping']), groupKeys.join(','))
const feeds = page.getByTestId('day-log-feeds')
const feedTile = page.locator('.glance-tile', { hasText: 'Feeds' })
check('Feeds says 4, like the Feeds tile', squash(await feeds.locator('.day-log-count').innerText()) === '4' && squash(await feedTile.locator('.glance-value').innerText()) === '4', squash(await feedTile.innerText()))
check('… oldest first', /^8:00 AM/.test(squash(await feeds.locator('.tl-time').first().innerText())), squash(await feeds.locator('.tl-time').first().innerText()))
check('… and names the longest gap between feeds', squash(await feeds.locator('.day-log-gap').innerText()) === 'Longest gap 5h 30m, 1:30 PM – 7:00 PM', squash(await feeds.locator('.day-log-gap').innerText()))
check('Diapers says 2', squash(await page.getByTestId('day-log-diapers').locator('.day-log-count').innerText()) === '2')
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
check('nothing wider than the screen', !overflow)
await shot('yesterday')

await feeds.locator('.tl-row').first().click()
await settle(600)
const sheet = page.locator('dialog[open]').last()
check('a row opens that entry to edit', (await sheet.count()) === 1 && /Edit feeding/.test(await sheet.innerText()) && /8:00 AM/.test(await sheet.innerText()))
await shot('edit-from-log')
await page.keyboard.press('Escape')
await settle(500)
if (await page.locator('dialog[open]').count()) await page.locator('dialog[open]').last().getByRole('button', { name: /Close/ }).first().click().catch(() => undefined)
await settle(400)

// ---- three days ago: the height and head measured then
await page.getByRole('button', { name: 'Previous day' }).click()
await settle(300)
await page.getByRole('button', { name: 'Previous day' }).click()
await settle(1000)
const extras3 = squash(await page.locator('.extra-row').allInnerTexts().then((t) => t.join(' | ')))
check('three days ago shows the height and head measured that day, and no weight', /Height/.test(extras3) && /Head/.test(extras3) && !/Weight/.test(extras3), extras3)
check('… and the list says nothing else was logged that day', /No feeds, diapers, sleep or pumping logged this day/.test(await page.getByTestId('day-log').innerText()))
await shot('three-days-ago')

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
