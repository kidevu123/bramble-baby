/**
 * Stash › Premade bottles › Rearrange: a small link beside the count; tap a bottle, then a spot. An empty spot takes it,
 * a filled one swaps; the same bottle again cancels; Done leaves the mode and taps open a bottle's sheet again.
 *   node e2e/rearrange-bottles.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack (the script creates the child, two bags and three bottles).
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/rearrange-bottles'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const SCHEME = process.argv[4] === 'dark' ? 'dark' : 'light'
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this probe writes entries. Use the isolated stack from docs/DEVELOPMENT.md.`)
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

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, colorScheme: SCHEME })
await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml', weight: 'lb', length: 'in', temp: 'f' } })) })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`console: ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('response', (r) => { if (r.status() >= 400 && !/\/api\/profile|\/login\//.test(r.url())) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`) })
const settle = (ms = 700) => page.waitForTimeout(ms)
let n = 0
const shot = async (name) => { n += 1; await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}-${SCHEME}.png` }) }

await page.goto(BASE + '/signin')
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1200)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Birth date or due date').fill(ymd(new Date(Date.now() - 30 * 86_400_000)))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
}
await settle(1000)
const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
const companion = async (path, data) => (await page.request.post(`${BASE}/bramble${path}`, { headers, data })).json()
const pumped = new Date(Date.now() - 3 * 3_600_000).toISOString()
const a = await companion('/milk', { child: child.id, pumped_at: pumped, volume_ml: 120, location: 'fridge', client_key: `rearr-a-${Date.now()}` })
const b = await companion('/milk', { child: child.id, pumped_at: pumped, volume_ml: 90, location: 'fridge', client_key: `rearr-b-${Date.now()}` })
await companion('/milk/bottles', {
  child: child.id,
  bottles: [
    { spot: 1, takes: [{ bag: a.id, amount_ml: 60 }], client_key: `rearr-1-${Date.now()}` },
    { spot: 2, takes: [{ bag: a.id, amount_ml: 60 }], client_key: `rearr-2-${Date.now()}` },
    { spot: 3, takes: [{ bag: b.id, amount_ml: 48 }], client_key: `rearr-3-${Date.now()}` },
  ],
})

const grid = () => page.getByTestId('night-bottles')
const spots = async () => (await grid().locator('.spot').allInnerTexts()).map(squash)
await page.goto(BASE + '/milk')
await settle(1500)
const link = grid().getByRole('button', { name: 'Rearrange' })
check('a small Rearrange link sits beside the count, a 44 px target', (await link.count()) === 1 && (await link.evaluate((e) => e.getBoundingClientRect().height)) >= 44)
check('… spots start as 60, 60, 48, empty, empty', JSON.stringify(await spots()) === JSON.stringify(['1 60 mL', '2 60 mL', '3 48 mL', '4 empty', '5 empty']), JSON.stringify(await spots()))
await link.click()
await settle(300)
check('… it turns into Done with a hint', (await grid().getByRole('button', { name: 'Done' }).count()) === 1 && /Tap a bottle, then the spot/.test(await grid().innerText()))
await grid().getByRole('button', { name: /Premade bottle 3/ }).click()
await settle(300)
check('a tapped bottle is picked and the empty spots become targets', (await grid().locator('.spot.is-moving').count()) === 1 && (await grid().locator('.spot.is-target').count()) === 2 && /Now tap the spot for bottle 3/.test(await grid().innerText()))
check('… no sheet opens while rearranging', (await page.locator('dialog[open]').count()) === 0)
await shot('picked')
await grid().getByRole('button', { name: 'Move bottle 3 to spot 5' }).click()
await settle(1200)
check('an empty spot takes it: 48 mL is now in spot 5', JSON.stringify(await spots()) === JSON.stringify(['1 60 mL', '2 60 mL', '3 empty', '4 empty', '5 48 mL']), JSON.stringify(await spots()))
await grid().getByRole('button', { name: /Premade bottle 5/ }).click()
await settle(300)
await grid().getByRole('button', { name: 'Swap bottle 5 with bottle 1' }).click()
await settle(1200)
check('a filled spot swaps: 48 mL in 1, 60 mL in 5', JSON.stringify(await spots()) === JSON.stringify(['1 48 mL', '2 60 mL', '3 empty', '4 empty', '5 60 mL']), JSON.stringify(await spots()))
const stored = await (await page.request.get(`${BASE}/bramble/milk?child=${child.id}&status=stored`, { headers })).json()
check('… saved on the server', JSON.stringify(stored.filter((x) => x.kind === 'bottle').map((x) => [x.spot, x.remaining_ml]).sort()) === JSON.stringify([[1, 48], [2, 60], [5, 60]]))
await grid().getByRole('button', { name: /Premade bottle 2/ }).click()
await settle(200)
await grid().getByRole('button', { name: /Premade bottle 2/ }).click()
await settle(300)
check('tapping the picked bottle again cancels', (await grid().locator('.spot.is-moving').count()) === 0)
check('nothing wider than the screen', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
await shot('swapped')
await grid().getByRole('button', { name: 'Done' }).click()
await settle(300)
await grid().getByRole('button', { name: /Premade bottle 1/ }).click()
await settle(600)
check('after Done a tap opens the bottle again', (await page.locator('dialog[open]').count()) === 1 && /48 mL/.test(await page.locator('dialog[open]').innerText()))

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
