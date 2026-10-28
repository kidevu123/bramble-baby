/**
 * Travel stickers: printed ahead from Settings › Milk labels & printer (the printer stays home), then, away,
 * scanned in the pumping sheet: the session's bag takes the sticker's code and nothing prints. A sticker
 * already used is refused; a code that is not a sticker is refused; a bag in the Stash can take a sticker too.
 *   MOCK_BB=http://127.0.0.1:<bb-port> [LABELS=<file-printer dir>] node e2e/travel-stickers.mjs <out-dir> <base-url> [light|dark]
 */
import { mkdirSync, readdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/travel-stickers'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const SCHEME = process.argv[4] === 'dark' ? 'dark' : 'light'
const BB = process.env.MOCK_BB ?? 'http://127.0.0.1:8710'
const LABELS = process.env.LABELS ?? null
const TOKEN = 'mocktoken0000000000000000000000000000000'
const DAY = 86_400_000
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
const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, colorScheme: SCHEME })
await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml' } })) })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error' && !/camera|getUserMedia|NotFound|NotAllowed|Permission|Failed to load resource/i.test(m.text())) problems.push(`console: ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
// The probe's own refusals (a used sticker, a code that is not one) answer 400/404 on purpose.
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/profile') && !/\/milk\/(travel|code)\/|\/milk\/\d+$/.test(r.url())) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`) })
const settle = (ms = 500) => page.waitForTimeout(ms)
let n = 0
const shot = async (name) => { n += 1; await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}-${SCHEME}.png`, fullPage: false }) }
const sheet = () => page.locator('dialog[open]').last()
const typeCode = async (code) => {
  await sheet().getByLabel('Or type the code').fill(code)
  await sheet().getByRole('button', { name: 'Find', exact: true }).click()
  await settle(1200)
}

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
for (const b of (await companion('GET', `/milk?child=${child.id}`)).body ?? []) await companion('DELETE', `/milk/${b.id}`)

// ---- Settings › Milk labels & printer › Stickers to print › Travel stickers: print five
const before = LABELS ? readdirSync(LABELS).length : 0
const unusedBefore = ((await companion('GET', `/milk/travel?child=${child.id}`)).body ?? []).filter((t) => t.status === 'unused').length
await page.goto(BASE + '/settings')
await settle(1000)
await page.getByRole('button', { name: /Milk labels/ }).click()
await settle(1000)
const card = sheet().getByTestId('travel-stickers')
await card.scrollIntoViewIfNeeded()
check('Settings has fridge spot stickers and travel stickers together', (await sheet().getByTestId('spot-stickers').count()) === 1 && (await card.count()) === 1)
await card.getByRole('radio', { name: '5', exact: true }).click()
await card.getByRole('button', { name: 'Print 5 travel stickers' }).click()
await settle(3000)
check('printing says five went to the printer', /Sent 5 travel stickers to the printer/.test(await card.innerText()), squash(await card.innerText()))
if (LABELS) check('five sticker images reached the printer', readdirSync(LABELS).length - before === 5, String(readdirSync(LABELS).length - before))
const stickers = ((await companion('GET', `/milk/travel?child=${child.id}`)).body ?? []).filter((t) => t.status === 'unused')
check('five unused codes are on record, and nothing went into the stash', stickers.length - unusedBefore === 5 && ((await companion('GET', `/milk?child=${child.id}&status=stored`)).body ?? []).length === 0)
check('the card says how many are not used yet', new RegExp(`${stickers.length} printed and not used yet`).test(await card.innerText()), squash(await card.innerText()))
await shot('settings-travel')
await sheet().getByRole('button', { name: 'Close' }).click()
await settle(400)
const [one, two] = stickers.map((t) => t.code)

// ---- away: log a 90 mL session and scan sticker one
await page.goto(BASE + '/')
await settle(1000)
await page.locator('.tile-pumping .tile-main').click()
await settle(900)
await sheet().getByRole('spinbutton', { name: 'Volume in mL' }).fill('90')
await sheet().getByRole('button', { name: 'On a travel sticker? Scan it' }).click()
await settle(800)
await typeCode('ZZZZZZ')
check('a code that is not a travel sticker is refused in words', /not a travel sticker/.test(await sheet().innerText()), squash(await sheet().innerText()).slice(0, 200))
await typeCode(one)
const pick = sheet().getByTestId('travel-pick')
check('the sticker shows on the session, and nothing will print', (await pick.count()) === 1 && squash(await pick.innerText()).includes(`Travel sticker ${one}`) && (await sheet().locator('.label-auto-note').count()) === 0, squash(await sheet().innerText()).slice(0, 300))
await shot('pumping-travel')
await sheet().getByRole('button', { name: 'Save', exact: true }).click()
await settle(1800)
const bags = (await companion('GET', `/milk?child=${child.id}&status=stored`)).body ?? []
const bag = bags.find((b) => b.code === one)
check("the session's milk is in the stash under the sticker's code", Boolean(bag) && bag.volume_ml === 90 && bag.pumping_id !== null, JSON.stringify(bags.map((b) => [b.code, b.volume_ml])))
check('nothing was printed for it', !LABELS || readdirSync(LABELS).length - before === 5)
check('the sticker is now taken', (await companion('GET', `/milk/travel/${one}`)).body.status === 'assigned')

// ---- the same sticker again on another session is refused
await page.locator('.tile-pumping .tile-main').click()
await settle(900)
await sheet().getByRole('spinbutton', { name: 'Volume in mL' }).fill('40')
await sheet().getByRole('button', { name: 'On a travel sticker? Scan it' }).click()
await settle(800)
await typeCode(one)
check('a sticker already on milk is refused', /already on other milk/.test(await sheet().innerText()))
await sheet().getByRole('button', { name: 'Close' }).click()
await settle(400)
await sheet().getByRole('button', { name: 'Close' }).click()
await settle(400)

// ---- a bag already in the Stash (made at home) goes on sticker two
const home = (await companion('POST', '/milk', { child: child.id, pumped_at: new Date(Date.now() - 3_600_000).toISOString(), volume_ml: 50, client_key: `travel-home-${Date.now()}` })).body
await page.goto(BASE + '/milk')
await settle(1200)
await page.locator('.bag-row', { hasText: home.code }).click()
await settle(700)
await sheet().getByRole('button', { name: "It's on a travel sticker" }).click()
await settle(700)
await typeCode(two)
const after = (await companion('GET', `/milk/${home.id}`)).body
check('the bag takes the sticker code from its sheet', after.code === two && (await page.locator('.bag-row', { hasText: two }).count()) === 1, after.code)
check('nothing wider than the screen', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
await shot('stash-after')

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
