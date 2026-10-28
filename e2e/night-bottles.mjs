/**
 * Premade bottles: made ahead from the fridge bags into numbered spots (stickers 1–5), fed at night with one tap.
 * Seeds the owner's stash (five part-used fridge bags and three full ones, one frozen bag), makes three 60 mL
 * bottles from the Stash tab (the milk that has to go first goes first; the bags go down), feeds spot 2 from its
 * own sheet with 45 mL drunk (the whole bottle leaves, the feeding says 45), feeds spot 3 from the Bottle sheet's
 * spot buttons, and prints the five spot stickers from Settings › Milk labels & printer.
 *   MOCK_BB=http://127.0.0.1:<bb-port> [LABELS=<file-printer dir>] node e2e/night-bottles.mjs <out-dir> <base-url> [light|dark] [width]
 */
import { mkdirSync, readdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/night-bottles'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const SCHEME = process.argv[4] === 'dark' ? 'dark' : 'light'
const WIDTH = Number(process.argv[5] ?? 390)
const BB = process.env.MOCK_BB ?? 'http://127.0.0.1:8710'
const LABELS = process.env.LABELS ?? null
const TOKEN = 'mocktoken0000000000000000000000000000000'
const HOUR = 3_600_000
const DAY = 24 * HOUR
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this probe empties the stash. Use the isolated stack from the README.`)
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })

let fails = 0
const problems = []
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || detail === undefined ? '' : ` — ${detail}`}`)
  if (!cond) fails += 1
}
const squash = (t) => t.replace(/\s+/g, ' ').trim()
const headers = { Authorization: `Token ${TOKEN}`, 'Content-Type': 'application/json' }
const api = async (method, path, body) => {
  const r = await fetch(BB + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }
}
const companion = async (method, path, body) => {
  const r = await fetch(`${BASE}/bramble${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: WIDTH, height: 844 }, colorScheme: SCHEME })
await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml' } })) })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/profile')) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`) })
const settle = (ms = 500) => page.waitForTimeout(ms)
let n = 0
const tag = `${SCHEME}-${WIDTH}`
const shot = async (name, full = false) => { n += 1; await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}-${tag}.png`, fullPage: full }) }
const sheet = () => page.locator('dialog[open]').last()
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)

// ---- sign in, a child, the owner's stash
await page.goto(BASE + '/')
await page.waitForURL(/\/signin/)
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1200)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Birth date or due date').fill(new Date(Date.now() - 20 * DAY).toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
  await settle(1000)
}
const child = (await api('GET', '/api/children/')).body.results[0]
for (const f of (await api('GET', `/api/feedings/?child=${child.id}`)).body.results ?? []) await api('DELETE', `/api/feedings/${f.id}/`)
for (const b of (await companion('GET', `/milk?child=${child.id}`)).body ?? []) await companion('DELETE', `/milk/${b.id}`)
const run = Date.now()
const mk = async (ml, left, hoursAgo, key, location = 'fridge') => {
  const bag = (await companion('POST', '/milk', { child: child.id, pumped_at: new Date(Date.now() - hoursAgo * HOUR).toISOString(), volume_ml: ml, location, client_key: `night-${key}-${run}` })).body
  if (left !== ml) await companion('PATCH', `/milk/${bag.id}`, { remaining_ml: left })
  return bag
}
// oldest first: the part-used leftovers, then the full bags (as in the owner's Stash screenshot)
const bags = [
  await mk(60, 10, 77, 'a'),
  await mk(62, 12, 71, 'b'),
  await mk(60, 10, 67, 'c'),
  await mk(75, 25, 64, 'd'),
  await mk(80, 30, 61, 'e'),
  await mk(72, 72, 57, 'f'),
  await mk(70, 70, 38, 'g'),
  await mk(60, 60, 35, 'h'),
]
const frozen = await mk(100, 100, 10, 'z', 'freezer')
const bagById = async (id) => (await companion('GET', `/milk/${id}`)).body
// two recent 60 mL breast-milk bottles: the size field starts at the usual bottle
for (const h of [3, 6]) {
  const t = new Date(Date.now() - h * HOUR).toISOString()
  await api('POST', '/api/feedings/', { child: child.id, start: t, end: t, type: 'breast milk', method: 'bottle', amount: 60, notes: '', tags: [] })
}

// ---- Stash: the spots, empty, and the way to make bottles
await page.goto(BASE + '/milk')
await settle(1500)
const block = page.getByTestId('night-bottles')
check('the Stash tab has the premade bottles block with five empty spots', (await block.count()) === 1 && (await block.locator('.spot.is-empty').count()) === 5)
await shot('stash-spots-empty')
await block.getByRole('button', { name: 'Make premade bottles' }).click()
await settle(900)
check('the sheet starts at the usual 60 mL bottle', (await sheet().getByRole('spinbutton', { name: 'Each bottle in mL' }).inputValue()) === '60')
check('… and as many bottles as the fridge milk fills (289 mL: 4)', (await sheet().getByRole('radio', { name: '4', exact: true }).getAttribute('aria-checked')) === 'true')
check('the frozen bag is not offered', !(await sheet().innerText()).includes(frozen.code) && /Frozen milk is not used/.test(await sheet().innerText()))
await sheet().getByRole('radio', { name: '3', exact: true }).click()
await settle(400)
const plan = sheet().getByTestId('night-plan')
const rows = (await plan.locator('.night-plan-row').allInnerTexts()).map(squash)
check('three bottles in spots 1–3, 60 mL each', rows.length === 3 && rows.every((r, i) => r.startsWith(`${i + 1} Spot ${i + 1} · 60 mL`)), rows.join(' | '))
check('spot 1 is poured from the oldest leftovers first', rows[0].includes(`10 mL ${bags[0].code} + 12 mL ${bags[1].code} + 10 mL ${bags[2].code} + 25 mL ${bags[3].code} + 3 mL ${bags[4].code}`), rows[0])
check('each bottle says until when it keeps', rows.every((r) => / · good until /.test(r)))
check('nothing wider than the screen in the sheet', !(await overflow()))
await shot('make-sheet')
await sheet().getByRole('button', { name: 'Make 3 bottles' }).click()
await settle(1500)
const spots = async () => (await block.locator('.spot').allInnerTexts()).map(squash)
check('spots 1–3 hold 60 mL, 4 and 5 are empty', JSON.stringify(await spots()) === JSON.stringify(['1 60 mL', '2 60 mL', '3 60 mL', '4 empty', '5 empty']), (await spots()).join(' | '))
const after = await Promise.all(bags.map((b) => bagById(b.id)))
// 180 mL poured in deadline order: the five leftovers (87 mL) and the 72 mL bag empty, 21 mL comes from the 70 mL bag
check('the bags emptied in deadline order; the next one went down and the newest is whole', after.slice(0, 6).every((b) => b.status === 'used') && after[6].remaining_ml === 49 && after[7].remaining_ml === 60, after.map((b) => `${b.code}:${b.status}:${b.remaining_ml}`).join(' '))
check("each pour is on the bag's history as into a premade bottle", after[0].uses.at(-1)?.kind === 'combined' && after[0].uses.at(-1)?.amount_ml === 10)
check('the fridge list no longer shows the used leftovers, and the bottles are not in it', !(await page.getByTestId('stash-fridge').innerText()).includes(bags[0].code) && (await page.getByTestId('stash-fridge').locator('.bag-row').count()) === 2)
check('nothing wider than the screen on the Stash tab', !(await overflow()))
await shot('stash-spots-filled')

// ---- spot 2 from its own sheet: Feed this bottle, she drinks 45 mL
await block.getByRole('button', { name: /^Premade bottle 2,/ }).click()
await settle(800)
check('the bottle sheet is named by its spot and says where its milk came from', (await sheet().locator('h2, .sheet-title').first().innerText()).includes('Premade bottle 2') && (await sheet().innerText()).includes('In spot 2 in the fridge') && (await sheet().innerText()).includes(bags[4].code))
await shot('bottle-sheet')
await sheet().getByRole('button', { name: 'Feed this bottle' }).click()
await settle(1200)
const pick = () => sheet().getByTestId('stash-pick')
check('the feed starts on premade bottle 2 with its 60 mL', squash(await pick().innerText()).includes('Premade bottle 2 · 60 mL') && (await sheet().getByRole('spinbutton', { name: 'Amount in mL' }).inputValue()) === '60')
await sheet().getByRole('spinbutton', { name: 'Amount in mL' }).fill('45')
await settle(300)
check('the save line says the rest is thrown away', squash(await sheet().locator('.use-plan').innerText()) === 'Premade bottle 2 (60 mL) · what she does not finish is thrown away', squash(await sheet().locator('.use-plan').innerText()))
await shot('feed-spot-2')
await sheet().getByRole('button', { name: 'Save', exact: true }).click()
await settle(1500)
let fed = (await api('GET', `/api/feedings/?child=${child.id}`)).body.results ?? []
const two = (await companion('GET', `/milk?child=${child.id}`)).body.find((b) => b.kind === 'bottle' && b.spot === 2)
check('the feeding says what she drank (45 mL); the whole bottle left the stash', fed.some((f) => Number(f.amount) === 45) && two.status === 'used')

// ---- spot 3 from the Bottle sheet on Home: the spot buttons
await page.goto(BASE + '/')
await settle(1000)
await page.getByRole('button', { name: /^Bottle/ }).first().click()
await settle(900)
const night = sheet().getByTestId('night-pick')
check('the Bottle sheet offers the ready spots (1 and 3)', (await night.count()) === 1 && JSON.stringify((await night.locator('.night-pill').allInnerTexts()).map(squash)) === JSON.stringify(['1 60 mL', '3 60 mL']))
check('nothing wider than the screen in the Bottle sheet', !(await overflow()))
await shot('bottle-sheet-spots')
await night.getByRole('button', { name: /^Premade bottle 3,/ }).click()
await settle(500)
check('one tap puts bottle 3 in the feed at 60 mL', squash(await pick().innerText()).includes('Premade bottle 3 · 60 mL') && (await sheet().getByRole('spinbutton', { name: 'Amount in mL' }).inputValue()) === '60')
await sheet().getByRole('button', { name: 'Save', exact: true }).click()
await settle(1500)
await page.goto(BASE + '/milk')
await settle(1200)
check('spots 2 and 3 are free again; spot 1 still holds its bottle', JSON.stringify(await spots()) === JSON.stringify(['1 60 mL', '2 empty', '3 empty', '4 empty', '5 empty']), (await spots()).join(' | '))
fed = (await api('GET', `/api/feedings/?child=${child.id}`)).body.results ?? []
check('two night feeds logged: 45 and 60 mL', fed.filter((f) => [45, 60].includes(Number(f.amount))).length >= 3)

// ---- spot 1 was never really made: Undo this bottle puts its milk back on its bags
await block.getByRole('button', { name: /^Premade bottle 1,/ }).click()
await settle(800)
await sheet().getByRole('button', { name: 'Undo this bottle' }).click()
await settle(300)
const confirmUndo = sheet().getByTestId('unmake-confirm')
check('Undo asks once, in one line: the milk, how many bags, the spot', (await confirmUndo.count()) === 1 && /Put the 60 mL back on its 5 bags and free spot 1\?/.test(await confirmUndo.innerText()), squash(await confirmUndo.innerText()))
check('nothing wider than the screen with the confirm open', !(await overflow()))
await shot('undo-confirm')
await confirmUndo.getByRole('button', { name: 'Put it back' }).click()
await settle(1500)
check('every spot is empty again', JSON.stringify(await spots()) === JSON.stringify(['1 empty', '2 empty', '3 empty', '4 empty', '5 empty']), (await spots()).join(' | '))
const back = await Promise.all(bags.slice(0, 5).map((b) => bagById(b.id)))
check("spot 1's bags have their milk back (10, 12, 10, 25 mL and the 3 mL from the fifth)", back.every((b) => b.status === 'stored') && JSON.stringify(back.map((b) => b.remaining_ml)) === JSON.stringify([10, 12, 10, 25, 3]), back.map((b) => `${b.code}:${b.status}:${b.remaining_ml}`).join(' '))
check('… and they are back in the fridge list', (await page.getByTestId('stash-fridge').innerText()).includes(bags[0].code) || (await page.getByTestId('stash-fridge').innerText()).includes('more'))
await shot('undo-done')

// ---- Settings › Milk labels & printer: the five spot stickers
const before = LABELS ? readdirSync(LABELS).length : 0
await page.goto(BASE + '/settings')
await settle(1000)
await page.getByRole('button', { name: /Milk labels/ }).click()
await settle(1000)
const stickers = sheet().getByTestId('spot-stickers')
await stickers.scrollIntoViewIfNeeded()
await settle(800)
check('Settings has the spot stickers with a preview of sticker 1', (await stickers.count()) === 1 && (await stickers.locator('img.ls-spot-preview').count()) === 1)
await stickers.getByRole('button', { name: 'Print stickers 1–5' }).click()
await settle(2500)
check('printing says five went to the printer', /Sent 5 stickers to the printer/.test(await stickers.innerText()), squash(await stickers.innerText()))
if (LABELS) check('five sticker images reached the printer', readdirSync(LABELS).length - before === 5, `${readdirSync(LABELS).length - before}`)
await shot('spot-stickers')

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${tag}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
