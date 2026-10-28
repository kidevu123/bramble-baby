/**
 * Growth entries carry a time of day (the note's " · 8:38 AM" segment, src/lib/growth-note.ts). This probe
 * checks it end to end against the mock stack and saves screenshots; it exits non-zero when a step fails.
 *
 *   e2e/growth-time.sh ./e2e/out/growth-time          # brings up the stack and runs light + dark
 *   node e2e/growth-time.mjs ./e2e/out/growth-time http://localhost:5895 light
 *
 * Start from a fresh mock stack per theme: the script signs in, creates the child and seeds three weights.
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/growth-time'
const BASE = process.argv[3] ?? 'http://localhost:5895'
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
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d) }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const now = new Date()
const todayShort = `${MONTHS[now.getMonth()]} ${now.getDate()}`
const todayLong = `${todayShort}, ${now.getFullYear()}`
// The two times picked in the sheet are earlier today, never in the future: log sheets cap a future time at now
// (1.11.1), so fixed 10:15 / 9:05 AM failed on any run before 10:15 AM. 15 and 45 minutes ago, on the minute.
const ago = (m) => { const d = new Date(Date.now() - m * 60_000); d.setSeconds(0, 0); return d }
const pickA = ago(15)
const pickB = ago(45)
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const clock = (d) => `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`
const minuteOf = (c) => { const [, h, m, ap] = c.match(/(\d+):(\d+) (AM|PM)/); return ((Number(h) % 12) + (ap === 'PM' ? 12 : 0)) * 60 + Number(m) }
// The day's four weighings by clock, latest first: the seeded 7:10 PM and 8:38 AM and the two picked ones.
const byClock = ['7:10 PM', '8:38 AM', clock(pickA), clock(pickB)].sort((a, b) => minuteOf(b) - minuteOf(a)).join(' | ')

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
const post = async (data) => (await page.request.post(BASE + '/api/weight/', { headers, data: { child: child.id, date: day(0), ...data } })).json()
const weights = async () => (await (await page.request.get(`${BASE}/api/weight/?child=${child.id}&limit=100`, { headers })).json()).results
const byId = async (id) => (await weights()).find((w) => w.id === id)

// Three weights today: a Hatch import as the companion writes it, one typed before times existed (no clock), and
// a Hatch import with the scale's own note after the clock.
const hatch = await post({ weight: 5.95, notes: 'Hatch Grow scale · 8:38 AM' })
const untimed = await post({ weight: 5.56, notes: '' })
const evening = await post({ weight: 6.02, notes: 'Hatch Grow scale · 7:10 PM · after bath' })

// ---- Home timeline: each weight at its own clock, the one without a clock at noon, newest first
await page.goto(BASE + '/')
await settle(1200)
const rows = page.locator('.tl-row').filter({ has: page.locator('.tl-title', { hasText: /^Weight/ }) })
await rows.first().waitFor({ timeout: 10000 })
const times = await rows.locator('.tl-time').allInnerTexts()
check('Home shows the three weights at 7:10 PM, 12:00 PM (no clock) and 8:38 AM, newest first', times.join(' | ') === '7:10 PM | 12:00 PM | 8:38 AM', times.join(' | '))
await page.locator('.tl-list').scrollIntoViewIfNeeded()
await shot('01-home-timeline')

// ---- Child page: stat and history carry the clock; the entry without one shows only its date
await page.goto(BASE + '/child')
await settle(1200)
const stat = page.getByRole('button', { name: 'Edit latest weight' })
const statText = (await stat.innerText()).replace(/\n/g, ' ')
check('the latest weight stat is the evening weighing with its clock', /6 lb/.test(statText) && statText.includes(`${todayShort}, 7:10 PM`), statText)
const history = page.locator('.growth-row')
await history.first().waitFor()
const historyText = (await history.allInnerTexts()).map((t) => t.replace(/\n/g, ' '))
check('history lists the evening weighing first, with its clock', historyText[0].includes(`${todayLong}, 7:10 PM`), historyText[0])
check('the weight without a clock shows its date alone, no made-up noon', historyText[1].includes(todayLong) && !/AM|PM/.test(historyText[1]), historyText[1])
check('the morning Hatch weighing shows 8:38 AM', historyText[2].includes(`${todayLong}, 8:38 AM`), historyText[2])
await page.locator('.growth-history').scrollIntoViewIfNeeded()
await shot('02-child-growth')

// ---- Editing a Hatch weighing keeps its note byte for byte
await history.nth(2).click()
await sheet().waitFor()
await settle(500)
check('the sheet shows the clock as the entry’s time', (await sheet().locator('.time-field-value').innerText()).trim() === 'Today, 8:38 AM', await sheet().locator('.time-field-value').innerText())
check('the Notes field shows the source word without the clock', (await sheet().getByLabel('Notes').inputValue()) === 'Hatch Grow scale')
await shot('03-edit-hatch-weight')
await sheet().getByLabel('Pounds').fill('5'); await sheet().getByLabel('Ounces').fill('14.4')
await sheet().getByRole('button', { name: 'Save' }).click()
await sheet().waitFor({ state: 'detached', timeout: 10000 })
await settle(600)
const edited = await byId(hatch.id)
check('the number changed and the note is unchanged: "Hatch Grow scale · 8:38 AM"', edited.weight === 5.9 && edited.notes === 'Hatch Grow scale · 8:38 AM' && edited.date === day(0), `${edited.weight} "${edited.notes}" ${edited.date}`)

// ---- Pounds and ounces: a Hatch weighing opens as lb + oz, 16 oz is refused, and saving it untouched leaves
// the scale's number exactly as the companion wrote it (6.02 lb, not 6 lb 0.25 oz = 6.015625)
const patches = []
const onPatch = (r) => { if (r.method() === 'PATCH' && r.url().includes('/api/weight/')) patches.push(r.postDataJSON()) }
page.on('request', onPatch)
await page.locator('.growth-row').first().click()
await sheet().waitFor()
await settle(500)
check('a Hatch weighing opens as pounds and ounces to the quarter ounce', (await sheet().getByLabel('Pounds').inputValue()) === '6' && (await sheet().getByLabel('Ounces').inputValue()) === '0.25', `${await sheet().getByLabel('Pounds').inputValue()} lb ${await sheet().getByLabel('Ounces').inputValue()} oz`)
await sheet().getByLabel('Ounces').fill('16')
await settle(200)
check('16 ounces is refused in words and Save waits', /16 oz is another pound/.test(await sheet().innerText()) && (await sheet().getByRole('button', { name: 'Save' }).isDisabled()))
await shot('03b-ounces-too-many')
await sheet().getByLabel('Ounces').fill('0.25')
await sheet().getByRole('button', { name: 'Save' }).click()
await sheet().waitFor({ state: 'detached', timeout: 10000 })
await settle(600)
page.off('request', onPatch)
const kept = await byId(evening.id)
check('saving it untouched sends no weight and keeps the Hatch number exactly', patches.length === 1 && !('weight' in patches[0]) && kept.weight === 6.02 && kept.notes === 'Hatch Grow scale · 7:10 PM · after bath', `${JSON.stringify(patches)} ${kept.weight} "${kept.notes}"`)

// ---- Editing a weight without a clock: it stays without one unless a time is picked
await page.locator('.growth-row').nth(1).click()
await sheet().waitFor()
await settle(500)
check('an entry without a clock opens with no time chosen and says so', (await sheet().locator('.time-field-value').innerText()).includes('add a time') && /no time of day yet/.test(await sheet().innerText()), await sheet().locator('.time-field-value').innerText())
await shot('04-edit-untimed')
await sheet().getByLabel('Pounds').fill('5'); await sheet().getByLabel('Ounces').fill('8')
await sheet().getByRole('button', { name: 'Save' }).click()
await sheet().waitFor({ state: 'detached', timeout: 10000 })
await settle(600)
let plain = await byId(untimed.id)
check('saving without picking a time leaves the note empty and the date as it was', plain.weight === 5.5 && plain.notes === '' && plain.date === day(0), `${plain.weight} "${plain.notes}" ${plain.date}`)
await page.locator('.growth-row').nth(1).click()
await sheet().waitFor()
await settle(400)
await sheet().locator('input[type="datetime-local"]').fill(`${day(0)}T${hhmm(pickA)}`)
await settle(200)
check('picking a time shows it in the sheet', (await sheet().locator('.time-field-value').innerText()).trim() === `Today, ${clock(pickA)}`, (await sheet().locator('.time-field-value').innerText()).trim())
await sheet().getByRole('button', { name: 'Save' }).click()
await sheet().waitFor({ state: 'detached', timeout: 10000 })
await settle(600)
plain = await byId(untimed.id)
check('the picked time is written as the note’s clock segment', plain.notes === clock(pickA), `"${plain.notes}"`)

// ---- A new weight from the sheet: the clock goes first, the user’s note after it
await page.getByRole('button', { name: '+ Add' }).click()
await sheet().waitFor()
await settle(400)
check('a new entry defaults to now', /^Today, /.test((await sheet().locator('.time-field-value').innerText()).trim()))
await sheet().locator('input[type="datetime-local"]').fill(`${day(0)}T${hhmm(pickB)}`)
await sheet().getByLabel('Pounds').fill('6'); await sheet().getByLabel('Ounces').fill('1.6')
// An empty note is one quiet line until tapped.
await sheet().getByRole('button', { name: '+ Add a note' }).click()
await sheet().getByLabel('Notes').fill('at the clinic')
await settle(200)
await shot('05-add-weight')
await sheet().getByRole('button', { name: 'Save' }).click()
await sheet().waitFor({ state: 'detached', timeout: 10000 })
await settle(800)
const added = (await weights()).find((w) => w.weight === 6.1)
check('the new weight stores "<clock> · at the clinic"', added && added.notes === `${clock(pickB)} · at the clinic` && added.date === day(0), added ? `"${added.notes}" ${added.date}` : 'not found')
const afterText = (await page.locator('.growth-row').allInnerTexts()).map((t) => t.replace(/\n/g, ' '))
check('the Child page sorts the day by clock, latest first', afterText.map((t) => (t.match(/\d{1,2}:\d{2} [AP]M/) ?? [''])[0]).join(' | ') === byClock, `${afterText.join(' || ')} (expected ${byClock})`)
await page.locator('.growth-history').scrollIntoViewIfNeeded()
await shot('06-child-after')

// ---- Home again
await page.goto(BASE + '/')
await settle(1200)
await rows.first().waitFor({ timeout: 10000 })
const times2 = await rows.locator('.tl-time').allInnerTexts()
check('Home lists the four weights by clock', times2.join(' | ') === byClock, `${times2.join(' | ')} (expected ${byClock})`)
await page.locator('.tl-list').scrollIntoViewIfNeeded()
await shot('07-home-after')

check('no console or page errors', problems.length === 0, problems.join(' ; '))
await browser.close()
const failed = checks.filter((c) => !c.ok)
console.log(`\n${THEME}: ${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length ? 1 : 0)
