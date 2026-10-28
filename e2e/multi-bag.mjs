/**
 * One bottle from several bags: two 30 mL leftovers make a 60 mL bottle (both bags leave, the feeding knows
 * both), the amount follows the picked bags until it is typed, a bottle the bags cannot cover is refused in
 * words, editing the amount gives the last bag some back, taking a bag out gives it everything back, and
 * deleting the bottle gives it all back.
 *   node e2e/multi-bag.mjs <out-dir> <base-url> [light|dark]
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/multi-bag'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const SCHEME = process.argv[4] === 'dark' ? 'dark' : 'light'
const BB = process.env.MOCK_BB ?? 'http://127.0.0.1:8710'
const TOKEN = 'mocktoken0000000000000000000000000000000'
const DAY = 86_400_000
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
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/profile')) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`) })
const settle = (ms = 500) => page.waitForTimeout(ms)
let n = 0
const shot = async (name) => { n += 1; await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}-${SCHEME}.png`, fullPage: true }) }
const sheet = () => page.locator('dialog[open]').last()
const pick = () => sheet().getByTestId('stash-pick')
const note = () => sheet().locator('.use-plan')
const amountField = () => sheet().getByRole('spinbutton', { name: 'Amount in mL' })
const save = async () => { await sheet().getByRole('button', { name: 'Save', exact: true }).click(); await settle(1500) }

// ---- sign in, a child, three bags: two 30 mL leftovers and an 80 mL bag
await page.goto(BASE + '/')
await page.waitForURL(/\/signin/)
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1200)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Oscar')
  await page.getByLabel('Birth date or due date').fill(new Date(Date.now() - 20 * DAY).toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
  await settle(1000)
}
const child = (await api('GET', '/api/children/')).body.results[0]
for (const f of (await api('GET', `/api/feedings/?child=${child.id}`)).body.results ?? []) await api('DELETE', `/api/feedings/${f.id}/`)
for (const b of (await companion('GET', `/milk?child=${child.id}`)).body ?? []) await companion('DELETE', `/milk/${b.id}`)
const mk = async (ml, hoursAgo, key) => (await companion('POST', '/milk', { child: child.id, pumped_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(), volume_ml: ml, client_key: `multi-${key}-${Date.now()}` })).body
const a = await mk(30, 30, 'a')
const b = await mk(30, 20, 'b')
const c = await mk(80, 5, 'c')
const bagById = async (id) => (await companion('GET', `/milk/${id}`)).body
const linkOf = async (feedingId) => (await companion('GET', `/milk/feeding/${feedingId}`)).body
const feedings = async () => (await api('GET', `/api/feedings/?child=${child.id}`)).body.results ?? []

// ---- a 60 mL bottle from the two leftovers
await page.goto(BASE + '/')
await settle(1000)
await page.getByRole('button', { name: /^Bottle/ }).first().click()
await settle(900)
await sheet().getByTestId('stash-cta').click()
await settle(800)
check('the picker lists the three bags, oldest first', (await sheet().locator('.bag-row').count()) === 3 && (await sheet().locator('.bag-row').first().innerText()).includes(a.code))
await sheet().locator('.bag-row', { hasText: a.code }).click()
await settle(600)
check('the first bag fills the amount with what it holds', (await amountField().inputValue()) === '30')
await pick().getByRole('button', { name: 'Add another bag' }).click()
await settle(800)
check('the picker marks the bag already in the bottle', (await sheet().locator('.bag-row.is-picked', { hasText: a.code }).count()) === 1 && (await sheet().locator('.bag-row', { hasText: a.code }).getAttribute('aria-pressed')) === 'true')
await shot('picker-one-picked')
await sheet().locator('.bag-row', { hasText: b.code }).click()
await settle(600)
check('the second bag adds to the untyped amount', (await amountField().inputValue()) === '60')
const two = squash(await pick().innerText())
// Each bag's Remove button sits on its title line (row-level action), so it is read out of the card text.
check('the card lists both bags with their shares', two.replace(/ Remove(?= )/g, '').includes(`30 mL from bag ${a.code} all of it`) && two.replace(/ Remove(?= )/g, '').includes(`30 mL from bag ${b.code} all of it`) && /oldest bag empties first/.test(two), two)
check('the save line says both bags leave', squash(await note().innerText()) === `All 30 mL from bag ${a.code} · all 30 mL from bag ${b.code} · 2 bags leave the stash`, squash(await note().innerText()))
await pick().scrollIntoViewIfNeeded()
await shot('bottle-two-bags')
await save()
let fed = await feedings()
let link = await linkOf(fed[0].id)
check('the feeding is on both bags, 60 mL in all', fed.length === 1 && Number(fed[0].amount) === 60 && link.takes.map((t) => t.bag.id).join() === `${a.id},${b.id}` && link.total_ml === 60, JSON.stringify(link.takes.map((t) => [t.bag.code, t.use.amount_ml])))
check('both bags left the stash as used', (await bagById(a.id)).status === 'used' && (await bagById(b.id)).status === 'used')
const feeding = fed[0]
const openEdit = async () => { await page.goto(BASE + '/'); await settle(1000); await page.locator('.tl-row', { hasText: 'Bottle' }).first().click(); await settle(900) }

// ---- edit: 50 mL now; the second bag gets 10 mL back
await openEdit()
const onBoth = squash(await pick().innerText())
check('the edit opens on both bags', onBoth.includes(`bag ${a.code}`) && onBoth.includes(`bag ${b.code}`) && /balances follow/.test(onBoth), onBoth)
check('an untouched bottle has no save line', (await note().count()) === 0)
await amountField().fill('50')
await settle(300)
check('a smaller amount comes off the last bag', squash(await note().innerText()) === `All 30 mL from bag ${a.code} · 20 mL from bag ${b.code} (10 mL stays) · that bag leaves the stash`, squash(await note().innerText()))
await shot('edit-smaller')
await save()
link = await linkOf(feeding.id)
check('the allocation was set again: 30 + 20', link.total_ml === 50 && (await bagById(b.id)).status === 'stored' && (await bagById(b.id)).remaining_ml === 10, JSON.stringify([link.total_ml, (await bagById(b.id)).remaining_ml]))

// ---- a bottle the bags cannot cover is refused before saving
await openEdit()
await amountField().fill('90')
await settle(300)
check('too much for the picked bags is refused in words', squash(await note().innerText()).startsWith('The picked bags hold 60 mL, 30 mL short.') && (await sheet().getByRole('button', { name: 'Save', exact: true }).isDisabled()), squash(await note().innerText()))
await shot('edit-short')
await pick().getByRole('button', { name: 'Add another bag' }).click()
await settle(800)
await sheet().locator('.bag-row', { hasText: c.code }).click()
await settle(600)
check('a third bag covers it: the last bag keeps the rest', squash(await note().innerText()) === `All 30 mL from bag ${a.code} · all 30 mL from bag ${b.code} · 30 mL from bag ${c.code} (50 mL stays) · 2 bags leave the stash`, squash(await note().innerText()))
await sheet().getByRole('button', { name: 'Close' }).click()
await settle(500)
check('closing without saving changed nothing', (await linkOf(feeding.id)).total_ml === 50 && (await bagById(c.id)).remaining_ml === 80)

// ---- take the first bag out: it gets everything back, the bottle stays on the second
await openEdit()
await pick().getByRole('button', { name: `Take bag ${a.code} out of this bottle` }).click()
await settle(400)
check('a 50 mL bottle on the one remaining bag is short, so Save waits', squash(await note().innerText()).startsWith('The picked bags hold 30 mL, 20 mL short.') && (await sheet().getByRole('button', { name: 'Save', exact: true }).isDisabled()), squash(await note().innerText()))
await amountField().fill('30')
await settle(300)
check('the save line names the bag that gets its milk back', /Bag .* gets 30 mL back/.test(squash(await note().innerText())) && squash(await note().innerText()).startsWith(`All 30 mL from bag ${b.code}`), squash(await note().innerText()))
await save()
check('the first bag is whole and stored again', (await bagById(a.id)).status === 'stored' && (await bagById(a.id)).remaining_ml === 30 && (await bagById(a.id)).uses.length === 0)
link = await linkOf(feeding.id)
check('the bottle is on the second bag only', link.takes.length === 1 && link.takes[0].bag.id === b.id && link.total_ml === 30 && (await bagById(b.id)).status === 'used', JSON.stringify(link.takes.map((t) => [t.bag.code, t.use.amount_ml])))

// ---- delete the bottle: everything comes back
await openEdit()
await sheet().getByRole('button', { name: 'Delete entry' }).click()
await settle(1500)
check('deleting gives every bag its milk back', (await feedings()).length === 0 && (await bagById(b.id)).status === 'stored' && (await bagById(b.id)).remaining_ml === 30 && (await linkOf(feeding.id)).takes.length === 0)

// ---- the Stash page: Make a bottle with this bag starts the bottle on it, another bag can join
await page.goto(BASE + '/milk')
await settle(1000)
await page.locator('.bag-row:not(.static)', { hasText: a.code }).first().click()
await settle(800)
await sheet().getByRole('button', { name: 'Make a bottle with this bag' }).click()
await settle(900)
check('the bottle starts on that bag with its amount', (await amountField().inputValue()) === '30' && squash(await pick().innerText()).includes(`bag ${a.code}`))
await pick().getByRole('button', { name: 'Add another bag' }).click()
await settle(800)
await sheet().locator('.bag-row', { hasText: b.code }).click()
await settle(600)
check('a second bag joins from the Stash path too', (await amountField().inputValue()) === '60' && squash(await note().innerText()).includes(`bag ${b.code}`))
await shot('from-stash-two-bags')

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
