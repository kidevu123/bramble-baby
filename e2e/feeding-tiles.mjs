/**
 * Reports leads with its answer, in the tiles: Reports › Feeding's tiles put Bottle / day beside what the weight
 * suggests, then Feeds / day with the amount a feed, the gauge and verdict right under them, and no zero Nursing /
 * Solids tiles for a bottle-fed newborn; Reports › Diapers leads with the wet-diaper verdict (one logged day stated,
 * not judged). Home has no card above the tiles (the owner chose the tiles, not a Home card, 2026-10-23).
 *   node e2e/feeding-tiles.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack (the script creates the child and seeds yesterday's entries).
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/feeding-tiles'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const SCHEME = process.argv[4] === 'dark' ? 'dark' : 'light'
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this probe writes entries. Use the isolated stack from the README.`)
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })

let fails = 0
const problems = []
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} [${SCHEME}] ${name}${cond || detail === undefined ? '' : ` — ${detail}`}`)
  if (!cond) fails += 1
}
const squash = (t) => t.replace(/\s+/g, ' ').trim()
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000)
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d }
const clock = (d) => `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, colorScheme: SCHEME })
await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml', weight: 'lb', length: 'in', temp: 'f' } })) })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`console: ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('response', (r) => { if (r.status() >= 400 && !/\/api\/profile|\/login\//.test(r.url())) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`) })
const settle = (ms = 600) => page.waitForTimeout(ms)
let n = 0
const shot = async (name, fullPage = false) => { n += 1; await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}-${SCHEME}.png`, fullPage }) }

// ---- sign in; a child on day 32, 5 lb 13 oz (395–475 mL a day by weight)
await page.goto(BASE + '/signin')
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1200)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Birth date or due date').fill(ymd(daysAgo(32)))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
}
await settle(1200)
const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
const post = (path, data) => page.request.post(BASE + path, { headers, data: { child: child.id, ...data } })
const weighed = hoursAgo(0.1)
await post('/api/weight/', { weight: 5.8125, date: ymd(weighed), notes: clock(weighed) })
// Yesterday, whatever the clock says now: four 60 mL bottles, and three diapers (two wet).
const yesterday = (h) => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(h, 0, 0, 0); return d }
for (const h of [7, 10, 13, 16]) await post('/api/feedings/', { start: yesterday(h).toISOString(), end: yesterday(h).toISOString(), type: 'breast milk', method: 'bottle', amount: 60, notes: '', tags: [] })
for (const [h, wet] of [[9, true], [12, false], [15, true]]) await post('/api/changes/', { time: yesterday(h).toISOString(), wet, solid: !wet, color: '', amount: null, notes: '', tags: [] })

await page.goto(BASE + '/')
await page.locator('.home-tiles, .tiles').first().waitFor({ timeout: 15000 }).catch(() => {})
await settle(1200)
check('Home has no card above the tiles', (await page.getByTestId('heads-up').count()) === 0 && (await page.locator('.hu-row').count()) === 0)

await page.goto(BASE + '/reports')
await settle(1000)
await page.getByRole('tab', { name: 'Summary' }).click()
await settle(500)
await page.getByRole('button', { name: 'Feeding', exact: true }).click()
await settle(1200)
const byWeight = page.getByTestId('by-weight')
const tiles = (await page.locator('section.card', { has: byWeight }).locator(':scope > .stat-grid .stat-name').allInnerTexts()).map(squash)
check("Reports › Feeding's tiles lead with the bottles beside what Ada's weight suggests, then feeds a day", JSON.stringify(tiles.slice(0, 3)) === JSON.stringify(['Bottle / day', "Ada's weight suggests", 'Feeds / day']), tiles.join(', '))
check('… the weight tile is the band a day and the weighing', /^Ada's weight suggests 395–475 mL a day · 5 lb 13 oz on/.test(squash(await page.getByTestId('by-weight-band').innerText())), squash(await page.getByTestId('by-weight-band').innerText()))
check('… Feeds / day says the amount a feed', /about \d+–\d+ mL a feed/.test(squash(await page.getByTestId('feeds-per-day').innerText())), squash(await page.getByTestId('feeds-per-day').innerText()))
check('… the gauge and verdict sit right under the tiles, orange when under', (await byWeight.evaluate((e) => e.previousElementSibling?.classList.contains('stat-grid'))) && /Bottles average 240 mL a day, under the 395–475 mL/.test(squash(await byWeight.innerText())) && (await byWeight.locator('.typical-line.is-low').count()) === 1, squash(await byWeight.innerText()))
check('no "Nursing / day 0m" or "Solids meals 0" tiles for a bottle-fed newborn', !tiles.some((t) => /Nursing|Solids/.test(t)), tiles.join(', '))
check('nothing wider than the screen', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
await shot('feeding')

await page.getByRole('button', { name: 'Diapers', exact: true }).click()
await settle(800)
const wet = page.getByTestId('wet-verdict')
check('Reports › Diapers leads with the wet-diaper verdict against the age', (await wet.count()) === 1 && /^Wet diapers/.test(squash(await wet.innerText())) && (await wet.evaluate((e) => e.previousElementSibling?.tagName)) === 'H3', squash((await wet.count()) ? await wet.innerText() : ''))
// One full day logged is not a pattern: the number and the typical range, no warning.
check('… one logged day is stated, not judged low', /^Wet diapers: 2 on the one full day logged so far; 6–8 a day is typical/.test(squash(await wet.innerText())) && !(await wet.evaluate((e) => e.classList.contains('is-low'))), squash(await wet.innerText()))
await shot('diapers')

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
