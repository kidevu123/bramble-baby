/**
 * The report for the pediatrician: Reports › Summary › Overview → Report for the pediatrician → /report: one page from
 * the last visit to this one (the two dates typed on the page, remembered for the child), with the weight chart against
 * the goal and the WHO curves, the gain since the last visit, the bottles-a-day chart, the daily figures with the typical
 * band, a week-by-week (or day-by-day) table, fevers and medicines; Share as text; a one-page PDF; Back returns to Reports.
 *   node e2e/doctor-report.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack (the script creates the child and seeds a week of entries).
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/doctor-report'
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

// ---- sign in, a child born 3 weeks ago, a week of entries
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
const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
const post = (path, data) => page.request.post(BASE + path, { headers, data: { child: child.id, ...data } })
for (const ago of [0, 1, 2, 3, 4, 5, 6]) {
  await post('/api/feedings/', { start: daysAgo(ago, 6).toISOString(), end: daysAgo(ago, 6).toISOString(), type: 'breast milk', method: 'bottle', amount: 60, notes: '', tags: [] })
  await post('/api/feedings/', { start: daysAgo(ago, 12).toISOString(), end: daysAgo(ago, 12).toISOString(), type: 'breast milk', method: 'bottle', amount: 70, notes: '', tags: [] })
  await post('/api/changes/', { time: daysAgo(ago, 7).toISOString(), wet: true, solid: false, color: '', amount: null, notes: '', tags: [] })
  await post('/api/changes/', { time: daysAgo(ago, 13).toISOString(), wet: true, solid: true, color: 'yellow', amount: null, notes: '', tags: [] })
  await post('/api/sleep/', { start: daysAgo(ago, 1).toISOString(), end: daysAgo(ago, 4).toISOString(), nap: false, notes: '', tags: [] })
  await post('/api/pumping/', { start: daysAgo(ago, 8).toISOString(), end: daysAgo(ago, 8, 20).toISOString(), amount: 90, notes: '', tags: [] })
}
// the pediatrician's goal (Child tab): the report draws it and judges the gain against it
await page.request.put(BASE + '/bramble/settings/' + child.id, { headers, data: { weightGoalGPerDay: 20 } })
await post('/api/weight/', { weight: 4.6, date: ymd(daysAgo(28)), notes: '9:00 AM' }) // the last visit's weighing
await post('/api/weight/', { weight: 5.0, date: ymd(daysAgo(8)), notes: '9:00 AM' })
// Today's weighing a few minutes ago, never later than now: at 9:00 AM it was in the future for a run before 9, and the
// gain per day (which counts weighings up to now) left it out.
const weighedToday = new Date(Date.now() - 5 * 60_000)
const clock = (d) => `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`
await post('/api/weight/', { weight: 5.35, date: ymd(weighedToday), notes: clock(weighedToday) })
await post('/api/height/', { height: 18.3, date: ymd(daysAgo(0)), notes: '' })
await post('/api/temperature/', { temperature: 99.1, time: daysAgo(1, 13).toISOString(), notes: '', tags: [] })
await post('/api/temperature/', { temperature: 101.5, time: daysAgo(20, 13).toISOString(), notes: '', tags: [] })

// ---- the way in: Reports › Summary › Overview
await page.goto(BASE + '/reports')
await settle(1000)
await page.getByRole('tab', { name: 'Summary' }).click()
await settle(800)
const link = page.getByTestId('doctor-report-link')
check('Summary › Overview offers the pediatrician report', (await link.count()) === 1 && /Report for the pediatrician/.test(await link.innerText()))
await link.scrollIntoViewIfNeeded()
await shot('overview-link')
await link.click()
await page.waitForURL(/\/report$/, { timeout: 10000 })
await settle(1200)

// ---- the report: no last visit on record yet → the last 14 days
const report = page.getByRole('article', { name: 'Report for the pediatrician' })
let t = squash(await report.innerText())
check('without a last visit the report heads with the child and covers the last 14 days', /^Oscar Pediatrician report/.test(t) && /3 wk/.test(t) && /14 days/.test(t) && !/Since the last visit/.test(t), t.slice(0, 200))
check('… and the page says to set the last visit', /No last visit on record: the report covers the last 14 days/.test(await page.locator('.report-actions').innerText()))
let growth = squash(await page.getByTestId('report-growth').innerText())
check('growth has the weight chart, the latest weight with its date, and the gain', (await page.getByTestId('report-weight-chart').count()) === 1 && /Weight 5 lb 6 oz/.test(growth) && /Gain \+20 g\/day/.test(growth) && /Length 18\.3 in/.test(growth), growth)
check('… the chart draws the two weighings as dots and the goal as a dashed line', (await page.locator('.rc-weight .rc-dot').count()) === 2 && (await page.locator('.rc-weight .rc-goal').count()) === 1 && /dashed: the doctor's 20 g\/day/.test(growth))
const feeding = squash(await page.getByTestId('report-feeding').innerText())
check('feeding has the bottles-a-day chart and the figures with the typical band', (await page.getByTestId('report-intake-chart').count()) === 1 && (await page.locator('.rc-intake .rc-bar').count()) === 13 && /Feeds a day 2 typical \d+–\d+ · 6 of 13 days logged/.test(feeding) && /By bottle a day 130 mL/.test(feeding), feeding)
const diapers = squash(await page.getByTestId('report-diapers').innerText())
check('diapers and sleep carry their figures', /Wet diapers a day 2/.test(diapers) && /Dirty diapers a day 1/.test(diapers) && /Sleep a day 3h/.test(diapers) && /Pumped a day 90 mL/.test(diapers), diapers)
check('a two-week window lists the days one by one', (await page.getByTestId('report-days').count()) === 1 && (await page.locator('.report-days tbody tr').count()) === 14 && /2 130 mL 2 \/ 1 3h 90 mL/.test(squash(await page.locator('.report-days tbody tr').last().innerText())), squash(await page.locator('.report-days tbody tr').last().innerText()))
const health = squash(await page.getByTestId('report-health').innerText())
check('only the temperature inside the window is listed, with its level', /99\.1°F · normal/.test(health) && !/101\.5/.test(health), health)
await shot('report-14')

// ---- the last visit set: the report runs from it, the weeks side by side, the gain since that weighing
await page.getByLabel('Last visit').fill(ymd(daysAgo(28)))
await settle(1500)
t = squash(await report.innerText())
check('the report heads with this visit and the window since the last one', /Pediatrician visit · /.test(t) && new RegExp(`Since the last visit on ${daysAgo(28).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`).test(t) && /29 days/.test(t), t.slice(0, 260))
growth = squash(await page.getByTestId('report-growth').innerText())
check('growth says the gain since the visit weighing: 4.6 → 5.35 lb is +340 g, 12 g/day, short of the 20', /Since last visit \+340 g 12 g\/day over 2[78](\.\d)? days · 8 g\/day short of the doctor's 20/.test(growth), growth)
check('… the chart has three weighings', (await page.locator('.rc-weight .rc-dot').count()) === 3)
check('a four-week window folds into weeks', (await page.getByTestId('report-weeks').count()) === 1 && (await page.locator('.report-days tbody tr').count()) === 4 && (await page.getByTestId('report-days').count()) === 0, String(await page.locator('.report-days tbody tr').count()))
const lastWeek = squash(await page.locator('.report-days tbody tr').nth(3).innerText())
const weekBefore = squash(await page.locator('.report-days tbody tr').nth(2).innerText())
check('… the last full week carries its averages (today, in progress, is not in it) and the week before its weighing', /2 130 mL 2 \/ 1 3h 90 mL –$/.test(lastWeek) && new RegExp(`5 lb \\(${daysAgo(8).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}\\)$`).test(weekBefore), `${weekBefore} | ${lastWeek}`)
check('the dates are remembered for the child', (await (await page.request.get(BASE + '/bramble/settings/' + child.id, { headers })).json()).visits?.last === ymd(daysAgo(28)))
await shot('report-visit')

// ---- printed: one letter page
await page.emulateMedia({ media: 'print' })
const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true })
await page.emulateMedia({ media: null })
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
check('the report prints on one letter page', pages === 1, `${pages} pages, ${pdf.length} bytes`)
// ---- share as text (no share sheet in the harness: the text goes to the clipboard, or the fallback line shows)
await page.getByRole('button', { name: 'Share as text' }).click()
await settle(600)
const status = page.getByRole('status')
check('Share as text copies the report or says how to select it', (await status.count()) === 1 && /(Copied as text|Could not share)/.test(await status.innerText()), (await status.count()) ? await status.innerText() : 'no status')
check('the print button is there', (await page.getByRole('button', { name: 'Print or PDF' }).count()) === 1)

// ---- a 320 px phone: the day table scrolls inside its own box, the page never sideways
const size = page.viewportSize()
await page.setViewportSize({ width: 320, height: 640 })
await settle(400)
const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth)
check('at 320 px the report page does not scroll sideways', overflow <= 1, `${overflow}px too wide`)
await shot('report-320')
await page.setViewportSize(size)
await settle(300)

// ---- Back returns to Reports, on the Summary › Overview the report was opened from (not Day)
await page.getByRole('button', { name: 'Back' }).click()
await page.waitForURL(/\/reports$/, { timeout: 10000 })
check('Back goes back to Reports', /\/reports$/.test(page.url()))
await settle(800)
check('Reports comes back on Summary › Overview, where the report was opened', (await page.getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')) === 'true' && (await page.getByTestId('doctor-report-link').count()) === 1)

// ---- Summary keeps to its range even when the Day view was paged back a long way (the events then cover more)
await page.getByRole('tab', { name: 'Day' }).click()
await settle(500)
for (let i = 0; i < 22; i += 1) await page.getByRole('button', { name: 'Previous day' }).click()
await settle(1500)
await page.getByRole('tab', { name: 'Summary' }).click()
await settle(600)
await page.getByRole('button', { name: '7D', exact: true }).click()
await page.getByRole('button', { name: 'Temperature', exact: true }).click()
await settle(800)
const tempCard = squash(await page.locator('.card', { hasText: 'Fever readings' }).innerText())
check('Summary › Temperature on 7D counts only the last 7 days (not the reading from 20 days ago)', /Readings 1/.test(tempCard) && /Fever readings 0/.test(tempCard) && !/101\.5/.test(tempCard), tempCard)

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
