/**
 * Premade bottles mixed as one batch, and two kinds of powder. A can typed in has no published spoon weight: grams for
 * a scale and whole level scoops only, with the one-tap bottle size that fits a scoop. Enfamil A.R. has its maker's
 * own spoon measure (about 2 g a level teaspoon) and its maker's limit: never past 24 kcal/oz, refused in Settings and
 * never rounded past. Make premade bottles leads with four numbered steps (all the milk, the formula once, the maker's
 * mixing note, what to pour into each bottle); Bottle by bottle puts the measure on each bottle instead.
 *   MOCK_BB=http://127.0.0.1:<bb-port> node e2e/batch-mix.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack.
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/batch-mix'
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

// ---- sign in; a child of 5 weeks
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
await companion('PUT', `/settings/${child.id}`, { caloriesOn: null, calorieGoal: null, fortify: null, formulaKcalPerOz: null })

const openCalories = async () => {
  await page.goto(BASE + '/settings')
  await settle(1000)
  await page.getByRole('button', { name: /Calories & fortifying/ }).click()
  await settle(700)
}
const preview = () => sheet().getByTestId('fortify-preview')
const chartRows = async () => (await sheet().locator('.fortify-table tbody tr').allInnerTexts()).map(squash)
const openMake = async (size, count) => {
  await page.goto(BASE + '/milk')
  await settle(1200)
  await page.getByTestId('night-bottles').getByRole('button', { name: 'Make premade bottles' }).click()
  await settle(800)
  await sheet().getByRole('spinbutton', { name: 'Each bottle in mL' }).fill(String(size))
  await sheet().getByRole('radio', { name: String(count), exact: true }).click()
  await settle(400)
}
const steps = () => sheet().getByTestId('batch-steps')
const text = async (id) => squash(await steps().getByTestId(id).innerText())
for (const [ml, key] of [[200, 'a'], [200, 'b']]) await companion('POST', '/milk', { child: child.id, pumped_at: new Date(Date.now() - 6 * HOUR).toISOString(), volume_ml: ml, location: 'fridge', client_key: `batch-${key}-${Date.now()}` })

// ---- a can typed in (45 kcal and 9 g a scoop): no spoon weight is known, so grams and whole scoops only
await openCalories()
await sheet().getByRole('tab', { name: 'On', exact: true }).click()
await sheet().getByRole('tab', { name: 'Fortifying', exact: true }).click()
await settle(300)
await sheet().getByRole('radio', { name: 'From the can' }).click()
await sheet().getByLabel('kcal in a scoop').fill('45')
await sheet().getByLabel('grams in a scoop').fill('9')
await settle(300)
check('a can typed in is weighed, with no spoons: 120 mL takes 3.7 g', /^120 mL of breast milk takes 3\.7 g of powder on a scale for 24 kcal\/oz/.test(squash(await preview().innerText())) && !/teaspoon|tablespoon/.test(await preview().innerText()), squash(await preview().innerText()))
const canRows = await chartRows()
check('… its chart has a scale column only: 60 mL 1.9 g … 240 mL 7.4 g', (await sheet().locator('.fortify-table thead th').count()) === 2 && canRows[0] === '60 mL 1.9 g' && canRows[5] === '240 mL 7.4 g' && !/spoon/.test(await sheet().locator('.fortify-table').innerText()), canRows.join(' | '))
const scaleNote = sheet().getByTestId('scale-note')
check('… and says why, with the one-scoop rule for a family with no scale', /^This formula has no published weight for a teaspoon, so Bramble gives grams for a scale and never guesses spoons\. With no scale: 1 level scoop from the can is right for 291 mL of milk\.$/.test(squash(await scaleNote.innerText())) && (await sheet().getByTestId('spoon-note').count()) === 0, (await scaleNote.count()) ? squash(await scaleNote.innerText()) : 'missing')
await sheet().getByRole('button', { name: 'Save', exact: true }).click()
await settle(1000)
await openMake(72, 5)
check('five bottles from a typed-in can: 360 mL of milk, 11.1 g on a scale', (await text('batch-milk')) === '360 mL' && /Add the formula powder/.test(await steps().locator('li').nth(1).innerText()) && (await text('batch-add')) === '11.1 g' && (await text('batch-add-note')) === 'On a kitchen scale.', `${await text('batch-add')} · ${await text('batch-add-note')}`)
check('… with the bottle size that fits the scoop offered for a family with no scale', (await text('batch-fit')) === 'No scale? 5 bottles of 58 mL take exactly 1 level scoop from the can.', await text('batch-fit'))
await steps().scrollIntoViewIfNeeded()
await shot('batch-can')
await steps().getByRole('button', { name: 'Make them 58 mL' }).click()
await settle(400)
check('… one tap makes the batch fit: 5 × 58 mL, 9 g or 1 level scoop from the can, and the offer is gone', (await sheet().getByRole('spinbutton', { name: 'Each bottle in mL' }).inputValue()) === '58' && (await text('batch-milk')) === '290 mL' && (await text('batch-add')) === '9 g' && (await text('batch-add-note')) === 'On a kitchen scale, or 1 level scoop from the can.' && (await steps().getByTestId('batch-fit').count()) === 0, `${await text('batch-milk')} · ${await text('batch-add')} · ${await text('batch-add-note')}`)
await page.keyboard.press('Escape')
await settle(400)

// ---- Enfamil A.R.: its maker's own spoon measure and its maker's limit
await openCalories()
check('Enfamil A.R. is one of the powders', (await sheet().getByRole('radio', { name: 'Enfamil A.R.' }).count()) === 1)
await sheet().getByRole('radio', { name: 'Enfamil A.R.' }).click()
await sheet().getByRole('radio', { name: '26', exact: true }).last().click()
await settle(300)
check('26 kcal/oz with Enfamil A.R. is refused in words: no recipe, Save off', /Enfamil A\.R\. should not be mixed stronger than 24 kcal\/oz: its maker says it gets too thick\. For 26, ask the doctor which formula to use\./.test(squash(await sheet().innerText())) && (await preview().count()) === 0 && (await sheet().locator('.fortify-table').count()) === 0 && (await sheet().getByRole('button', { name: 'Save', exact: true }).isDisabled()))
await shot('settings-ar-limit')
await sheet().getByRole('radio', { name: '24', exact: true }).last().click()
await settle(300)
check('at 24 its recipe is in teaspoons and grams: 120 mL takes 1¾ teaspoons, or 3.7 g', /^120 mL of breast milk takes 1¾ teaspoons of Enfamil A\.R\., or 3\.7 g on a scale for 24 kcal\/oz/.test(squash(await preview().innerText())), squash(await preview().innerText()))
const arRows = await chartRows()
check('the chart has the scale and the spoons: 60 mL 1.9 g ⅞ teaspoon … 240 mL 7.4 g 1 tablespoon + ⅝ teaspoon', (await sheet().locator('.fortify-table thead th').count()) === 3 && arRows[0] === '60 mL 1.9 g ⅞ teaspoon' && arRows[2] === '120 mL 3.7 g 1¾ teaspoons' && arRows[5] === '240 mL 7.4 g 1 tablespoon + ⅝ teaspoon', arRows.join(' | '))
check('… with the note that the scale is exact and the spoons are rounded', (await sheet().getByTestId('spoon-note').count()) === 1 && (await sheet().getByTestId('scale-note').count()) === 0)
await sheet().locator('.fortify-table').scrollIntoViewIfNeeded()
await shot('settings-ar')
check('nothing wider than the screen in Settings', !(await overflow()))
await sheet().getByRole('button', { name: 'Save', exact: true }).click()
await settle(1000)
const stored = (await companion('GET', `/settings/${child.id}`)).body
check('saved for the household: 24 kcal/oz with Enfamil A.R.', stored.caloriesOn === true && stored.fortify?.kcalPerOz === 24 && stored.fortify?.powder === 'enfamil-ar', JSON.stringify(stored.fortify))

// ---- Make premade bottles: five of 72 mL, mixed as one batch
await openMake(72, 5)
check('the sheet mixes them all together by default, in four numbered steps', (await sheet().getByRole('tab', { name: 'All together' }).getAttribute('aria-selected')) === 'true' && (await steps().locator('li').count()) === 4)
check('step 1: all the milk in one container, 360 mL', (await text('batch-milk')) === '360 mL' && /Pour all the milk into one container/.test(await steps().locator('li').nth(0).innerText()))
check('step 2: the formula measured once, 1 tablespoon + 2½ teaspoons of Enfamil A.R., or 11.1 g on a scale', /Add the Enfamil A\.R\./.test(await steps().locator('li').nth(1).innerText()) && (await text('batch-add')) === '1 tablespoon + 2½ teaspoons' && (await text('batch-add-note')) === 'Level and unpacked, or 11.1 g on a scale.' && (await steps().getByTestId('batch-fit').count()) === 0, `${await text('batch-add')} · ${await text('batch-add-note')}`)
check("step 3: Enfamil's own instruction for A.R.", /^3 Shake well, let it sit 5 minutes, then shake again/.test(squash(await steps().locator('li').nth(2).innerText())), squash(await steps().locator('li').nth(2).innerText()))
check('step 4: 74 mL into each of the 5 bottles', (await text('batch-pour')) === '74 mL' && /Pour into each of the 5 bottles/.test(await steps().locator('li').nth(3).innerText()), await text('batch-pour'))
const planRows = (await sheet().getByTestId('night-plan').locator('li').allInnerTexts()).map(squash)
check('each spot says what it holds after mixing, and no measure of its own', planRows.length === 5 && planRows.every((r, i) => r.startsWith(`${i + 1} Spot ${i + 1} · 74 mL`) && !/Add /.test(r)), planRows.join(' | '))
check('the big numbers are big: at least 28 px', (await steps().getByTestId('batch-add').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 28)
check('nothing wider than the screen in the make sheet', !(await overflow()))
await steps().scrollIntoViewIfNeeded()
await shot('batch-steps')

await sheet().getByRole('tab', { name: 'Bottle by bottle' }).click()
await settle(300)
const eachRows = (await sheet().getByTestId('night-plan').locator('li').allInnerTexts()).map(squash)
check('Bottle by bottle: no batch steps, each bottle says its own 1 teaspoon (or 2.2 g) and its milk', (await sheet().getByTestId('batch-steps').count()) === 0 && eachRows.every((r, i) => r.startsWith(`${i + 1} Spot ${i + 1} · 72 mL`) && /Add 1 teaspoon of Enfamil A\.R\., or 2\.2 g on a scale$/.test(r)), eachRows.join(' | '))
await sheet().getByRole('tab', { name: 'All together' }).click()
await sheet().getByRole('spinbutton', { name: 'Each bottle in mL' }).fill('60')
await settle(400)
check('five of 60 mL is one level scoop from the can: said beside the spoons and the grams', (await text('batch-milk')) === '300 mL' && (await text('batch-add')) === '1 tablespoon + 1⅝ teaspoons' && (await text('batch-add-note')) === 'Level and unpacked (1 scoop), or 9.3 g on a scale.', `${await text('batch-add')} · ${await text('batch-add-note')}`)
await shot('batch-one-scoop')
const fold = sheet().getByTestId('recipe-fold')
const foldText = await fold.textContent()
check("the recipe fold carries Enfamil's mixing note, what it says of its spoons, its 24 limit and the batch advice", /Recipe chart · 24 kcal\/oz with Enfamil A\.R\./.test(squash(await fold.innerText())) && /let it sit 5 minutes/.test(foldText) && /about 2 g a level teaspoon/.test(foldText) && /never mixed stronger than 24 kcal\/oz/.test(foldText) && /as one batch/.test(foldText))
await sheet().getByRole('button', { name: 'Make 5 bottles' }).click()
await settle(1500)
const made = (await companion('GET', `/milk?child=${child.id}&status=stored`)).body.filter((b) => b.kind === 'bottle')
check('five bottles at 24 kcal/oz, each holding its share of the batch (60 mL of milk and what the powder adds)', made.length === 5 && made.every((b) => b.kcal_per_oz === 24 && b.volume_ml > 61.1 && b.volume_ml < 61.7), JSON.stringify(made.map((b) => [b.spot, b.kcal_per_oz, b.volume_ml])))
const bagsLeft = (await companion('GET', `/milk?child=${child.id}&status=stored`)).body.filter((b) => b.kind !== 'bottle').reduce((s, b) => s + b.remaining_ml, 0)
check('… and the bags gave only the milk: 300 mL of 400', Math.abs(bagsLeft - 100) < 0.5, String(bagsLeft))

// ---- a fortified bottle mixed by hand says its spoons and grams
await page.goto(BASE + '/')
await settle(1200)
await page.getByRole('button', { name: /^Bottle/ }).first().click()
await settle(900)
await sheet().getByRole('radio', { name: 'Fortified', exact: true }).click()
await sheet().getByRole('spinbutton', { name: 'Amount in mL' }).fill('90')
await settle(300)
check('the bottle sheet says how to mix 90 mL: 1⅜ teaspoons, or 2.8 g on a scale', /^To mix 90 mL: add 1⅜ teaspoons of Enfamil A\.R\., or 2\.8 g on a scale$/.test(squash(await sheet().getByTestId('bottle-mix').innerText())), (await sheet().getByTestId('bottle-mix').count()) ? squash(await sheet().getByTestId('bottle-mix').innerText()) : 'missing')

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
