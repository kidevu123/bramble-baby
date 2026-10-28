/**
 * Every bar chart answers a tap: the bar stays, the others step back, a small readout above it says the value and
 * the day (and the parts of a stacked bar); a tap away, or a second tap on the same bar, puts it away.
 *   Reports › Summary › Feeding (feeds a day, bottle volume), Diapers (wet / wet and poo / poo), Pumping (the day's
 *   total, and the pump comparison: a pump's sessions, best session and usual length).
 *   node e2e/bar-tap.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack (the script creates the child and seeds entries relative to today).
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/bar-tap'
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
// Noon of n days ago: inside that day whatever the clock says now.
const dayAt = (n, h = 12) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, 0, 0, 0); return d }
const longDay = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, colorScheme: SCHEME })
await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml', weight: 'lb', length: 'in', temp: 'f' } })) })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`console: ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('response', (r) => { if (r.status() >= 400 && !/\/api\/profile|\/login\//.test(r.url())) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`) })
const settle = (ms = 600) => page.waitForTimeout(ms)
let n = 0
const shot = async (name) => { n += 1; await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}-${SCHEME}.png` }) }

await page.goto(BASE + '/signin')
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1200)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Birth date or due date').fill(ymd(dayAt(32)))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
}
await settle(1200)
const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
const post = (path, data) => page.request.post(BASE + path, { headers, data: { child: child.id, ...data } })
// Three days ago: 3 bottles of 60 mL; two days ago: 5; yesterday: 4. Diapers two days ago: 2 wet, 1 mixed, 1 poo.
for (const [ago, count] of [[3, 3], [2, 5], [1, 4]]) for (let k = 0; k < count; k++) {
  const t = dayAt(ago, 7 + k * 3)
  await post('/api/feedings/', { start: t.toISOString(), end: t.toISOString(), type: 'breast milk', method: 'bottle', amount: 60, notes: '', tags: [] })
}
for (const [wet, solid, h] of [[true, false, 8], [true, false, 11], [true, true, 14], [false, true, 17]]) await post('/api/changes/', { time: dayAt(2, h).toISOString(), wet, solid, color: '', amount: null, notes: '', tags: [] })
for (const [ago, pump, ml] of [[2, 'Eufy', 120], [2, 'Spectra', 80], [1, 'Eufy', 140], [1, 'Spectra', 90]]) {
  const t = dayAt(ago, 9 + (pump === 'Eufy' ? 0 : 6))
  await post('/api/pumping/', { start: t.toISOString(), end: new Date(t.getTime() + 25 * 60_000).toISOString(), amount: ml, notes: '', tags: [`pump:${pump}`] })
}

const card = (title) => page.locator('section.card', { has: page.getByRole('heading', { name: title, exact: true }) })
const tip = page.getByTestId('chart-tip')
const tipText = async () => squash(await tip.innerText())
const openSummary = async (tab) => {
  await page.goto(BASE + '/reports')
  await settle(1000)
  await page.getByRole('tab', { name: 'Summary' }).click()
  await settle(500)
  await page.getByRole('button', { name: tab, exact: true }).click()
  await settle(1000)
}
// The 7-day bars run oldest first, today last: n days ago is column 6 − n.
const col = (chart, ago) => chart.locator('.bar-col').nth(6 - ago)

// ---- Feeding: feeds a day
await openSummary('Feeding')
const feeds = card('Feeding').locator('.bar-chart').first()
await col(feeds, 2).locator('rect').first().click()
await settle(300)
check('a tap on a bar shows a readout with its value and its day', (await tip.count()) === 1 && (await tipText()) === `5 feeds ${longDay(dayAt(2))}`, (await tip.count()) ? await tipText() : 'no readout')
check('… the tapped bar stays, the others step back', (await feeds.locator('svg.has-pick').count()) === 1 && (await feeds.locator('.bar-col.bar-on').count()) === 1 && (await col(feeds, 3).locator('rect').first().evaluate((r) => getComputedStyle(r).opacity)) === '0.35')
const tipBox = await tip.boundingBox()
const barBox = await col(feeds, 2).locator('rect').first().boundingBox()
check('… the readout sits over its bar, inside the screen', tipBox && barBox && Math.abs(tipBox.x + tipBox.width / 2 - (barBox.x + barBox.width / 2)) < tipBox.width / 2 + 2 && tipBox.x >= 0 && tipBox.x + tipBox.width <= 390, JSON.stringify({ tipBox, barBox }))
await shot('feeds-tip')
await col(feeds, 1).locator('rect').first().click()
await settle(300)
check('a tap on another bar moves the readout to it', (await tipText()) === `4 feeds ${longDay(dayAt(1))}`, await tipText())
await col(feeds, 1).locator('rect').first().click()
await settle(300)
check('a second tap on the same bar puts it away', (await tip.count()) === 0 && (await feeds.locator('svg.has-pick').count()) === 0)
await col(feeds, 3).locator('rect').first().click()
await settle(300)
await page.getByRole('heading', { name: 'Feeding', exact: true }).click()
await settle(300)
check('a tap anywhere else puts it away', (await tip.count()) === 0)
await feeds.locator('svg').focus()
await page.keyboard.press('End')
await settle(200)
check('the keyboard reaches the bars too (End → today)', (await tip.count()) === 1 && /^0 feeds /.test(await tipText()), (await tip.count()) ? await tipText() : 'no readout')
await page.keyboard.press('Escape')
await settle(200)
check('… and Escape puts it away', (await tip.count()) === 0)

// ---- Feeding: bottle volume
const volume = card('Feeding').locator('.bar-chart').nth(1)
await col(volume, 2).locator('rect').first().click()
await settle(300)
check('the bottle volume bars read in mL', (await tipText()) === `300 mL ${longDay(dayAt(2))}`, await tipText())

// ---- Diapers: a stacked bar names its parts
await openSummary('Diapers')
const diapers = card('Diapers').locator('.bar-chart').first()
await col(diapers, 2).locator('rect').first().click()
await settle(300)
check('a stacked bar lists its parts', (await tipText()) === `4 diapers ${longDay(dayAt(2))} Wet 2 · Wet and poo 1 · Poo 1`, await tipText())
await shot('diapers-tip')

// ---- Pumping: the day's total, and the pump comparison
await openSummary('Pumping')
const daily = card('Pumping').locator('.bar-chart').first()
await col(daily, 1).locator('rect').first().click()
await settle(300)
check("the pumping bars say the day's total", (await tipText()) === `230 mL pumped ${longDay(dayAt(1))}`, await tipText())
const compare = page.locator('.pc .bar-chart')
await compare.scrollIntoViewIfNeeded()
await compare.locator('.pc-bar[data-pump="Eufy"] rect').click()
await settle(300)
check("a pump's bar says its sessions, best session and usual length", /^130 mL per session Eufy · 2 sessions Best 140 mL · usually 25 min$/.test(await tipText()), await tipText())
check('… the other pump steps back', (await compare.locator('.pc-bar[data-pump="Spectra"] rect').evaluate((r) => getComputedStyle(r).opacity)) === '0.35')
await shot('pump-tip')
await page.getByRole('tab', { name: /per minute/ }).click()
await settle(400)
check('switching to per minute closes the readout (the bars re-rank)', (await tip.count()) === 0)
await compare.locator('.pc-bar[data-pump="Spectra"] rect').click()
await settle(300)
check('… and per minute reads per minute', /^3\.4 mL per minute Spectra · 2 sessions 85 mL a session · usually 25 min$/.test(await tipText()), await tipText())
check('nothing wider than the screen', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
