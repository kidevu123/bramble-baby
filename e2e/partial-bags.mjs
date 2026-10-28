/**
 * Probe for partial bags: a bottle takes some of a stash bag and the rest stays in the stash.
 * Runs against the isolated stack from the README (mock Baby Buddy + companion + vite dev), at iPhone
 * width, once per colour scheme. It registers a 120 mL bag, makes a 40 mL bottle from it (80 left on the
 * Stash tab and in the bag sheet), edits that bottle to 50 mL (70 left), tries a bottle bigger than the
 * balance (refused), makes a bottle that empties the bag (gone as used), undoes that (back), sets what is
 * left by hand (30), and checks the reprinted label still says 120 mL while its sheet says 30 of 120.
 *
 * It starts by emptying the child's stash and feedings, so it only runs against localhost: never point
 * it at the real Baby Buddy.
 *
 * Usage: node e2e/partial-bags.mjs <out-dir> [base-url=http://localhost:5173]
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/partial-bags'
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
  const ctx = await browser.newContext({ ...devices['iPhone 14'], ...(viewport ? { viewport } : {}), colorScheme: scheme, permissions: ['clipboard-read', 'clipboard-write'] })
  // mL like the owner's household; set before the app first reads its prefs.
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

  // ---- sign in, make sure there is a child, start from an empty stash in mL
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
  const feedings = async () => (await api('GET', `/api/feedings/?child=${child.id}`)).body.results ?? []
  for (const bag of await stash()) await api('DELETE', `/bramble/milk/${bag.id}`)
  for (const f of await feedings()) await api('DELETE', `/api/feedings/${f.id}/`)

  // ---- a 120 mL bag pumped two hours ago, in the fridge
  const pumpedAt = new Date(Math.floor((Date.now() - 2 * HOUR) / 60_000) * 60_000)
  const made = await api('POST', '/bramble/milk', { child: child.id, pumped_at: pumpedAt.toISOString(), volume_ml: 120, location: 'fridge', client_key: `probe-${tag}-${Date.now()}` })
  ok('a new bag starts full', made.status === 201 && made.body.remaining_ml === 120 && made.body.uses.length === 0)
  const code = made.body.code

  await page.goto(BASE + '/milk')
  await settle(1000)
  const row = () => page.locator('.bag-row:not(.static)', { hasText: code }).first()
  ok('Stash row shows a full bag as its volume', /^120 mL · /.test(squash(await row().locator('.bag-vol').innerText())), squash(await row().locator('.bag-vol').innerText()))
  await shot('stash-full-bag')

  // ---- a 40 mL bottle from it
  await row().click()
  await settle()
  ok('bag sheet opens on the whole bag', squash(await sheet().locator('.bag-head-vol').innerText()) === '120 mL' && /^Pumped/.test(squash(await sheet().locator('.bag-head p.small').innerText())))
  ok('a full bag has no history and no gauge', (await sheet().locator('.bag-uses').count()) === 0 && (await sheet().locator('.bag-gauge').count()) === 0)
  await sheet().getByRole('button', { name: 'Make a bottle with this bag' }).click()
  await settle(800)
  const pick = () => sheet().getByTestId('stash-pick')
  const amountField = () => sheet().getByLabel('Amount in mL').and(sheet().locator('input[type=number]'))
  ok('bottle sheet names the bag and what is in it', squash(await pick().innerText()).startsWith(`120 mL from bag ${code} Remove all of it`), squash(await pick().innerText()))
  ok('amount is prefilled with the whole bag and editable', (await amountField().inputValue()) === '120' && !(await amountField().isDisabled()))
  ok('save copy says the whole bag leaves the stash', squash(await sheet().locator('.use-plan').innerText()) === `All 120 mL from bag ${code} · that bag leaves the stash`, squash(await sheet().locator('.use-plan').innerText()))
  await amountField().fill('40')
  await settle(300)
  const planText = squash(await sheet().locator('.use-plan').innerText())
  ok('save copy says what will happen', planText === `40 mL from bag ${code} (80 mL stays)`, planText)
  ok('save copy is a status, not an alert', (await sheet().locator('.use-plan').getAttribute('role')) === 'status')
  await shot('bottle-40-of-120')
  await sheet().getByRole('button', { name: 'Save', exact: true }).click()
  await settle(1500)

  let bags = await stash()
  let bag = bags.find((b) => b.code === code)
  let fed = await feedings()
  ok('bag keeps the balance with the same code and expiry', bag.status === 'stored' && bag.remaining_ml === 80 && bag.volume_ml === 120 && bag.expires_at === made.body.expires_at)
  ok('the feeding carries only the amount fed', fed.length === 1 && Number(fed[0].amount) === 40)
  ok('the use links the feeding', bag.uses.length === 1 && bag.uses[0].feeding_id === fed[0].id && bag.uses[0].amount_ml === 40 && bag.feeding_id === fed[0].id)
  await page.goto(BASE + '/milk')
  await settle(1000)
  const volText = squash(await row().locator('.bag-vol').innerText())
  ok('Stash row shows the balance against the label volume', volText.startsWith('80 of 120 mL left'), volText)
  ok('summary counts what is left', squash(await page.locator('.stash-stat').first().innerText()).includes('80 mL'), squash(await page.locator('.stash-stat').first().innerText()))
  // The bag to use first is tagged in the list, over its deadline on the right; the tag sits on the part-used bag.
  ok('the part-used bag is tagged Use first, with its balance', squash(await row().locator('.bag-due').innerText()).startsWith('Use first') && (await page.locator('.bag-first-tag').count()) === 1 && /use first$/.test((await row().getAttribute('aria-label')) ?? ''), volText)
  await shot('stash-80-left')

  await row().click()
  await settle()
  ok('bag sheet shows the balance', squash(await sheet().locator('.bag-head-vol').innerText()) === '80 of 120 mL left', squash(await sheet().locator('.bag-head-vol').innerText()))
  ok('bag sheet shows a gauge and the history', (await sheet().locator('.bag-gauge').count()) === 1 && /40 mL bottle/.test(await sheet().locator('.bag-uses').innerText()))
  await shot('bag-sheet-80-left')
  await sheet().getByRole('button', { name: 'Close' }).click()
  await settle()

  // ---- editing the bottle's amount adjusts what it took
  await page.goto(BASE + '/')
  await settle(1200)
  await page.locator('.tl-row', { hasText: 'Bottle' }).first().click()
  await settle(1000)
  const editPick = squash(await pick().innerText())
  ok('editing the bottle shows the bag it came from', editPick.startsWith(`40 mL from bag ${code}`) && /80 mL stays/.test(editPick), editPick)
  ok('an untouched amount has no save copy', (await sheet().locator('.use-plan').count()) === 0)
  await amountField().fill('50')
  await settle(300)
  ok('a new amount says what the bag will hold', squash(await sheet().locator('.use-plan').innerText()) === `50 mL from bag ${code} (70 mL stays)`, squash(await sheet().locator('.use-plan').innerText()))
  await shot('edit-bottle-50')
  await sheet().getByRole('button', { name: 'Save', exact: true }).click()
  await settle(1500)
  bag = (await stash()).find((b) => b.code === code)
  fed = await feedings()
  ok('the edit adjusted the use, not a second one', bag.remaining_ml === 70 && bag.uses.length === 1 && bag.uses[0].amount_ml === 50 && Number(fed[0].amount) === 50)

  // ---- a bottle bigger than the balance is refused in words
  await page.goto(BASE + '/milk')
  await settle(1000)
  await row().click()
  await settle()
  await sheet().getByRole('button', { name: 'Make a bottle with this bag' }).click()
  await settle(800)
  ok('a second bottle starts at what is left', (await amountField().inputValue()) === '70')
  await amountField().fill('90')
  await settle(300)
  const over = squash(await sheet().locator('.use-plan').innerText())
  ok('too much is refused with a plain message', over.startsWith('The picked bags hold 70 mL, 20 mL short.') && (await sheet().locator('.use-plan').getAttribute('role')) === 'alert', over)
  ok('Save is off while it is too much', await sheet().getByRole('button', { name: 'Save', exact: true }).isDisabled())
  await shot('bottle-too-much')
  // the server refuses it too
  const refused = await api('POST', `/bramble/milk/${bag.id}/use`, { amount_ml: 90, feeding_id: 9999 })
  ok('server refuses more than the balance', refused.status === 400 && refused.body.detail === `Only 70 mL (2.4 oz) is left in bag ${code}.`, JSON.stringify(refused.body))

  // ---- a bottle that empties the bag takes it out of the stash
  await amountField().fill('70')
  await settle(300)
  ok('the whole balance says the bag leaves', squash(await sheet().locator('.use-plan').innerText()) === `All 70 mL from bag ${code} · that bag leaves the stash`, squash(await sheet().locator('.use-plan').innerText()))
  await sheet().getByRole('button', { name: 'Save', exact: true }).click()
  await settle(1500)
  bag = (await stash()).find((b) => b.code === code)
  ok('bag is used once the balance is zero', bag.status === 'used' && bag.remaining_ml === 0 && bag.uses.length === 2 && bag.used_at !== null)
  await page.goto(BASE + '/milk')
  await settle(1000)
  ok('used bag is off the Stored list', (await row().count()) === 0)
  await page.getByRole('button', { name: /Show used and discarded/ }).click()
  await settle()
  const hist = () => page.locator('.bag-row.static', { hasText: code })
  ok('history says it was used over two bottles', /Used up over 2 bottles/.test(squash(await hist().innerText())) && /^120 mL/.test(squash(await hist().locator('.bag-vol').innerText())), squash(await hist().innerText()))
  await shot('stash-used-history')

  // ---- a used bag found by its code shows what became of it, not the stash actions
  await page.getByRole('button', { name: 'Scan a bag' }).click()
  await settle()
  await sheet().getByLabel('Or type the code').fill(code)
  await sheet().getByRole('button', { name: 'Find' }).click()
  await settle(1000)
  const gone = squash(await sheet().innerText())
  ok('a used bag opened by its code says it is not in the stash', /Used up over 2 bottles .*not in the stash/.test(gone), gone)
  ok('a used bag offers Undo but no bottle, move or discard', (await sheet().getByRole('button', { name: /Undo/ }).count()) === 1 && (await sheet().getByRole('button', { name: /Make a bottle|Move to|Discard/ }).count()) === 0)
  await shot('used-bag-by-code')
  await sheet().getByRole('button', { name: 'Close' }).first().click()
  await settle()

  // ---- undo gives the last bottle's milk back
  await hist().getByRole('button', { name: 'Undo' }).click()
  await settle(1200)
  bag = (await stash()).find((b) => b.code === code)
  ok('undo restores the last use only', bag.status === 'stored' && bag.remaining_ml === 70 && bag.uses.length === 1 && bag.used_at === null)
  ok('undo put the bag back on the Stash tab', squash(await row().locator('.bag-vol').innerText()).startsWith('70 of 120 mL left'))
  await shot('stash-after-undo')

  // ---- set what is left by hand
  await row().click()
  await settle()
  await sheet().getByRole('button', { name: "Adjust what's left" }).click()
  await settle()
  const field = sheet().getByLabel(/What's left in the bag/)
  ok('adjust form opens on the current balance', (await field.inputValue()) === '70')
  ok('Set is off until the balance is changed', await sheet().getByRole('button', { name: "Set what's left" }).isDisabled())
  await field.fill('130')
  await settle(200)
  ok('more than the bag held is refused in words', /The bag held 120 mL/.test(squash(await sheet().locator('.bag-adjust [role=alert]').innerText())) && (await sheet().getByRole('button', { name: "Set what's left" }).isDisabled()))
  await field.fill('30')
  await settle(200)
  ok('the form says what will stay', squash(await sheet().locator('.bag-adjust [role=status]').innerText()) === '30 mL stays in the stash.')
  await shot('adjust-to-30')
  await sheet().getByRole('button', { name: "Set what's left" }).click()
  await settle(1200)
  bag = (await stash()).find((b) => b.code === code)
  ok('the balance is what was typed and the correction is on record', bag.remaining_ml === 30 && bag.uses.length === 2 && bag.uses[1].kind === 'adjust' && bag.uses[1].amount_ml === 40)
  ok('Stash row shows 30 of 120', squash(await row().locator('.bag-vol').innerText()).startsWith('30 of 120 mL left'))
  await row().click()
  await settle()
  ok('bag history shows the hand correction', /40 mL less, set by hand/.test(await sheet().locator('.bag-uses').innerText()))
  await shot('bag-sheet-30-left')

  // ---- the reprinted label keeps the bag's volume; its sheet shows the balance
  await sheet().getByRole('button', { name: 'Reprint label' }).click()
  await settle(1200)
  const card = squash(await sheet().locator('.stash-card').innerText())
  ok('label sheet shows the balance', card.includes(`Bag ${code} is in the stash · 30 of 120 mL left`), card)
  await sheet().getByRole('button', { name: 'Copy as text' }).click()
  const labelText = await page.evaluate(() => navigator.clipboard.readText())
  ok('the label itself still says what the bag held', labelText.includes('120 mL') && !labelText.includes('30 mL'), labelText.replace(/\n/g, ' | '))
  await shot('reprint-30-left')
  await sheet().getByRole('button', { name: 'Close' }).click()
  await settle()

  // ---- zero by hand means used; and the bottle sheet from Home picks the balance up too
  await row().click()
  await settle()
  await sheet().getByRole('button', { name: "Adjust what's left" }).click()
  await sheet().getByLabel(/What's left in the bag/).fill('0')
  await settle(200)
  ok('zero says the bag leaves', /Nothing left: the bag leaves the stash as used/.test(squash(await sheet().locator('.bag-adjust [role=status]').innerText())))
  await sheet().getByRole('button', { name: "Set what's left" }).click()
  await settle(1200)
  bag = (await stash()).find((b) => b.code === code)
  ok('zero by hand is used', bag.status === 'used' && bag.remaining_ml === 0 && (await row().count()) === 0)

  const second = await api('POST', '/bramble/milk', { child: child.id, pumped_at: pumpedAt.toISOString(), volume_ml: 100, location: 'freezer', client_key: `probe2-${tag}-${Date.now()}` })
  await api('POST', `/bramble/milk/${second.body.id}/use`, { amount_ml: 35, feeding_id: 7777 })
  await page.goto(BASE + '/')
  await settle(1200)
  await page.getByRole('button', { name: /^Bottle$/ }).first().click().catch(() => page.locator('.tile', { hasText: 'Bottle' }).first().click())
  await settle(800)
  await sheet().getByRole('button', { name: 'Use milk from the stash' }).click()
  await settle(800)
  const pickerRow = sheet().locator('.bag-row', { hasText: second.body.code })
  ok('picker shows the balance of a part-used bag', squash(await pickerRow.innerText()).startsWith('65 of 100 mL left'), squash(await pickerRow.innerText()))
  await pickerRow.click()
  await settle(600)
  ok('bottle from Home starts at the balance', (await amountField().inputValue()) === '65' && squash(await pick().innerText()).startsWith(`65 mL from bag ${second.body.code}`), squash(await pick().innerText()))
  await shot('home-bottle-part-used-bag')
  await amountField().fill('15')
  await settle(300)
  await sheet().getByRole('button', { name: 'Save', exact: true }).click()
  await settle(1500)
  let frozen = (await stash()).find((b) => b.id === second.body.id)
  ok('a bottle from Home takes from the bag too', frozen.remaining_ml === 50 && frozen.uses.length === 2)

  // ---- deleting the bottle gives its milk back
  await page.locator('.tl-row', { hasText: 'Bottle' }).first().click()
  await settle(1000)
  ok('the newest bottle opens on its bag', squash(await pick().innerText()).startsWith(`15 mL from bag ${second.body.code}`), squash(await pick().innerText()))
  await sheet().getByRole('button', { name: 'Delete entry' }).click()
  await settle(1500)
  frozen = (await stash()).find((b) => b.id === second.body.id)
  const left = await feedings()
  ok('deleting the bottle puts the milk back', frozen.remaining_ml === 65 && frozen.uses.length === 1 && frozen.status === 'stored' && left.every((f) => Number(f.amount) !== 15))

  // ---- a bag picked and then removed takes nothing
  await page.getByRole('button', { name: /^Bottle$/ }).first().click().catch(() => page.locator('.tile', { hasText: 'Bottle' }).first().click())
  await settle(800)
  await sheet().getByRole('button', { name: 'Use milk from the stash' }).click()
  await settle(800)
  await sheet().locator('.bag-row', { hasText: second.body.code }).click()
  await settle(600)
  await sheet().getByRole('button', { name: 'Remove' }).click()
  await settle(300)
  ok('removing the bag drops the save copy (the no-bag reminder may stay)', (await sheet().locator('.use-plan:not(.is-hint)').count()) === 0 && (await sheet().getByRole('button', { name: 'Use milk from the stash' }).count()) === 1)

  await ctx.close()
}

try {
  await run('light')
  await run('dark')
} catch (err) {
  console.error('FAILED:', err.message.split('\n')[0])
  check('probe ran to the end', false, err.message.split('\n')[0])
}
await browser.close()
const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (problems.length) console.log('PROBLEMS:\n' + [...new Set(problems)].join('\n'))
process.exit(failed.length || problems.length ? 1 : 0)
