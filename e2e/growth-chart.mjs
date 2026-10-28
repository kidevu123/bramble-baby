/**
 * The weight chart reads at the child's own scale and every dot can be read: a month of weighings shaped like
 * a small baby's (5 lb 11 oz, a dip to 5 lb 7 oz, 5 lb 15 oz today) for a girl with a 20 g/day goal. Recent:
 * the axis is in ounce steps and fitted to the line, today's dot sits above the first one, each day's weighing
 * is a check (a dashed step at 20 g/day from the check before, the dot green when met and red when missed), a
 * tap on a dot shows its weight, time, change and check, a slide and the arrow keys move it. Growth chart: the
 * WHO bands and percentile lines by age from birth, the dots on them, a tap reads age and percentile.
 *   node e2e/growth-chart.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack (the script creates the child and the weighings).
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/growth-chart'
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
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d }

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, colorScheme: SCHEME })
await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml', weight: 'lb', length: 'in', temp: 'f' } })) })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/profile')) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`) })
const settle = (ms = 500) => page.waitForTimeout(ms)
let n = 0
const shot = async (name) => { n += 1; await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}-${SCHEME}.png`, fullPage: false }) }

await page.goto(BASE + '/')
await page.waitForURL(/\/signin/)
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1200)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Birth date or due date').fill(ymd(daysAgo(45)))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
}
await settle(1500)
const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
// lb, days ago: 5 lb 11 oz, a dip to about 5 lb 7 oz, back up to 5 lb 15 oz today.
const series = [[29, 5.6875], [28, 5.65], [27, 5.5], [26, 5.5], [25, 5.47], [24, 5.44], [23, 5.47], [22, 5.53], [21, 5.53], [20, 5.44], [19, 5.47], [18, 5.56], [17, 5.53], [16, 5.44], [15, 5.47], [14, 5.5], [13, 5.5], [12, 5.53], [11, 5.5], [10, 5.53], [9, 5.53], [8, 5.5], [7, 5.6], [4, 5.7], [2, 5.8], [0, 5.9375]]
for (const [ago, lb] of series) await page.request.post(BASE + '/api/weight/', { headers, data: { child: child.id, weight: lb, date: ymd(daysAgo(ago)), notes: ago === 0 ? 'Hatch Grow scale · 12:05 AM' : 'Hatch Grow scale · 9:00 AM' } })
await page.request.put(`${BASE}/bramble/settings/${child.id}`, { headers, data: { sex: 'female', weightGoalGPerDay: 20 } })

await page.goto(BASE + '/reports')
await settle(1000)
await page.getByRole('tab', { name: 'Summary' }).click()
await settle(600)
await page.getByRole('button', { name: 'Growth', exact: true }).click()
await settle(1200)
const chart = page.locator('.line-chart svg')
await chart.scrollIntoViewIfNeeded()

const ticks = await chart.locator('text.bars-tick').allTextContents()
const yTicks = ticks.filter((t) => /lb/.test(t))
check('the axis is in ounce steps around her weights, not stretched to 12 lb', yTicks.length >= 3 && yTicks.every((t) => /^[567] lb( \d{1,2} oz)?$/.test(t)) && !yTicks.some((t) => /^(8|9|10|11|12) lb/.test(t)), JSON.stringify(yTicks))
const dots = await chart.locator('circle').evaluateAll((cs) => cs.map((c) => Number(c.getAttribute('cy'))))
check('today (5 lb 15 oz) sits clearly above the first weighing (5 lb 11 oz)', dots.length === series.length && dots[0] - dots[dots.length - 1] > 20, JSON.stringify([dots[0], dots[dots.length - 1]]))
check('the lowest weighing sits well below the first', Math.max(...dots) - dots[0] > 15)
const key = squash(await page.getByTestId('chart-key').innerText())
check('the key names the line, met, missed and the goal step', /Ada/.test(key) && /Met/.test(key) && /Missed/.test(key) && /Goal 20 g\/day from each check/.test(key), key)
// One check a day: 26 days weighed, 25 checks, each a dashed step; the dots are green or red by the check.
const targetsN = await chart.locator('.lc-target').count()
check('each day after the first is a check with its own dashed step', targetsN === series.length - 1, String(targetsN))
const tones = await chart.locator('circle').evaluateAll((cs) => cs.map((c) => c.getAttribute('class') ?? ''))
check('the dots are marked met or missed', tones.filter((c) => /lc-dot-(met|missed)/.test(c)).length === series.length - 1 && tones.some((c) => /lc-dot-missed/.test(c)) && /lc-dot-met/.test(tones[tones.length - 1]), JSON.stringify(tones.slice(-4)))
check('no percentile curves on the recent chart', (await chart.locator('.ga-line').count()) === 0)
const lastCheck = squash(await page.getByTestId('last-check').innerText())
check('the Last check tile says what was gained, what was needed and that it was met', /\+62 g/.test(lastCheck) && /needed \+\d+ g · met/.test(lastCheck), lastCheck)
check('the Checks met tile counts the last seven', /\d of 7/.test(await page.getByTestId('checks-met').innerText()), squash(await page.getByTestId('checks-met').innerText()))
const about = page.getByTestId('growth-about')
check('the explanations are folded away under the card', (await about.count()) === 1 && !(await about.evaluate((d) => d.open)))
check('the goal with no start day says so in one line, outside the fold', /held to the 20 g\/day goal/.test(await page.getByTestId('goal-start-missing').innerText()))
await about.locator('summary').click()
await settle(200)
check('one tap opens them: how to read the dots and the dashed steps', /Tap a dot/.test(await about.innerText()) && /dashed step starts where Ada was at the check before/.test(await about.innerText()) && /Growth chart view/.test(await about.innerText()), squash(await about.innerText()).slice(0, 300))
await about.locator('summary').click()
await shot('chart')
await page.locator('section.card', { has: page.locator('.line-chart') }).screenshot({ path: `${OUT}/card-${SCHEME}.png` })

// tap the last dot
const box = await chart.boundingBox()
const last = await chart.locator('circle').last().boundingBox()
await page.mouse.click(last.x + last.width / 2, last.y + last.height / 2)
await settle(300)
let tip = squash(await page.getByTestId('chart-tip').innerText())
check('a tap on the last dot shows its weight in lb/oz and grams, when, the change and the check', /^5 lb 15 oz · 2,693 g/.test(tip) && /12:05 AM/.test(tip) && /\+62 g \(2\.2 oz\) since/.test(tip) && /needed \+\d+ g · met/.test(tip), tip)
const tipBox = await page.getByTestId('chart-tip').boundingBox()
check('the readout stays on screen', tipBox.x >= 0 && tipBox.x + tipBox.width <= 390, JSON.stringify(tipBox))
await shot('tap-last')
// tap the first dot
const first = await chart.locator('circle').first().boundingBox()
await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2)
await settle(300)
tip = squash(await page.getByTestId('chart-tip').innerText())
check('the first dot reads 5 lb 11 oz', /^5 lb 11 oz · 2,580 g/.test(tip) && !/since/.test(tip), tip)
await shot('tap-first')
// a slide from the left to the middle picks a dot in between
await page.mouse.move(first.x + 2, first.y + 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 })
await page.mouse.up()
await settle(300)
tip = squash(await page.getByTestId('chart-tip').innerText())
check('sliding along the chart moves the readout', !/5 lb 11 oz · 2,580/.test(tip) && /since/.test(tip), tip)
// keys
await chart.focus()
await page.keyboard.press('End')
await settle(200)
check('End picks the latest weighing', /^5 lb 15 oz/.test(squash(await page.getByTestId('chart-tip').innerText())))
await page.keyboard.press('ArrowLeft')
await settle(200)
check('ArrowLeft steps back one weighing', /^5 lb 13 oz/.test(squash(await page.getByTestId('chart-tip').innerText())), squash(await page.getByTestId('chart-tip').innerText()))
// a tap outside the chart puts the readout away; a second tap on the open dot does too
await page.locator('h3, .stat').first().click()
await settle(300)
check('a tap outside the chart closes the readout', (await page.getByTestId('chart-tip').count()) === 0)
const lastDot = await chart.locator('circle').last().boundingBox()
await page.mouse.click(lastDot.x + lastDot.width / 2, lastDot.y + lastDot.height / 2)
await settle(300)
check('… a tap on a dot opens it again', (await page.getByTestId('chart-tip').count()) === 1)
await page.mouse.click(lastDot.x + lastDot.width / 2, lastDot.y + lastDot.height / 2)
await settle(300)
check('… and a second tap on the same dot closes it', (await page.getByTestId('chart-tip').count()) === 0)
check('nothing wider than the screen', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
await shot('keys')

// The growth chart by age, like the pediatrician's card.
await page.getByRole('tab', { name: 'Growth chart' }).click()
await settle(500)
const age = page.getByTestId('age-chart').locator('svg.bars')
await age.scrollIntoViewIfNeeded()
check('the growth chart shows the five shaded bands and nine percentile lines', (await age.locator('.ga-band').count()) === 5 && (await age.locator('.ga-line').count()) === 9)
const ageTicks = await age.locator('text.bars-tick').allTextContents()
const plotH = Number(await age.locator('clipPath rect').getAttribute('height'))
const dotSpread = async () => {
  const ys = await age.locator('circle.ga-dot').evaluateAll((cs) => cs.map((c) => Number(c.getAttribute('cy'))))
  return Math.max(...ys) - Math.min(...ys)
}
// It opens on the whole chart, like the card at the doctor's.
check('it opens on the whole chart: birth to 3 months in months', ageTicks.includes('Birth') && ageTicks.includes('1 mo') && ageTicks.includes('3 mo'), JSON.stringify(ageTicks))
check('… with the 2nd, 50th and 98th labelled on the right', ['2', '50', '98'].every((l) => ageTicks.includes(l)), JSON.stringify(ageTicks))
const zoomBtn = page.getByTestId('age-zoom')
check('the zoom button sits at the top of the chart, not pressed', /Zoom in/.test(await zoomBtn.innerText()) && (await zoomBtn.getAttribute('aria-pressed')) === 'false')
const fullSpread = await dotSpread()
await page.locator('section.card', { has: page.getByTestId('age-chart') }).screenshot({ path: `${OUT}/card-age-whole-${SCHEME}.png` })
await zoomBtn.click()
await settle(300)
const zoomTicks = await age.locator('text.bars-tick').allTextContents()
check('zoomed: age in weeks while she is small', zoomTicks.includes('Birth') && zoomTicks.some((t) => / wk$/.test(t)) && !zoomTicks.includes('3 mo'), JSON.stringify(zoomTicks))
check('zoomed: the 2nd percentile line is in view and labelled', zoomTicks.includes('2'), JSON.stringify(zoomTicks))
// Zoomed to her: her month of weighings (5 lb 7 oz → 5 lb 15 oz) fills a real share of the height, not a corner.
const zoomSpread = await dotSpread()
check('zoomed: her dots span at least a tenth of the height and twice what they did on the whole chart', zoomSpread >= plotH * 0.1 && zoomSpread >= fullSpread * 2, `${Math.round(fullSpread)} → ${Math.round(zoomSpread)} of ${plotH}`)
const dotXs = await age.locator('circle.ga-dot').evaluateAll((cs) => cs.map((c) => Number(c.getAttribute('cx'))))
check('zoomed: … and most of the width (the window ends a week past her)', Math.max(...dotXs) > 320 * 0.7, JSON.stringify(Math.max(...dotXs)))
check('the button now goes back to the whole chart', /Whole chart/.test(await zoomBtn.innerText()) && (await zoomBtn.getAttribute('aria-pressed')) === 'true')
check('every weighing is a dot on it', (await age.locator('circle.ga-dot').count()) === series.length)
const ageKey = squash(await page.getByTestId('chart-key').innerText())
check('the key names the bands', /25th–75th/.test(ageKey) && /2nd–98th/.test(ageKey) && /Outside/.test(ageKey), ageKey)
const lastAge = await age.locator('circle.ga-dot').last().boundingBox()
await page.mouse.click(lastAge.x + lastAge.width / 2, lastAge.y + lastAge.height / 2)
await settle(300)
const ageTip = squash(await page.getByTestId('chart-tip').innerText())
check('a tap reads the weight, the age and the percentile', /^5 lb 15 oz/.test(ageTip) && /Age 6 wk 3 d/.test(ageTip) && /percentile/.test(ageTip), ageTip)
await shot('growth-chart')
await page.locator('section.card', { has: page.getByTestId('age-chart') }).screenshot({ path: `${OUT}/card-age-${SCHEME}.png` })
await zoomBtn.click()
await settle(300)
check('a second tap goes back to the whole chart', (await age.locator('text.bars-tick').allTextContents()).includes('3 mo'))
await about.locator('summary').click()
await settle(200)
check('the fold says what the lines and bands are and where doctors look closer', /WHO growth standard for girls/.test(await about.innerText()) && /below the 2nd or above the 98th/.test(await about.innerText()), squash(await about.innerText()).slice(0, 300))
check('nothing wider than the screen on the growth chart', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))

// Feeding by weight: 2.69 kg → 405–485 mL a day; three full days of 8 × 50 mL bottles (400 mL) sit within it.
for (const ago of [1, 2, 3]) for (let h = 0; h < 24; h += 3) {
  const at = daysAgo(ago); at.setHours(h, 30, 0, 0)
  await page.request.post(BASE + '/api/feedings/', { headers, data: { child: child.id, start: at.toISOString(), end: at.toISOString(), type: 'breast milk', method: 'bottle', amount: 50, notes: '', tags: [] } })
}
await page.reload()
await settle(1200)
await page.getByRole('button', { name: 'Feeding', exact: true }).click()
await settle(1200)
const bw = page.getByTestId('by-weight')
await bw.scrollIntoViewIfNeeded()
const band = squash(await page.getByTestId('by-weight-band').innerText())
const perFeed = squash(await page.getByTestId('feeds-per-day').innerText())
check('the Feeding tiles say what her weight suggests a day, and a feed under Feeds / day', /Ada's weight suggests/.test(band) && /405–485 mL/.test(band) && /a day · 5 lb 15 oz on/.test(band) && /about 50–60 mL a feed/.test(perFeed), `${band} | ${perFeed}`)
check('the bottles are set against it', /Bottles average 400 mL a day, within what Ada's weight suggests/.test(await bw.innerText()), squash(await bw.innerText()))
check('a gauge shows the band and where the bottles sit', (await bw.locator('.bw-band').count()) === 1 && (await bw.locator('.bw-mark.is-typical').count()) === 1)
await page.locator('section.card', { has: bw }).screenshot({ path: `${OUT}/card-feeding-${SCHEME}.png` })
const feedAbout = page.locator('section.card', { has: bw }).locator('details.about')
check('the fold gives the rule and its sources', /2½ oz per pound/.test(await page.getByTestId('by-weight-note').textContent()) && /32 oz/.test(await page.getByTestId('by-weight-note').textContent()) && !(await feedAbout.evaluate((d) => d.open)))

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
