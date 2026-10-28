/**
 * Settings › Born early: the weeks at birth and the NICU stay, two facts the app works from. Before they are set the
 * entries already logged are judged by age; once set (no re-entry, nothing migrated): Home's band says where things
 * stand instead of predicting a nap, the Child page shows the weeks and the due date, Reports shows the numbers with no
 * age verdicts, Reports › Pumping's tiles read Mom's sessions and volume against NICU targets, and the Stash takes bags to
 * the NICU (colostrum tagged, no runway or premade bottles). Came home keeps the
 * hold until the due date; clearing both puts everything back.
 *   node e2e/born-early.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack (the script creates the child and seeds the last five days).
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/born-early'
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
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d }
const at = (daysBack, h) => { const d = daysAgo(daysBack); d.setHours(h, 0, 0, 0); return d }
const BORN_DAYS_AGO = 40
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const birth = daysAgo(BORN_DAYS_AGO)
// 26 wk 2 d = 184 days: due 96 days after the birth, 56 days from today.
const due = new Date(birth.getFullYear(), birth.getMonth(), birth.getDate() + 96)
const dueText = `${MONTHS[due.getMonth()]} ${due.getDate()}`
const pmaDays = 184 + BORN_DAYS_AGO
const pmaText = `${Math.floor(pmaDays / 7)} wk${pmaDays % 7 ? ` ${pmaDays % 7} d` : ''} corrected`

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
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

// ---- sign in; a child born 40 days ago
await page.goto(BASE + '/signin')
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1200)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Leo')
  await page.getByLabel('Birth date or due date').fill(ymd(birth))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
}
await settle(1200)
const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
const post = (path, data) => page.request.post(BASE + path, { headers, data: { child: child.id, ...data } })

// What they logged before Born early existed: the last five full days of pumping (7 a day, one at 2 AM, 60 mL
// each: 420 mL a day), and yesterday's bottles and diapers.
for (let d = 1; d <= 5; d++) {
  for (const h of [2, 6, 9, 12, 15, 18, 21]) {
    const s = at(d, h)
    const e = new Date(s.getTime() + 15 * 60_000)
    await post('/api/pumping/', { start: s.toISOString(), end: e.toISOString(), amount: 60, notes: '', tags: [] })
  }
}
for (const h of [7, 10, 13, 16]) await post('/api/feedings/', { start: at(1, h).toISOString(), end: at(1, h).toISOString(), type: 'breast milk', method: 'bottle', amount: 25, notes: '', tags: [] })
for (const h of [9, 15]) await post('/api/changes/', { time: at(1, h).toISOString(), wet: true, solid: false, color: '', amount: null, notes: '', tags: [] })

// ---- before: judged by the real age
await page.goto(BASE + '/reports')
await settle(1000)
await page.getByRole('tab', { name: 'Summary' }).click()
await settle(400)
await page.getByRole('button', { name: 'Feeding', exact: true }).click()
await settle(1000)
check('before Born early is set, Feeding compares with the real age', /Typical for this age/.test(squash(await page.locator('main').innerText())))

// ---- Settings › Born early
await page.goto(BASE + '/settings')
await settle(1000)
const row = page.getByRole('button', { name: /Born early/ })
check('Settings › Tracking has a Born early row, off by default', (await row.count()) === 1 && /Corrected age and the NICU stay/.test(squash(await row.innerText())), squash(await row.innerText()))
await row.click()
await settle(600)
const sheet = page.locator('dialog[open]')
check('the sheet opens with nothing set and Save off', (await sheet.getByLabel('Weeks at birth').inputValue()) === '' && (await sheet.getByRole('button', { name: 'Save' }).isDisabled()))
await sheet.getByLabel('Weeks at birth').selectOption('26')
await sheet.getByLabel('Days').selectOption('2')
await settle(300)
check('… the due date and the weeks today show as you pick', squash(await sheet.getByTestId('preterm-due').innerText()) === `Due date ${dueText}, ${due.getFullYear()} · today ${pmaText}`, squash(await sheet.getByTestId('preterm-due').innerText()))
await sheet.getByRole('tab', { name: 'In the NICU', exact: true }).click()
await settle(300)
check('… In the NICU starts on the birth date', (await sheet.getByLabel('In the NICU from').inputValue()) === ymd(birth))
check('… nothing wider than the screen', await noOverflow())
await shot('sheet')
await sheet.getByRole('button', { name: 'Save' }).click()
await settle(1200)
check('Save closes it and the row says what is set', squash(await row.innerText()).includes(`Born at 26 wk 2 d · in the NICU since ${MONTHS[birth.getMonth()]} ${birth.getDate()}`), squash(await row.innerText()))
const stored = await (await page.request.get(BASE + `/bramble/settings/${child.id}`, { headers })).json()
check('… stored on the companion as the shared child settings', stored.bornAtDays === 184 && stored.nicu?.since === ymd(birth) && stored.nicu?.home === null, JSON.stringify({ b: stored.bornAtDays, n: stored.nicu }))

// ---- Home: the band says where things stand, no nap prediction
await page.goto(BASE + '/')
await settle(1500)
const band = page.getByTestId('band-held')
check('Home: the band says In the NICU with the weeks and the due date, no nap prediction', (await band.count()) === 1 && squash(await band.innerText()).includes(`In the NICU · ${pmaText} · due ${dueText}`) && (await page.locator('.band-live').count()) === 0, (await band.count()) ? squash(await band.innerText()) : 'no held band')
await shot('home')

// ---- Child page: the weeks and the due date beside the real age
await page.goto(BASE + '/child')
await settle(1200)
const corrected = page.getByTestId('corrected-age')
check('Child page: the weeks and the due date beside the real age', (await corrected.count()) === 1 && squash(await corrected.innerText()) === `${pmaText} · due ${dueText}`, (await corrected.count()) ? squash(await corrected.innerText()) : 'none')
check('… and says in the NICU', /in the NICU/.test(squash(await page.locator('.child-hero').innerText())))
await shot('child')

// ---- Reports: the numbers, no verdicts by age
await page.goto(BASE + '/reports')
await settle(1000)
await page.getByRole('tab', { name: 'Day' }).click()
await settle(400)
await page.getByRole('button', { name: /Previous day/ }).click().catch(() => {})
await settle(800)
const dayText = squash(await page.locator('main').innerText())
check('Reports › Day: the tiles carry no "typical" range', !/typical \d/.test(dayText), dayText.slice(0, 300))
await page.getByRole('tab', { name: 'Summary' }).click()
await settle(400)
await page.getByRole('button', { name: 'Feeding', exact: true }).click()
await settle(1000)
const feedText = squash(await page.locator('main').innerText())
check('Reports › Feeding: no age row, no amount by weight; says why', !/Typical for this age/.test(feedText) && (await page.getByTestId('by-weight-band').count()) === 0 && /Not compared with age norms while in the NICU\./.test(feedText))
await page.getByRole('button', { name: 'Diapers', exact: true }).click()
await settle(800)
const wet = squash(await page.getByTestId('wet-verdict').innerText())
check('Reports › Diapers: the wet count without a verdict', /^Wet diapers (average|:)/.test(wet) && /Not compared with age norms while in the NICU\./.test(wet) && !(await page.getByTestId('wet-verdict').evaluate((e) => e.classList.contains('is-low'))), wet)

// ---- Reports › Pumping: NICU targets in the tiles, from what was already logged
await page.getByRole('button', { name: 'Pumping', exact: true }).click()
await settle(1200)
const sessions = page.getByTestId('pump-sessions-day')
const volume = page.getByTestId('pump-volume-day')
check('Reports › Pumping: Sessions / day against 8 with the nights', (await sessions.count()) === 1 && squash(await sessions.innerText()) === 'Sessions / day 7.0 aim 8 a day · 5 of 5 days with one at night', (await sessions.count()) ? squash(await sessions.innerText()) : 'none')
check('… Volume / day against full supply after two weeks (420 mL is borderline: said, not marked red)', squash(await volume.innerText()) === 'Volume / day 420 mL borderline (350–500 mL) · full supply is 750 mL' && !(await volume.evaluate((e) => e.classList.contains('is-missed'))), squash(await volume.innerText()))
check('… nothing wider than the screen', await noOverflow())
await shot('pumping')
await page.getByRole('button', { name: 'About this chart' }).first().click().catch(() => {})
check('… the fold names the sources', (await page.getByTestId('nicu-pump-note').count()) === 1 && /8 or more sessions/.test(await page.getByTestId('nicu-pump-note').textContent()))

// ---- Stash in the NICU: what goes in and what went in; colostrum tagged; no runway or premade bottles
const milk = (data) => page.request.post(BASE + '/bramble/milk', { headers, data: { child: child.id, ...data } })
// Colostrum from day 2 (frozen), and two fridge bags from the last day.
await milk({ pumped_at: at(BORN_DAYS_AGO - 1, 9).toISOString(), volume_ml: 4, location: 'freezer', client_key: `be-colostrum-${Date.now()}` })
await milk({ pumped_at: at(1, 9).toISOString(), volume_ml: 60, location: 'fridge', client_key: `be-fridge-a-${Date.now()}` })
await milk({ pumped_at: at(0, 1).toISOString(), volume_ml: 45, location: 'fridge', client_key: `be-fridge-b-${Date.now()}` })
await page.goto(BASE + '/milk')
await settle(1500)
const nicuCard = page.getByTestId('nicu-stash')
check('Stash in the NICU: the NICU card instead of how long the stash lasts, and no premade bottles', (await nicuCard.count()) === 1 && (await page.getByTestId('stash-runway').count()) === 0 && (await page.getByTestId('night-bottles').count()) === 0)
check('… nothing taken in yet, three bags at home', /^Nothing taken in yet/.test(squash(await nicuCard.innerText())) && /At home: 3 bags · 109 mL/.test(squash(await nicuCard.innerText())), squash(await nicuCard.innerText()))
const coloRow = page.getByRole('button', { name: /colostrum/ })
check('… the day-2 bag is tagged Colostrum, the others are not', (await coloRow.count()) === 1 && /Colostrum/.test(await coloRow.innerText()), String(await coloRow.count()))
await shot('stash-nicu')
await nicuCard.getByRole('button', { name: 'Take to the NICU' }).click()
await settle(600)
const tripSheet = page.locator('dialog[open]')
const pickedRows = tripSheet.locator('.bag-row[aria-pressed="true"]')
check('Take to the NICU: colostrum first, the fridge bags picked, the freezer left home', (await tripSheet.locator('.bag-row').count()) === 3 && /colostrum/.test((await tripSheet.locator('.bag-row').first().getAttribute('aria-label')) ?? '') && (await pickedRows.count()) === 2)
const go = tripSheet.getByRole('button', { name: /^Taken in/ })
check('… the button says what goes', squash(await go.innerText()) === 'Taken in · 2 bags · 105 mL', squash(await go.innerText()))
check('… nothing wider than the screen', await noOverflow())
await shot('nicu-trip')
await go.click()
await settle(1500)
check('… taken in: the card counts them and one bag stays at home', /^2 bags · 105 mL taken to the NICU in the last 7 days · last trip/.test(squash(await nicuCard.innerText())) && /At home: 1 bag · 4 mL/.test(squash(await nicuCard.innerText())), squash(await nicuCard.innerText()))
check('… and they left the home stash', (await page.getByTestId('stash-fridge').count()) === 0)
await page.getByRole('button', { name: /Show used and discarded/ }).click()
await settle(400)
check('… the history says Taken to the NICU', (await page.getByText('Taken to the NICU', { exact: false }).count()) >= 2)

// ---- Came home: still held until the due date
await page.goto(BASE + '/settings')
await settle(1000)
await row.click()
await settle(600)
await sheet.getByRole('tab', { name: 'Came home' }).click()
await sheet.getByLabel('Came home on').fill(ymd(daysAgo(1)))
await settle(300)
await sheet.getByRole('button', { name: 'Save' }).click()
await settle(1200)
check('Came home: the row says so', /home since/.test(squash(await row.innerText())), squash(await row.innerText()))
await page.goto(BASE + '/')
await settle(1500)
check('… Home: still no nap prediction before the due date', (await band.count()) === 1 && squash(await band.innerText()).includes(`Home before the due date · ${pmaText} · due ${dueText}`) && /Naps are predicted from Leo's due date/.test(squash(await band.innerText())), (await band.count()) ? squash(await band.innerText()) : 'none')

// ---- clearing both puts everything back
await page.goto(BASE + '/settings')
await settle(1000)
await row.click()
await settle(600)
await sheet.getByLabel('Weeks at birth').selectOption('')
await sheet.getByRole('tab', { name: 'Not in the NICU', exact: true }).click()
await sheet.getByRole('button', { name: 'Save' }).click()
await settle(1200)
check('cleared: the row is off again', /Corrected age and the NICU stay/.test(squash(await row.innerText())))
await page.goto(BASE + '/')
await settle(1500)
check('… Home: the live band is back', (await page.locator('.band-live').count()) === 1 && (await band.count()) === 0)

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
