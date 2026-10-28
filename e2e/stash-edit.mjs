/**
 * Probe for the stash on the bottle sheet: the "Use milk from the stash" card that is hard to miss when
 * the stash has milk, the quiet button when it has none (or for formula), the reminder above Save when a
 * breast-milk bottle has no bag, and picking, changing or removing the bag of a bottle that already exists
 * (timeline row → edit): the take moves between bags and comes back when the bag is removed.
 *
 * Runs against the isolated stack from the README at iPhone width, once per colour scheme and once at
 * 320 px. It starts by emptying the child's stash and feedings, so it only runs against localhost.
 *
 * Usage: node e2e/stash-edit.mjs <out-dir> [base-url=http://localhost:5173]
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/stash-edit'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const HOUR = 3_600_000
const DAY = 24 * HOUR
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this probe deletes stash bags and feedings. Use the isolated stack from the README.`)
  process.exit(2)
}

const checks = []
const problems = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const pad = (n) => String(n).padStart(2, '0')
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const squash = (s) => s.replace(/\s+/g, ' ').trim()

const browser = await chromium.launch()

async function run(scheme, viewport) {
  const tag = viewport ? `${scheme}-${viewport.width}` : scheme
  const dir = `${OUT}/${tag}`
  mkdirSync(dir, { recursive: true })
  const ctx = await browser.newContext({ ...devices['iPhone 14'], ...(viewport ? { viewport } : {}), colorScheme: scheme })
  await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml' } })) })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${tag}] console: ${m.text().slice(0, 300)}`) })
  page.on('pageerror', (e) => problems.push(`[${tag}] pageerror: ${e.message}`))
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/profile')) problems.push(`[${tag}] http ${r.status()} ${r.request().method()} ${r.url()}`) })
  const settle = (ms = 600) => page.waitForTimeout(ms)
  let n = 0
  const shot = async (name) => { n += 1; await page.screenshot({ path: `${dir}/${pad(n)}-${name}.png` }) }
  const sheet = () => page.locator('dialog[open]').last()
  const ok = (name, cond, detail) => check(`[${tag}] ${name}`, cond, detail)

  // ---- sign in, make sure there is a child, start from an empty stash
  await page.goto(BASE + '/')
  await page.waitForURL(/\/signin/)
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill('admin')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
  await settle(1200)
  if (page.url().includes('/onboarding')) {
    await page.getByLabel('First name').fill('Oscar')
    const born = new Date(Date.now() - 6 * DAY)
    await page.getByLabel('Birth date or due date').fill(localInput(born).slice(0, 10))
    await page.getByRole('button', { name: 'Start tracking' }).click()
    await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
    await settle(1200)
  }
  const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
  const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
  const api = async (method, path, data) => {
    const res = await page.request.fetch(BASE + path, { method, headers, data })
    return { status: res.status(), body: res.status() === 204 ? null : await res.json().catch(() => null) }
  }
  const child = (await api('GET', '/api/children/')).body.results[0]
  const stash = async () => (await api('GET', `/bramble/milk?child=${child.id}`)).body
  const bagById = async (id) => (await stash()).find((b) => b.id === id)
  const feedings = async () => (await api('GET', `/api/feedings/?child=${child.id}`)).body.results ?? []
  const linkOf = async (feedingId) => (await api('GET', `/bramble/milk/feeding/${feedingId}`)).body
  for (const bag of await stash()) await api('DELETE', `/bramble/milk/${bag.id}`)
  for (const f of await feedings()) await api('DELETE', `/api/feedings/${f.id}/`)

  const openBottle = async () => {
    await page.goto(BASE + '/')
    await settle(1200)
    await page.getByRole('button', { name: /^Bottle$/ }).first().click().catch(() => page.locator('.tile', { hasText: 'Bottle' }).first().click())
    await settle(800)
  }
  const openEdit = async () => {
    await page.goto(BASE + '/')
    await settle(1200)
    await page.locator('.tl-row', { hasText: 'Bottle' }).first().click()
    await settle(1000)
  }
  const cta = () => sheet().getByTestId('stash-cta')
  const quiet = () => sheet().locator('.btn-secondary', { hasText: 'Use milk from the stash' })
  const pick = () => sheet().getByTestId('stash-pick')
  const note = () => sheet().locator('.use-plan')
  /** Move the bottle from one bag to another: add the new bag, take the old one out. */
  const moveTo = async (from, to) => {
    await pick().getByRole('button', { name: 'Add another bag' }).click()
    await settle(800)
    await sheet().locator('.bag-row', { hasText: to.code }).click()
    await settle(600)
    await pick().getByRole('button', { name: `Take bag ${from.code} out of this bottle` }).click()
    await settle(400)
  }
  const amountField = () => sheet().getByLabel('Amount in mL').and(sheet().locator('input[type=number]'))
  const save = async () => { await sheet().getByRole('button', { name: 'Save', exact: true }).click(); await settle(1500) }

  // ---- an empty stash: the quiet button, no reminder
  await openBottle()
  ok('empty stash: the quiet button, no card', (await quiet().count()) === 1 && (await cta().count()) === 0)
  ok('empty stash: nothing to remind about', (await note().count()) === 0)
  await shot('bottle-empty-stash')
  await sheet().getByRole('button', { name: 'Close' }).click()
  await settle()

  // ---- two bags: 120 mL in the fridge (use first) and 100 mL in the freezer
  const pumpedAt = new Date(Math.floor((Date.now() - 2 * HOUR) / 60_000) * 60_000)
  const a = (await api('POST', '/bramble/milk', { child: child.id, pumped_at: pumpedAt.toISOString(), volume_ml: 120, location: 'fridge', client_key: `edit-a-${tag}-${Date.now()}` })).body
  const b = (await api('POST', '/bramble/milk', { child: child.id, pumped_at: new Date(pumpedAt.getTime() - DAY).toISOString(), volume_ml: 100, location: 'freezer', client_key: `edit-b-${tag}-${Date.now()}` })).body

  // ---- logging a breast-milk bottle without picking a bag
  await openBottle()
  ok('the stash card is there for breast milk', (await cta().count()) === 1 && (await quiet().count()) === 0)
  const ctaText = squash(await cta().innerText())
  ok('the card says what is in the stash and what to use first', ctaText === 'Use milk from the stash 2 bags · use first: 120 mL from today', ctaText)
  ok('no reminder before an amount is typed (it took half a 320 screen)', (await note().count()) === 0)
  await amountField().fill('40')
  await settle(300)
  ok('a reminder sits above Save once there is a bottle and no bag is picked', squash(await note().innerText()) === 'Nothing comes off the stash. If this bottle was poured from a bag, pick it above.' && (await note().getAttribute('role')) === 'status')
  await shot('bottle-no-bag-card')
  await sheet().getByRole('radio', { name: 'Formula' }).click()
  await settle(300)
  ok('formula: the quiet button, no reminder', (await quiet().count()) === 1 && (await cta().count()) === 0 && (await note().count()) === 0)
  await shot('bottle-formula-quiet')
  await sheet().getByRole('radio', { name: 'Breast milk' }).click()
  await settle(300)
  ok('breast milk again: the card and the reminder are back', (await cta().count()) === 1 && (await note().count()) === 1)
  await save()
  let fed = await feedings()
  ok('the bottle saved without a bag; the stash is untouched', fed.length === 1 && Number(fed[0].amount) === 40 && (await bagById(a.id)).remaining_ml === 120 && (await linkOf(fed[0].id)).bag === null)
  const feeding = fed[0]

  // ---- editing it from the timeline: pick the bag it came from
  await openEdit()
  ok('editing the bottle offers the stash card too', (await cta().count()) === 1 && (await pick().count()) === 0, squash(await sheet().innerText()).slice(0, 200))
  ok('the reminder is there on the edit as well', (await note().count()) === 1)
  await shot('edit-no-bag-card')
  await cta().click()
  await settle(800)
  ok('the picker lists both bags, oldest first', (await sheet().locator('.bag-row').count()) === 2 && (await sheet().locator('.bag-row').first().innerText()).includes(a.code))
  await shot('edit-picker')
  await sheet().locator('.bag-row', { hasText: a.code }).click()
  await settle(600)
  const picked = squash(await pick().innerText())
  ok('the card names the bag and what the save will do', picked.startsWith(`40 mL from bag ${a.code}`) && /80 mL stays/.test(picked) && /Pour what you need/.test(picked), picked)
  ok('the amount fed is kept, not replaced by the bag', (await amountField().inputValue()) === '40')
  ok('Add another bag, Remove all and a per-bag Remove are offered', (await pick().getByRole('button', { name: 'Add another bag' }).count()) === 1 && (await pick().getByRole('button', { name: 'Remove all' }).count()) === 1 && (await pick().getByRole('button', { name: `Take bag ${a.code} out of this bottle` }).count()) === 1)
  ok('the save line says what the bag will hold', squash(await note().innerText()) === `40 mL from bag ${a.code} (80 mL stays)`, squash(await note().innerText()))
  await pick().scrollIntoViewIfNeeded()
  await shot('edit-picked-bag')
  await save()
  let bagA = await bagById(a.id)
  let link = await linkOf(feeding.id)
  ok('saving took 40 from the bag and linked the bottle', bagA.remaining_ml === 80 && bagA.uses.length === 1 && link.bag?.id === a.id && link.use.amount_ml === 40)
  ok('the feeding itself is unchanged', (await feedings()).length === 1 && Number((await feedings())[0].amount) === 40)
  await page.goto(BASE + '/milk')
  await settle(1000)
  const rowA = () => page.locator('.bag-row:not(.static)', { hasText: a.code }).first()
  ok('Stash shows the balance', squash(await rowA().locator('.bag-vol').innerText()).startsWith('80 of 120 mL left'), squash(await rowA().locator('.bag-vol').innerText()))
  await shot('stash-after-edit')

  // ---- editing again: change the bag
  await openEdit()
  const onA = squash(await pick().innerText())
  ok('the edit opens on the bag it came from', onA.startsWith(`40 mL from bag ${a.code}`) && /80 mL stays/.test(onA) && /balances follow/.test(onA), onA)
  ok('an untouched bottle has no save line', (await note().count()) === 0)
  await moveTo(a, b)
  const onB = squash(await pick().innerText())
  ok('the card is now the other bag', onB.startsWith(`40 mL from bag ${b.code}`) && /Freezer/.test(onB) && !onB.includes(a.code), onB)
  const moveNote = squash(await note().innerText())
  ok('the save line says what moves where', moveNote === `40 mL from bag ${b.code} (60 mL stays) Bag ${a.code} gets 40 mL back`, moveNote)
  await pick().scrollIntoViewIfNeeded()
  await shot('edit-change-bag')
  await save()
  bagA = await bagById(a.id)
  let bagB = await bagById(b.id)
  link = await linkOf(feeding.id)
  ok('the take moved: the first bag is whole, the second is down', bagA.remaining_ml === 120 && bagA.uses.length === 0 && bagA.feeding_id === null && bagB.remaining_ml === 60 && bagB.uses.length === 1)
  ok('the bottle is linked to the second bag only', link.bag?.id === b.id && link.use.amount_ml === 40)
  await page.goto(BASE + '/milk')
  await settle(1000)
  const rowB = () => page.locator('.bag-row:not(.static)', { hasText: b.code }).first()
  ok('Stash shows both balances moved', squash(await rowA().locator('.bag-vol').innerText()).startsWith('120 mL') && squash(await rowB().locator('.bag-vol').innerText()).startsWith('60 of 100 mL left'))
  await shot('stash-after-move')

  // ---- editing again: the bottle is bigger and from the other bag at once
  await openEdit()
  await moveTo(b, a)
  await amountField().fill('50')
  await settle(300)
  ok('a new amount on a new bag plans with the new amount', squash(await note().innerText()) === `50 mL from bag ${a.code} (70 mL stays) Bag ${b.code} gets 40 mL back`, squash(await note().innerText()))
  await save()
  bagA = await bagById(a.id)
  bagB = await bagById(b.id)
  ok('the amount and the bag changed together', bagA.remaining_ml === 70 && bagB.remaining_ml === 100 && bagB.uses.length === 0 && Number((await feedings())[0].amount) === 50)

  // ---- too much for the new bag is refused before saving
  await openEdit()
  await moveTo(a, b)
  await amountField().fill('130')
  await settle(300)
  ok('more than the other bag holds is refused in words', squash(await note().innerText()).startsWith('The picked bags hold 100 mL, 30 mL short.') && (await sheet().getByRole('button', { name: 'Save', exact: true }).isDisabled()), squash(await note().innerText()))
  await shot('edit-too-much')
  await sheet().getByRole('button', { name: 'Close' }).click()
  await settle()
  ok('closing without saving changed nothing', (await bagById(a.id)).remaining_ml === 70 && (await bagById(b.id)).remaining_ml === 100)

  // ---- editing again: remove the bag, the milk goes back
  await openEdit()
  await pick().getByRole('button', { name: 'Remove all' }).click()
  await settle(300)
  ok('removing the bag brings the card back', (await cta().count()) === 1 && (await pick().count()) === 0)
  ok('the save line says the bag gets its milk back', squash(await note().innerText()) === `Bag ${a.code} gets 50 mL back · this bottle is no longer from the stash`, squash(await note().innerText()))
  await cta().scrollIntoViewIfNeeded()
  await shot('edit-remove-bag')
  await save()
  bagA = await bagById(a.id)
  link = await linkOf(feeding.id)
  ok('the bag is whole again and the bottle is not from the stash', bagA.remaining_ml === 120 && bagA.uses.length === 0 && bagA.status === 'stored' && link.bag === null, JSON.stringify({ remaining: bagA.remaining_ml, uses: bagA.uses.length, status: bagA.status, link: link.bag?.id ?? null }))
  ok('the feeding is still there with its amount', (await feedings()).length === 1 && Number((await feedings())[0].amount) === 50)

  // ---- a bottle that emptied a bag, moved away: the bag comes back into the stash
  await openEdit()
  await cta().click()
  await settle(800)
  await sheet().locator('.bag-row', { hasText: b.code }).click()
  await settle(600)
  await amountField().fill('100')
  await settle(300)
  ok('all of a bag says it leaves the stash', squash(await note().innerText()) === `All 100 mL from bag ${b.code} · that bag leaves the stash`, squash(await note().innerText()))
  await save()
  ok('the bag left as used', (await bagById(b.id)).status === 'used')
  await openEdit()
  const onUsed = squash(await pick().innerText())
  ok('the edit says the bag is used up', onUsed.startsWith(`100 mL from bag ${b.code}`) && /all of it/.test(onUsed), onUsed)
  await pick().scrollIntoViewIfNeeded()
  await shot('edit-used-bag')
  await pick().getByRole('button', { name: 'Add another bag' }).click()
  await settle(800)
  ok('the picker no longer lists the used bag', (await sheet().locator('.bag-row', { hasText: b.code }).count()) === 0)
  await sheet().locator('.bag-row', { hasText: a.code }).click()
  await settle(600)
  await pick().getByRole('button', { name: `Take bag ${b.code} out of this bottle` }).click()
  await settle(400)
  await save()
  bagA = await bagById(a.id)
  bagB = await bagById(b.id)
  ok('the used bag is back in the stash, whole', bagB.status === 'stored' && bagB.remaining_ml === 100 && bagB.used_at === null && bagA.remaining_ml === 20)

  await ctx.close()
}

try {
  await run('light')
  await run('dark')
  await run('light', { width: 320, height: 568 })
} catch (err) {
  console.error('FAILED:', err.message.split('\n')[0])
  check('probe ran to the end', false, err.message.split('\n')[0])
}
await browser.close()
const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (problems.length) console.log('PROBLEMS:\n' + [...new Set(problems)].join('\n'))
process.exit(failed.length || problems.length ? 1 : 0)
