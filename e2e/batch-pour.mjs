/**
 * A batch: milk mixed ahead in ONE container, each bottle poured from it as it is needed. Stash › Make a batch pours
 * from the fridge bags (soonest to expire first), gives the one measure of formula, and says what the container comes
 * to; the batch then has its own row on the Stash tab. The bottle sheet offers it: one tap, set what she drank, Save,
 * and only that leaves the batch (plus what she left in the bottle, when that is said). Set what is left by hand,
 * discard it, or undo one nothing was poured from. Unlike a premade bottle it is never taken whole.
 *   MOCK_BB=http://127.0.0.1:<bb-port> node e2e/batch-pour.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack.
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/batch-pour'
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

await companion('PUT', `/settings/${child.id}`, { caloriesOn: true, fortify: { kcalPerOz: 24, with: 'powder', powder: 'enfamil-ar', since: ymd(new Date()) } })
const made = []
for (const [ml, key, hours] of [[200, 'a', 8], [200, 'b', 6]]) made.push((await companion('POST', '/milk', { child: child.id, pumped_at: new Date(Date.now() - hours * HOUR).toISOString(), volume_ml: ml, location: 'fridge', client_key: `pour-${key}-${Date.now()}` })).body)
const stash = async () => (await companion('GET', `/milk?child=${child.id}`)).body
const feedings = async () => (await api('GET', `/api/feedings/?child=${child.id}`)).body.results
const openStash = async () => { await page.goto(BASE + '/milk'); await settle(1300) }
const steps = () => sheet().getByTestId('batch-steps')
const text = async (id) => squash(await steps().getByTestId(id).innerText())

// ---- the Stash tab offers it beside premade bottles; no batch block until one is made
await openStash()
check('no batch block before one is made', (await page.getByTestId('batches').count()) === 0)
check('"Make a batch" sits beside "Make premade bottles"', (await page.getByTestId('night-bottles').getByRole('button', { name: 'Make a batch' }).count()) === 1 && (await page.getByTestId('night-bottles').getByRole('button', { name: 'Make premade bottles' }).count()) === 1)
await page.getByTestId('night-bottles').getByRole('button', { name: 'Make a batch' }).click()
await settle(800)
const milk = sheet().getByRole('spinbutton', { name: 'Milk in the batch in mL' })
check('opens on all the fridge milk when a day of bottles is not known', (await milk.inputValue()) === '400', await milk.inputValue())
check('the whole number shows in its field', await milk.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.clientWidth >= 60), String(await milk.evaluate((el) => `${el.scrollWidth}/${el.clientWidth}`)))
check('fortified by default at the household strength', (await sheet().getByRole('tab', { name: 'Fortified · 24' }).getAttribute('aria-selected')) === 'true')
await milk.fill('360')
await settle(400)
check('step 1: all the milk in one container', (await text('batch-milk')) === '360 mL', await text('batch-milk'))
check('step 2: the formula measured once, spoons with the grams beside', (await text('batch-add')) === '1 tablespoon + 2½ teaspoons' && /11\.1 g on a scale/.test(await text('batch-add-note')), `${await text('batch-add')} | ${await text('batch-add-note')}`)
check("step 3: the maker's mixing note", /sit 5 minutes/.test(squash(await steps().innerText())))
check('step 4: kept cold in the one container, and what it comes to', (await text('batch-holds')) === '368 mL' && /Keep it cold, and pour each bottle from it/.test(squash(await steps().innerText())), await text('batch-holds'))
check('no step about splitting into bottles', (await steps().getByTestId('batch-pour').count()) === 0)
check('says until when it keeps', /^Good until /.test(squash(await sheet().getByTestId('batch-until').innerText())), squash(await sheet().getByTestId('batch-until').innerText()))
const sources = (await sheet().locator('.night-source').allInnerTexts()).map(squash)
check('poured from the bag that has to go first, the next keeps the rest', /all of it$/.test(sources[0]) && /160 mL$/.test(sources[1]), JSON.stringify(sources))
check('the button says what will be made', (await sheet().getByRole('button', { name: 'Make the batch · 368 mL' }).count()) === 1)
check('no overflow in the sheet', !(await overflow()))
await shot('make-batch', true)
// more than the bags hold: the batch is what they hold
await milk.fill('900')
await settle(300)
check('more than the bags hold is said, and the batch is what they hold', /The bags hold 400 mL, so that is the batch\./.test(squash(await sheet().getByTestId('batch-short').innerText())) && (await text('batch-milk')) === '400 mL')
await milk.fill('360')
await settle(300)
await sheet().getByRole('button', { name: /^Make the batch/ }).click()
await settle(1500)
let bags = await stash()
let batch = bags.find((b) => b.kind === 'batch')
check('the batch is in the stash: fortified, in the fridge, holding milk and formula', Boolean(batch) && batch.kcal_per_oz === 24 && batch.location === 'fridge' && Math.abs(batch.volume_ml - 368.4) < 0.2 && batch.status === 'stored', JSON.stringify(batch && { v: batch.volume_ml, k: batch.kcal_per_oz, s: batch.status }))
check('the milk left the bags: the first is used up, the second keeps 40 mL', bags.find((b) => b.id === made[0].id).status === 'used' && bags.find((b) => b.id === made[1].id).remaining_ml === 40)
check('it keeps 24 hours from mixing', Math.abs(new Date(batch.expires_at) - new Date(batch.mixed_at) - 24 * HOUR) < 1000)
const row = () => page.getByTestId('batches').locator('.batch-row')
check('its own block on the Stash tab: what is left, of what, the strength, until when', (await row().count()) === 1 && /^368 mL left of 368 mL · 24 kcal\/oz Good until /.test(squash(await row().innerText())), squash(await row().innerText()))
check('not listed again among the fridge bags', !/batch/i.test(squash(await page.getByTestId('stash-fridge').innerText())))
check('no overflow on the Stash tab', !(await overflow()))
check('neither make button breaks onto two lines', await page.getByTestId('night-bottles').locator('.made-ahead-actions button').evaluateAll((els) => els.every((el) => el.getBoundingClientRect().height < 64)))
await shot('stash-with-batch', true)
await row().click()
await settle(700)
check('its sheet: pour a bottle, adjust, travel sticker, discard, undo', (await sheet().getByRole('button', { name: 'Pour a bottle from this batch' }).count()) === 1 && (await sheet().getByRole('button', { name: "Adjust what's left" }).count()) === 1 && (await sheet().getByRole('button', { name: "It's on a travel sticker" }).count()) === 1 && (await sheet().getByRole('button', { name: 'Discard this batch' }).count()) === 1 && (await sheet().getByRole('button', { name: 'Undo this batch' }).count()) === 1)
check('no moves and no label for a batch', (await sheet().getByRole('button', { name: /Move to|Out on counter|Reprint label/ }).count()) === 0)
await shot('batch-sheet', true)

// ---- a bottle poured from it: one tap, what she drank, Save
const openBottle = async () => {
  await page.goto(BASE + '/')
  await settle(1200)
  await page.getByRole('button', { name: /^Bottle/ }).first().click()
  await settle(900)
}
await openBottle()
const pick = () => sheet().getByTestId('batch-pick')
check('the bottle sheet offers the batch first', (await pick().count()) === 1 && /^368 mL left 24 kcal\/oz · good until /.test(squash(await pick().innerText())), (await pick().count()) ? squash(await pick().innerText()) : 'missing')
await shot('bottle-offers-batch')
await pick().click()
await settle(400)
const amount = () => sheet().getByRole('spinbutton', { name: 'Amount in mL' })
const save = () => sheet().getByRole('button', { name: 'Save', exact: true })
const picked = async () => squash(await sheet().getByTestId('batch-picked').innerText())
check('picked: the batch and what is left, no amount filled in (never the whole batch)', /^The batch · 368 mL left/.test(await picked()) && (await amount().inputValue()) === '', `${await picked()} | ${await amount().inputValue()}`)
check('the amount field has the cursor', await amount().evaluate((el) => el === document.activeElement))
check('Save waits for what she drank', await save().isDisabled())
check('fortified milk, at the strength the batch was mixed to', (await sheet().getByRole('radio', { name: 'Fortified', exact: true }).getAttribute('aria-checked')) === 'true')
await amount().fill('90')
await settle(300)
check('90 mL comes out and the rest stays', /^90 mL from the batch/.test(await picked()) && /278 mL stays/.test(await picked()), await picked())
check('no mixing line: the batch is already mixed', (await sheet().getByTestId('bottle-mix').count()) === 0)
await shot('bottle-from-batch', true)
await save().click()
await settle(1500)
let fed = (await feedings()).sort((a, b) => a.id - b.id)
batch = (await stash()).find((b) => b.kind === 'batch')
check('saved as a fortified bottle of 90 mL at 24 kcal/oz', fed.length === 1 && fed[0].amount === 90 && fed[0].type === 'fortified breast milk' && (fed[0].tags ?? []).includes('kcal:24'), JSON.stringify(fed.map((f) => [f.amount, f.type, f.tags])))
check('the batch gave 90 mL and keeps the rest', Math.abs(batch.remaining_ml - 278.4) < 0.2 && batch.status === 'stored', String(batch.remaining_ml))

// ---- she left some in the bottle: it is thrown away, so it leaves the batch without counting as fed
await openBottle()
await pick().click()
await amount().fill('60')
check('"She left some in the bottle" is one quiet link', (await sheet().getByTestId('batch-tossed-link').count()) === 1 && (await sheet().getByTestId('batch-tossed').count()) === 0)
await sheet().getByTestId('batch-tossed-link').click()
await sheet().getByRole('spinbutton', { name: 'Left in the bottle and thrown away, in mL' }).fill('20')
await settle(300)
check('what she drank and what was thrown away both come out', /^80 mL from the batch/.test(await picked()) && /198 mL stays/.test(await picked()), await picked())
await shot('bottle-left-some', true)
await save().click()
await settle(1500)
fed = (await feedings()).sort((a, b) => a.id - b.id)
batch = (await stash()).find((b) => b.kind === 'batch')
check('the feed counts the 60 mL she drank', fed.length === 2 && fed[1].amount === 60, JSON.stringify(fed.map((f) => f.amount)))
check('the batch lost the 80 mL that was poured', Math.abs(batch.remaining_ml - 198.4) < 0.2, String(batch.remaining_ml))
// more than is left is refused before saving
await openBottle()
await pick().click()
await amount().fill('250')
await settle(300)
check('more than is left: said in words, Save off', /Only 198 mL is left in the batch, 52 mL short/.test(squash(await sheet().innerText())) && (await save().isDisabled()))

// ---- the Stash tab follows; set what is left by hand; a poured-from batch cannot be undone
await openStash()
check('the row follows the pours', /^198 mL left of 368 mL/.test(squash(await row().innerText())), squash(await row().innerText()))
await row().click()
await settle(700)
const uses = (await sheet().locator('.bag-uses li').allInnerTexts()).map(squash)
check('its history lists the two bottles', uses.length === 2 && /^90 mL bottle/.test(uses[0]) && /^80 mL bottle/.test(uses[1]), JSON.stringify(uses))
check('no Undo once it was poured from', (await sheet().getByRole('button', { name: 'Undo this batch' }).count()) === 0)
await sheet().getByRole('button', { name: "Adjust what's left" }).click()
await sheet().getByRole('spinbutton', { name: "What's left in the batch (mL)" }).fill('150')
await sheet().getByRole('button', { name: "Set what's left" }).click()
await settle(1200)
batch = (await stash()).find((b) => b.kind === 'batch')
check('what is left can be set by hand (a spill, a bottle not logged)', batch.remaining_ml === 150, String(batch.remaining_ml))
await row().click()
await settle(600)
await sheet().getByRole('button', { name: 'Discard this batch' }).click()
await settle(1200)
check('discarded: its block is gone from the Stash tab', (await page.getByTestId('batches').count()) === 0 && (await stash()).find((b) => b.kind === 'batch').status === 'discarded')

// ---- a plain batch, undone before anything was poured: the milk is back on its bag
await page.getByTestId('night-bottles').getByRole('button', { name: 'Make a batch' }).click()
await settle(800)
await sheet().getByRole('tab', { name: 'Plain milk' }).click()
await sheet().getByRole('spinbutton', { name: 'Milk in the batch in mL' }).fill('30')
await settle(300)
check('plain: no steps, one line', (await steps().count()) === 0 && /^Pour 30 mL into one container and keep it cold\./.test(squash(await sheet().getByTestId('batch-plain').innerText())))
await sheet().getByRole('button', { name: 'Make the batch · 30 mL' }).click()
await settle(1500)
check('a plain batch says so on its row', /^30 mL left of 30 mL · plain milk/.test(squash(await row().innerText())), squash(await row().innerText()))
await row().click()
await settle(600)
await sheet().getByRole('button', { name: 'Undo this batch' }).click()
await settle(300)
check('undo asks once', /Put the milk back on its bag\?/.test(squash(await sheet().getByTestId('unmake-confirm').innerText())))
await sheet().getByRole('button', { name: 'Put it back' }).click()
await settle(1300)
bags = await stash()
check('undone: the bag has its 40 mL again and the batch is gone', bags.find((b) => b.id === made[1].id).remaining_ml === 40 && !bags.some((b) => b.kind === 'batch' && b.status === 'stored') && (await page.getByTestId('batches').count()) === 0)

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
