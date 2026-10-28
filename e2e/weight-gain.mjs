/**
 * Weight gain in grams a day: Reports › Summary › Growth shows the gain since the last weighing and over the
 * last week in grams with the ounce beside it, measured against the pediatrician's goal from the Child tab;
 * Reports › Day shows the weight as it stood on the day being looked at. Exits non-zero when a step fails.
 *   node e2e/weight-gain.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack (the script creates the child and seeds three weights).
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/weight-gain'
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
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const short = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`

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

// ---- sign in, a child born 3 weeks ago, three weights: 5.0 lb eight days ago, 5.3 lb yesterday, 5.35 lb today
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
await settle(1500) // the app records the household's storage units on first load
const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
// Every weighing at the same clock, a couple of minutes ago: whole days apart, and today's is not in the future
// (a 9:00 AM weighing run at 2 AM was left out of today's Day view).
const clockAgo = (() => {
  const d = new Date(Date.now() - 2 * 60_000)
  if (d.getDate() !== new Date().getDate()) return '12:00 AM'
  const h = d.getHours() % 12 || 12
  return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`
})()
for (const [ago, lb] of [[8, 5.0], [1, 5.3], [0, 5.35]]) await page.request.post(BASE + '/api/weight/', { headers, data: { child: child.id, weight: lb, date: ymd(daysAgo(ago)), notes: clockAgo } })

// ---- Reports › Summary › Growth: the gain in grams and ounces, judged against the typical band
await page.goto(BASE + '/reports')
await settle(1000)
await page.getByRole('tab', { name: 'Summary' }).click()
await settle(600)
await page.getByRole('button', { name: 'Growth', exact: true }).click()
await settle(900)
const gain = page.getByTestId('weight-gain')
let t = squash(await gain.innerText())
check('the gain block shows the last check and the week in grams with the ounce beside', /Last check \+23 g \(0\.8 oz\) needed \+21 g · met/.test(t) && /Last 8 days \+159 g \(5\.6 oz\)/.test(t) && /\+20 g\/day \(0\.7 oz\) over the last 8 days/.test(t) && !/Per day/.test(t), t)
check('the checks are counted: the week before missed the low end of typical, yesterday to today met it', /Checks met 1 of 2/.test(t), t)
// The explanations sit in the card's folded "About this chart"; read them as text without opening it.
const aboutText = (await page.getByTestId('growth-about').textContent()).replace(/\s+/g, ' ')
check('… and says one miss is noise and three in a row a pattern (in the fold)', /One weighing can swing ±30 g with feeds, diapers and the time of day, so a single miss is mostly noise; three in a row is worth raising\./.test(aboutText), aboutText)
check('without a goal the rate is judged against the typical band for the age', /\+20 g\/day \(0\.7 oz\) over the last 8 days, below the typical 21–29 g\/day for this age\./.test(t) && /Enter it on the Child tab/.test(aboutText), t)
check('each check has a dashed step at the low end of typical, named in the key', (await page.locator('.line-chart .lc-target').count()) === 2 && /Typical 21 g\/day from each check/.test(await page.getByTestId('chart-key').innerText()) && /21 g a day, the low end of typical for this age/.test(aboutText), aboutText)
await gain.scrollIntoViewIfNeeded()
await shot('growth-gain-typical')

// ---- Child tab: the doctor's goal; Reports then measures against it
await page.goto(BASE + '/child')
await settle(1000)
const goal = page.getByTestId('weight-goal')
check('the Child tab has the weight gain goal card', (await goal.count()) === 1 && /grams a day/.test(await goal.innerText()))
// Typed key by key like a phone keyboard: one save when the field is done, not one per digit ("2" then "20").
const puts = []
const onPut = (r) => { if (r.method() === 'PUT' && r.url().includes('/bramble/settings/')) puts.push(r.postDataJSON()?.weightGoalGPerDay) }
page.on('request', onPut)
const goalField = goal.getByLabel('Weight gain goal in grams a day')
await goalField.click()
await goalField.pressSequentially('20', { delay: 120 })
await goalField.press('Enter')
await settle(800)
page.off('request', onPut)
check('the goal is saved once, when the field is done, not once per digit', puts.length === 1 && puts[0] === 20, JSON.stringify(puts))
await goal.scrollIntoViewIfNeeded()
await shot('child-goal')

// ---- Child tab: the Schedule Creator follows a "Naps per day" changed in nap window Settings in the same visit
await page.getByRole('button', { name: /Nap window settings/ }).click()
await settle(600)
await page.locator('dialog[open]').getByRole('radio', { name: '3', exact: true }).last().click()
await settle(400)
await page.locator('dialog[open]').getByRole('button', { name: 'Done' }).click()
await settle(500)
await page.getByRole('button', { name: /Schedule Creator/ }).click()
await settle(600)
const naps = await page.locator('dialog[open] .plan-slot.kind-nap').count()
check('the Schedule Creator plans the 3 naps just set in nap window Settings', naps === 3, `${naps} naps`)
check('the Schedule Creator reads the 12-hour clock', /7:00\sAM/.test(await page.locator('dialog[open] .plan-schedule').innerText()))
await page.locator('dialog[open]').getByRole('button', { name: 'Done' }).click()
await settle(400)

// ---- Settings slides in without widening the page (the page itself used to move 28 px right)
await page.goto(BASE + '/settings')
let widest = 0
for (let i = 0; i < 12; i += 1) {
  widest = Math.max(widest, await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth))
  await page.waitForTimeout(25)
}
check('Settings slides in without a sideways scroll', widest <= 1, `${widest}px too wide during the slide`)
const saved = await (await page.request.get(`${BASE}/bramble/settings/${child.id}`, { headers })).json()
check('the goal is a shared child setting', saved.weightGoalGPerDay === 20, JSON.stringify(saved.weightGoalGPerDay))
await page.goto(BASE + '/reports')
await settle(1000)
await page.getByRole('tab', { name: 'Summary' }).click()
await settle(600)
await page.getByRole('button', { name: 'Growth', exact: true }).click()
await settle(900)
t = squash(await gain.innerText())
// A goal entered today counts from today: the week before it is not judged against it (the NICU weeks).
check('a goal entered today starts today', saved.weightGoalSince === ymd(new Date()), JSON.stringify(saved.weightGoalSince))
check('… so the line waits for weighings since then instead of judging the week before', new RegExp(`The doctor's 20 g/day counts from ${short(new Date())}; it is measured once two weighings a day apart are in since then\\.`).test(t) && !/On the doctor's|Below the doctor's/.test(t), t)
check('… and the chart has no checks yet', (await page.locator('.line-chart .lc-target').count()) === 0)
// The doctor gave it eight days ago: set the day on the Child tab and Reports counts from there.
await page.goto(BASE + '/child')
await settle(1000)
const sinceField = page.getByTestId('weight-goal').getByLabel('Day the doctor gave the goal')
check('the goal card has the day it was given', (await sinceField.inputValue()) === ymd(new Date()), await sinceField.inputValue())
await sinceField.fill(ymd(daysAgo(8)))
await settle(800)
await page.getByTestId('weight-goal').scrollIntoViewIfNeeded()
await shot('child-goal-since')
await page.goto(BASE + '/reports')
await settle(1000)
await page.getByRole('tab', { name: 'Summary' }).click()
await settle(600)
await page.getByRole('button', { name: 'Growth', exact: true }).click()
await settle(900)
t = squash(await gain.innerText())
check('the checks since the goal day are held to 20 g/day', /Last check \+23 g \(0\.8 oz\) needed \+20 g · met/.test(t) && /Checks met 1 of 2/.test(t), t)
check('… per day is said once, in the verdict (no Per day tile repeating it)', !/Per day/.test(t), t)
check("… and the verdict is on the doctor's number since that day", new RegExp(`On the doctor's 20 g/day: \\+20 g/day \\(0\\.7 oz\\) since ${short(daysAgo(8))} \\(3 weighings over 8 days\\)\\.`).test(t), t)
check("with the goal set, each check's dashed step is the doctor's rate", (await page.locator('.line-chart .lc-target').count()) === 2 && /Goal 20 g\/day from each check/.test(await page.getByTestId('chart-key').innerText()) && /the doctor's 20 g a day/.test(await page.getByTestId('checks-note').textContent()))
check('the latest weight does not read "0th percentile"', !/\b0th percentile/.test(await page.locator('.card').filter({ has: page.getByTestId('weight-gain') }).innerText()))
await page.locator('.line-chart').scrollIntoViewIfNeeded()
await shot('growth-guide-goal')
await gain.scrollIntoViewIfNeeded()
await shot('growth-gain-goal')

// ---- Reports › Day: the weight row follows the day being looked at, with grams beside the ounces
await page.getByRole('tab', { name: 'Day' }).click()
await settle(800)
const weightRow = () => page.locator('.extra-row', { hasText: /^Weight/ }).first()
let row = squash(await weightRow().innerText())
check("today's row is today's weighing with the change since yesterday in both units", /5 lb 6 oz/.test(row) && new RegExp(`${short(daysAgo(0))} · \\+0\\.8 oz \\(23 g\\) since ${short(daysAgo(1))}`).test(row), row)
await page.getByRole('button', { name: 'Previous day' }).click()
await settle(700)
row = squash(await weightRow().innerText())
check("yesterday's row is yesterday's weighing, not today's", /5 lb 5 oz/.test(row) && new RegExp(`${short(daysAgo(1))} · \\+4\\.8 oz \\(136 g\\) since ${short(daysAgo(8))}`).test(row), row)
await shot('day-yesterday')
for (let i = 0; i < 3; i += 1) { await page.getByRole('button', { name: 'Previous day' }).click(); await settle(300) }
await settle(500)
// Since 1.31.0 a day shows only what was measured that day: four days back nobody weighed her, so no weight row
// (it used to repeat the weighing from eight days ago, read as that day's).
check('four days back, with no weighing that day, has no weight row', (await page.locator('.extra-row', { hasText: /^Weight/ }).count()) === 0)

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
