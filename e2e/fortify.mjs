/**
 * Calories and fortified breast milk. Settings › Calories & fortifying takes the doctor's goal (kcal per kg a day) and
 * the fortification (24 kcal/oz with formula powder); the Stash tab then has the recipe for any amount; premade
 * bottles can be made fortified (24 hours from mixing, the strength on the spot); a fortified bottle logged from the
 * bottle sheet says its calories and keeps its strength as a `kcal:24` tag; Reports › Feeding leads with the calories
 * a day and per kg against the goal.
 *   MOCK_BB=http://127.0.0.1:<bb-port> node e2e/fortify.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack.
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/fortify'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const SCHEME = process.argv[4] === 'dark' ? 'dark' : 'light'
const BB = process.env.MOCK_BB ?? 'http://127.0.0.1:8000'
if (![BASE, BB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) {
  console.error('Refusing to run against a non-local stack: this probe writes entries.')
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
const HOUR = 3_600_000

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
const sheet = () => page.locator('dialog[open]').last()
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)

// ---- sign in; a child of 5 weeks, 6 lb
await page.goto(BASE + '/signin')
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1200)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Birth date or due date').fill(ymd(daysAgo(35)))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
}
await settle(1200)
const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
const api = async (method, path, body) => {
  const r = await fetch(BB + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }
}
const companion = async (method, path, body) => {
  const r = await fetch(`${BASE}/bramble${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const child = (await api('GET', '/api/children/')).body.results[0]
for (const f of (await api('GET', `/api/feedings/?child=${child.id}`)).body.results ?? []) await api('DELETE', `/api/feedings/${f.id}/`)
for (const b of (await companion('GET', `/milk?child=${child.id}`)).body ?? []) await companion('DELETE', `/milk/${b.id}`)
await companion('PUT', `/settings/${child.id}`, { calorieGoal: null, fortify: null })
// 6 lb (2.72 kg) weighed three days ago; yesterday five 90 mL bottles fortified to 24 kcal/oz (365 kcal, 134 kcal/kg)
await api('POST', '/api/weight/', { child: child.id, weight: 6, date: ymd(daysAgo(3)), notes: '9:00 AM' })
const yesterday = (h) => { const d = daysAgo(1); d.setHours(h, 0, 0, 0); return d.toISOString() }
for (const h of [3, 7, 11, 15, 19]) await api('POST', '/api/feedings/', { child: child.id, start: yesterday(h), end: yesterday(h), type: 'fortified breast milk', method: 'bottle', amount: 90, notes: '', tags: ['kcal:24'] })

// ---- Settings › Calories & fortifying
await page.goto(BASE + '/settings')
await settle(1000)
const row = page.getByRole('button', { name: /Calories & fortifying/ })
check('Settings has a Calories & fortifying row saying what it is for', (await row.count()) === 1 && /Calorie goal and fortified milk/.test(squash(await row.innerText())), (await row.count()) ? squash(await row.innerText()) : 'missing')
await row.click()
await settle(700)
await sheet().getByLabel('kcal per kg a day').fill('150')
await sheet().getByRole('tab', { name: 'Fortifying', exact: true }).click()
await settle(300)
check('fortifying starts at 24 kcal/oz with formula powder', (await sheet().getByRole('radio', { name: '24', exact: true }).getAttribute('aria-checked')) === 'true' && (await sheet().getByRole('tab', { name: 'Formula powder' }).getAttribute('aria-selected')) === 'true')
const preview = sheet().getByTestId('fortify-preview')
check('… and previews the recipe for 120 mL', /^120 mL of breast milk \+ 1¾ teaspoons of powder makes about 2[34]\.\d kcal\/oz/.test(squash(await preview.innerText())), squash(await preview.innerText()))
await sheet().getByRole('tab', { name: 'Liquid concentrate' }).click()
await settle(200)
check('liquid concentrate is one part to four: 30 mL for 120 mL', /\+ 30 mL of liquid concentrate makes about 24 kcal\/oz/.test(squash(await preview.innerText())), squash(await preview.innerText()))
await sheet().getByRole('tab', { name: 'Formula powder' }).click()
await sheet().getByRole('radio', { name: 'Similac' }).click()
await shot('settings-sheet')
check('the sheet folds its research and safety notes away', (await sheet().locator('details:not([open])').count()) >= 1 && /CDC advises liquid rather than powdered formula/.test(await sheet().locator('details').first().textContent()))
await sheet().getByRole('button', { name: 'Save', exact: true }).click()
await settle(1000)
check('the row now says the strength, the powder and the goal', /24 kcal\/oz · Similac · goal 150 kcal\/kg/.test(squash(await row.innerText())), squash(await row.innerText()))
const stored = (await companion('GET', `/settings/${child.id}`)).body
check('… shared on the server for every phone', stored.calorieGoal === 150 && stored.fortify?.kcalPerOz === 24 && stored.fortify?.powder === 'similac' && stored.fortify?.with === 'powder', JSON.stringify(stored.fortify))

// ---- Stash: the recipe for any amount
const bags = []
for (const [ml, key] of [[120, 'a'], [100, 'b']]) bags.push((await companion('POST', '/milk', { child: child.id, pumped_at: new Date(Date.now() - 5 * HOUR).toISOString(), volume_ml: ml, location: 'fridge', client_key: `fortify-${key}-${Date.now()}` })).body)
await page.goto(BASE + '/milk')
await settle(1200)
const card = page.getByTestId('fortify-card')
check('the Stash tab has the recipe card while fortifying', (await card.count()) === 1 && /Fortify to 24 kcal\/oz/.test(squash(await card.innerText())))
await card.getByRole('spinbutton', { name: 'Breast milk in mL' }).fill('150')
await settle(200)
check('… 150 mL takes 2¼ teaspoons of Similac powder (its teaspoon is the lightest)', /^Add 2¼ teaspoons of powder makes 15\d mL at about 2[34]\.\d kcal\/oz/.test(squash(await card.getByTestId('fortify-out').innerText())), squash(await card.getByTestId('fortify-out').innerText()))
await card.getByRole('spinbutton', { name: 'Breast milk in mL' }).fill('10')
await settle(200)
check('… too little milk to measure says the smallest batch', /Too little to measure accurately: mix at least \d+ mL at a time/.test(squash(await card.getByTestId('fortify-out').innerText())), squash(await card.getByTestId('fortify-out').innerText()))
check('… with the chart of common amounts', (await card.locator('tbody tr').count()) === 6)
check('nothing wider than the screen on the Stash tab', !(await overflow()))
await card.scrollIntoViewIfNeeded()
await shot('stash-card')

// ---- premade bottles, fortified: the recipe per bottle, 24 hours from mixing
await page.getByTestId('night-bottles').getByRole('button', { name: 'Make premade bottles' }).click()
await settle(800)
await sheet().getByRole('spinbutton', { name: 'Each bottle in mL' }).fill('90')
await sheet().getByRole('radio', { name: '2', exact: true }).click()
await settle(300)
check('the make sheet fortifies by default, at the household strength', (await sheet().getByRole('tab', { name: 'Fortified · 24' }).getAttribute('aria-selected')) === 'true')
const planText = squash(await sheet().getByTestId('night-plan').innerText())
check('… each bottle says what to stir in', (planText.match(/Add [^→]+ of powder → 2[34]\.\d kcal\/oz/g) ?? []).length === 2, planText)
check('… and that it keeps 24 hours from mixing', /Fortified bottles keep 24 hours from now/.test(await sheet().innerText()))
await shot('make-fortified')
await sheet().getByRole('button', { name: 'Make 2 bottles' }).click()
await settle(1500)
const made = (await companion('GET', `/milk?child=${child.id}&status=stored`)).body.filter((b) => b.kind === 'bottle')
const keeps = made.map((b) => (new Date(b.expires_at) - new Date(b.mixed_at)) / HOUR)
check('the bottles are fortified to 24 and keep 24 hours from mixing', made.length === 2 && made.every((b) => b.kcal_per_oz === 24) && keeps.every((h) => Math.abs(h - 24) < 0.01), JSON.stringify(made.map((b) => [b.spot, b.kcal_per_oz, b.volume_ml])))
check('… holding the milk plus what the powder takes up', made.every((b) => b.volume_ml > 90 && b.volume_ml < 95), made.map((b) => b.volume_ml).join(', '))
const spot1 = page.getByRole('button', { name: /^Premade bottle 1, .* fortified to 24 kcal\/oz/ })
check('the spot tile names its strength', (await spot1.count()) === 1 && /24 kcal/.test(squash(await spot1.innerText())), (await spot1.count()) ? squash(await spot1.innerText()) : 'missing')
await page.getByTestId('night-bottles').scrollIntoViewIfNeeded()
await shot('spots')

// ---- the bottle sheet: a fortified premade bottle is fortified milk with its calories
await page.goto(BASE + '/')
await settle(1200)
await page.getByRole('button', { name: /^Bottle/ }).first().click()
await settle(900)
await sheet().getByRole('button', { name: /^Premade bottle 1/ }).click()
await settle(500)
check('picking the fortified bottle makes the feed Fortified', (await sheet().getByRole('radio', { name: 'Fortified' }).getAttribute('aria-checked')) === 'true')
await sheet().getByRole('spinbutton', { name: 'Amount in mL' }).fill('60')
await settle(300)
check('… and says its calories at the bottle strength (60 mL at 24: 49 kcal)', /^About 49 kcal · 24 kcal\/oz$/.test(squash(await sheet().getByTestId('bottle-kcal').innerText())), squash(await sheet().getByTestId('bottle-kcal').innerText()))
await shot('bottle-sheet')
await sheet().getByRole('button', { name: 'Save', exact: true }).click()
await settle(1500)
const latest = (await api('GET', `/api/feedings/?child=${child.id}`)).body.results.sort((a, b) => b.start.localeCompare(a.start))[0]
check('the feeding is saved as fortified with its strength tag beside the caregiver', latest.type === 'fortified breast milk' && latest.tags.includes('kcal:24') && latest.tags.some((t) => t.startsWith('caregiver:')), JSON.stringify(latest.tags))
check('the timeline names the strength', /fortified 24/.test(squash(await page.locator('.tl-row', { hasText: 'Bottle' }).first().innerText())), squash(await page.locator('.tl-row', { hasText: 'Bottle' }).first().innerText()))

// ---- Reports › Feeding leads with the calories against the goal
await page.goto(BASE + '/reports')
await settle(1000)
await page.getByRole('tab', { name: 'Summary' }).click()
await settle(500)
await page.getByRole('button', { name: 'Feeding', exact: true }).click()
await settle(1200)
const names = (await page.locator('section.card', { has: page.getByTestId('kcal-per-day') }).locator(':scope > .stat-grid .stat-name').allInnerTexts()).map(squash)
check('the Feeding tiles lead with the calories while fortifying', JSON.stringify(names.slice(0, 2)) === JSON.stringify(['Calories / day', 'kcal / kg / day']), names.join(', '))
check('… 365 kcal a day, 73 a bottle', /^Calories \/ day 365 kcal about 73 a bottle$/.test(squash(await page.getByTestId('kcal-per-day').innerText())), squash(await page.getByTestId('kcal-per-day').innerText()))
check('… 134 kcal/kg against the doctor goal of 150, marked under', /^kcal \/ kg \/ day 134 goal 150$/.test(squash(await page.getByTestId('kcal-per-kg').innerText())) && (await page.getByTestId('kcal-per-kg').evaluate((e) => e.classList.contains('is-missed'))), squash(await page.getByTestId('kcal-per-kg').innerText()))
check('… the verdict says how much a day reaches it', /^Bottles give 134 kcal per kg a day, under the doctor's 150\. At 24 kcal\/oz that goal is about 50\d mL a day at 6 lb\.$/.test(squash(await page.getByTestId('kcal-verdict').innerText())), squash(await page.getByTestId('kcal-verdict').innerText()))
check('nothing wider than the screen on Reports', !(await overflow()))
await shot('reports-feeding')

// ---- the pediatrician report carries it
await page.goto(BASE + '/report')
await settle(1500)
const report = squash(await page.locator('main').innerText())
check('the pediatrician report lists calories by bottle and kcal per kg with the goal', /Calories by bottle a day 365 kcal/.test(report) && /kcal per kg a day \(goal 150\) 134/.test(report), report.slice(0, 600))

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
