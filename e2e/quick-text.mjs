/**
 * Type it on Home: a typed line ("60 ml bottle 20 min ago", "wet diaper", "pump 90 20 min", "nap 1:30-2:15",
 * "weight 5 lb 6 oz", "temp 99.1", "nursed left 12 min") opens the matching log sheet with its fields filled
 * in; the hint under the field says what was understood first; an unknown line is refused; nothing is ever
 * saved from the field itself. Exits non-zero when a step fails.
 *   node e2e/quick-text.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack (the script creates the child).
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/quick-text'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const SCHEME = process.argv[4] === 'dark' ? 'dark' : 'light'
mkdirSync(OUT, { recursive: true })

let fails = 0
const problems = []
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || detail === undefined ? '' : ` — ${detail}`}`)
  if (!cond) fails += 1
}
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d }
const shownMinutes = (text) => {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(text)
  if (!m) return NaN
  let h = Number(m[1]) % 12
  if (/pm/i.test(m[3])) h += 12
  return h * 60 + Number(m[2])
}
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }
const closeTo = (a, b, tolerance = 1) => Math.abs(((a - b) % 1440 + 1440) % 1440) <= tolerance || Math.abs(((b - a) % 1440 + 1440) % 1440) <= tolerance

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, colorScheme: SCHEME })
await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml', weight: 'lb', length: 'in', temp: 'f' } })) })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/profile')) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`) })
const settle = (ms = 500) => page.waitForTimeout(ms)
let n = 0
const shot = async (name) => { n += 1; await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}-${SCHEME}.png` }) }
const sheet = () => page.locator('dialog[open]').last()
const times = async () => (await sheet().locator('.time-field-value').allInnerTexts()).map(shownMinutes)

// ---- sign in, a child
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
const counts = async () => {
  const out = {}
  for (const k of ['feedings', 'changes', 'pumping', 'sleep', 'weight', 'temperature']) out[k] = (await (await page.request.get(`${BASE}/api/${k}/?child=${child.id}`, { headers })).json()).count ?? 0
  return JSON.stringify(out)
}
const before = await counts()

const field = page.getByLabel('Type what to log')
const hint = page.getByTestId('quick-type-hint')
const go = page.getByRole('button', { name: 'Open the sheet for what was typed' })
check('an idle Type it field keeps only its placeholder (no examples line)', (await field.count()) === 1 && (await hint.count()) === 0 && /60 ml bottle 3pm/.test(await field.getAttribute('placeholder')))
await field.focus()
await page.waitForTimeout(150)
check('focusing it shows the examples under it', /^Try: 60 ml bottle 3pm · wet diaper/.test(await hint.innerText()), await hint.innerText())
check('Go reads as idle until something is understood', /\bidle\b/.test(await go.getAttribute('class')))

const typeIt = async (text) => {
  await field.fill(text)
  await settle(250)
  const h = await hint.innerText()
  await field.press('Enter')
  await settle(700)
  return h
}
const closeSheet = async () => { await sheet().getByRole('button', { name: 'Close' }).click(); await settle(400) }

// ---- the field as it reads a line (a look at it before anything opens)
await page.getByTestId('quick-type').scrollIntoViewIfNeeded()
await field.fill('60 ml bottle 20 min ago')
await settle(300)
await shot('typed')
await field.fill('')

// ---- a bottle with its amount and a time
let h = await typeIt('60 ml bottle 20 min ago')
check('the hint says what was understood before opening', /^Bottle · 60 mL · \d{1,2}:\d{2} [AP]M · opens the sheet to check and save$/.test(h), h)
check('the feeding sheet opens on Bottle with the amount filled', /Add feeding/.test(await sheet().innerText()) && (await sheet().getByRole('spinbutton', { name: 'Amount in mL' }).inputValue()) === '60', await sheet().getByRole('spinbutton', { name: 'Amount in mL' }).inputValue().catch(() => 'no field'))
let t = await times()
check('…at the typed time (20 min ago)', closeTo(t[0], nowMinutes() - 20), `shown ${t[0]} now ${nowMinutes()}`)
check('the field is cleared once the sheet opened', (await field.inputValue()) === '')
await shot('bottle-sheet')
await closeSheet()

// ---- a diaper
h = await typeIt('wet diaper')
check('diaper hint', h.startsWith('Diaper · wet · just now'), h)
check('the diaper sheet opens with Pee chosen', /Add diaper/.test(await sheet().innerText()) && (await sheet().getByRole('radio', { name: 'Pee' }).getAttribute('aria-checked')) === 'true')
await closeSheet()

// ---- pumping with the volume and the length
h = await typeIt('pump 90 20 min')
check('pumping hint', h.startsWith('Pumping · 90 mL · 20 min · finished just now'), h)
t = await times()
check('the pumping sheet opens with 90 mL, finished now, 20 min long', /Add pumping/.test(await sheet().innerText()) && (await sheet().getByLabel('Volume in mL').inputValue()) === '90' && closeTo(t[1], nowMinutes()) && closeTo(t[1] - t[0], 20), `${t.join('→')} volume ${await sheet().getByLabel('Volume in mL').inputValue()}`)
await shot('pumping-sheet')
await closeSheet()

// ---- a nap as a range
h = await typeIt('nap 1:30-2:15')
check('nap hint', /^Nap · 1:30 PM(?: \w{3} \d+)?–2:15 PM(?: \w{3} \d+)?/.test(h), h)
t = await times()
check('the sleep sheet opens on Nap with both times', /Add sleep/.test(await sheet().innerText()) && (await sheet().getByRole('tab', { name: 'Nap' }).getAttribute('aria-selected')) === 'true' && t[0] === 13 * 60 + 30 && t[1] === 14 * 60 + 15, `${t.join('→')}`)
await shot('nap-sheet')
await closeSheet()

// ---- weight in pounds and ounces, in the phone's decimal pounds
h = await typeIt('weight 5 lb 6 oz')
check('weight hint', h.startsWith('Weight · 5 lb 6 oz'), h)
check('the growth sheet opens on weight with 5 lb 6 oz (5.375 lb)', /Add growth/.test(await sheet().innerText()) && (await sheet().getByLabel('Pounds').inputValue()) === '5' && (await sheet().getByLabel('Ounces').inputValue()) === '6', await sheet().getByLabel('Ounces').inputValue().catch(() => 'no field'))
await closeSheet()

// ---- a temperature
h = await typeIt('temp 99.1')
check('temperature hint', h.startsWith('Temperature · 99.1°F · just now'), h)
check('the temperature sheet opens with 99.1', /Add temperature/.test(await sheet().innerText()) && (await sheet().getByLabel('Temperature', { exact: true }).inputValue()) === '99.1')
await closeSheet()

// ---- nursing with a side and minutes
h = await typeIt('nursed left 12 min')
check('nursing hint', h.startsWith('Nursing · left · 12 min · just now'), h)
check('the feeding sheet opens on Nursing with 12 min on the left', /Add feeding/.test(await sheet().innerText()) && (await sheet().getByLabel('Left (min)').inputValue()) === '12' && (await sheet().getByLabel('Right (min)').inputValue()) === '')
await closeSheet()

// ---- a line it cannot read
await field.fill('hello there')
await settle(250)
check('an unknown line keeps Go idle and shows the examples', /\bidle\b/.test(await go.getAttribute('class')) && /^Try:/.test(await hint.innerText()), await hint.innerText())
await field.press('Enter')
await settle(400)
check('…and says so when sent anyway', /^Did not get "hello there"\. Try:/.test(await hint.innerText()) && (await page.locator('dialog[open]').count()) === 0, await hint.innerText())
await page.getByTestId('quick-type').scrollIntoViewIfNeeded()
await settle(200)
await shot('missed')

// ---- nothing was written by any of it
check('nothing was saved by the field itself', (await counts()) === before, `${before} → ${await counts()}`)

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
