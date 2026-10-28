/**
 * Quick logging probe: the one-tap "Just now / 15 min ago / 30 min ago / 1 h ago" chips under the time
 * field of every log sheet, and the pumping sheet opening as "like the last session, finished just now"
 * with the volume field focused. Runs against the isolated stack from the README at iPhone width, light
 * and dark, and screenshots each sheet. It adds pumping entries, so it only runs against localhost.
 *
 * Usage: node e2e/quick-log.mjs <out-dir> [base-url=http://localhost:5173]
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/quick-log'
const BASE = process.argv[3] ?? 'http://localhost:5173'
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this probe writes pumping entries. Use the isolated stack from the README.`)
  process.exit(2)
}

let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const pad = (n) => String(n).padStart(2, '0')
const DAY = 86_400_000
const MIN = 60_000
const problems = []

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})

/** "Today, 9:41 AM" → minutes since midnight (the sheet shows no seconds). */
const shownMinutes = (text) => {
  const m = /(\d{1,2}):(\d{2}) (AM|PM)/.exec(text)
  if (!m) return null
  const h = (Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)
  return h * 60 + Number(m[2])
}
const nowMinutes = () => {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}
/** Minutes between two shown clock times, tolerant of the minute ticking over while the probe runs. */
const closeTo = (a, b, tolerance = 1) => Math.abs(((a - b) % 1440 + 1440) % 1440) <= tolerance || Math.abs(((b - a) % 1440 + 1440) % 1440) <= tolerance

async function run(scheme, width = 390) {
  const dir = `${OUT}/${scheme}${width !== 390 ? `-${width}` : ''}`
  mkdirSync(dir, { recursive: true })
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 844 }, colorScheme: scheme })
  await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml' } })) })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${scheme}] console: ${m.text().slice(0, 300)}`) })
  page.on('pageerror', (e) => problems.push(`[${scheme}] pageerror: ${e.message}`))
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/profile')) problems.push(`[${scheme}] http ${r.status()} ${r.request().method()} ${r.url()}`) })
  const settle = (ms = 500) => page.waitForTimeout(ms)
  let n = 0
  const shot = async (name) => { n += 1; await page.screenshot({ path: `${dir}/${pad(n)}-${name}.png` }) }
  const sheet = () => page.locator('dialog[open]').last()
  const ok = (name, cond, detail) => check(`[${scheme}${width !== 390 ? ` ${width}` : ''}] ${name}`, cond, detail)
  const times = async () => (await sheet().locator('.time-field-value').allInnerTexts()).map(shownMinutes)
  const chips = () => sheet().locator('.ago-chip')
  const pressed = async () => (await chips().evaluateAll((list) => list.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent))).join(',')

  // ---- sign in, a child
  await page.goto(BASE + '/')
  await page.waitForURL(/\/signin/)
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill('admin')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
  await settle(1200)
  if (page.url().includes('/onboarding')) {
    await page.getByLabel('First name').fill('Oscar')
    await page.getByLabel('Birth date or due date').fill(new Date(Date.now() - 6 * DAY).toISOString().slice(0, 10))
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
  for (const p of (await api('GET', `/api/pumping/?child=${child.id}`)).body.results ?? []) await api('DELETE', `/api/pumping/${p.id}/`)
  // The household's pumps (a new household starts with none; Settings › Pumps sets them).
  await api('PUT', `/bramble/settings/${child.id}`, { pumps: [{ name: 'Eufy', minutes: 30 }, { name: 'Spectra', minutes: 20 }, { name: 'Medela', minutes: 20 }, { name: 'Ameda', minutes: 20 }] })

  // ---- pumping with no earlier session: 15 min ending now, chips under Finished, volume focused
  await page.goto(BASE + '/')
  await settle(1200)
  await page.locator('.tile-pumping .tile-main').click()
  await settle(700)
  let t = await times()
  ok('pumping sheet opens finished just now', closeTo(t[1], nowMinutes()), `finished ${t[1]} now ${nowMinutes()}`)
  ok('…with the default 15 min when there is no earlier session', closeTo(t[1] - t[0], 15), `${t[1] - t[0]} min`)
  ok('four chips under Finished', (await chips().count()) === 4 && (await chips().allInnerTexts()).join('|') === 'Just now|15 min ago|30 min ago|1 h ago', (await chips().allInnerTexts()).join('|'))
  ok('"Just now" reads as chosen', (await pressed()) === 'Just now', await pressed())
  ok('the volume field has the focus', await page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Volume in') ?? false), await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)))
  ok('no "like the last session" line without one', !/like the last session/i.test(await sheet().innerText()))
  await shot('pumping-opens')
  // The owner missed "Milk goes in" below the fold: on an iPhone 14 Home Screen app (390 × 764 usable) an empty new
  // entry shows the volume, the pumps, where the milk goes and Save without scrolling.
  if (width === 390) {
    await page.setViewportSize({ width: 390, height: 764 })
    await settle(400)
    const saveBox = await sheet().getByRole('button', { name: 'Save', exact: true }).boundingBox()
    const parts = { volume: sheet().getByLabel('Volume in mL'), pumps: sheet().getByRole('radiogroup', { name: 'Pump' }), place: sheet().getByRole('radiogroup', { name: 'Milk goes in' }) }
    for (const [what, loc] of Object.entries(parts)) {
      const box = await loc.boundingBox()
      ok(`390 × 764: the ${what} is in view above Save without scrolling`, box !== null && saveBox !== null && box.y >= 0 && box.y + box.height <= saveBox.y, JSON.stringify({ box, saveTop: saveBox?.y }))
    }
    ok('390 × 764: Save is in view', saveBox !== null && saveBox.y + saveBox.height <= 764, JSON.stringify(saveBox))
    ok('390 × 764: the sheet has not scrolled', (await sheet().locator(':scope > .sheet-body').evaluate((el) => el.scrollTop)) === 0)
    await shot('pumping-390x764')
    await page.setViewportSize({ width: 390, height: 844 })
    await settle(300)
  }
  await sheet().getByRole('button', { name: '30 min ago' }).click()
  await settle(200)
  t = await times()
  ok('"30 min ago" moves Finished back 30 min', closeTo(t[1], nowMinutes() - 30), `finished ${t[1]} now ${nowMinutes()}`)
  ok('…and Started with it (length kept)', closeTo(t[1] - t[0], 15), `${t[1] - t[0]} min`)
  ok('"30 min ago" now reads as chosen', (await pressed()) === '30 min ago', await pressed())
  await shot('pumping-30-min-ago')
  await sheet().getByLabel('Volume in mL').fill('60')
  await sheet().getByRole('button', { name: 'Save', exact: true }).click()
  await settle(1200)
  ok('saved: the sheet closed', (await page.locator('dialog[open]').count()) === 0)
  const saved = (await api('GET', `/api/pumping/?child=${child.id}`)).body.results
  ok('the entry ends 30 min ago and lasts 15 min', saved.length === 1 && Math.abs(Date.now() - 30 * MIN - new Date(saved[0].end).getTime()) < 2 * MIN && Math.abs(new Date(saved[0].end) - new Date(saved[0].start) - 15 * MIN) < MIN, JSON.stringify(saved.map((p) => [p.start, p.end, p.amount])))

  // ---- the newest session (by start) sets the length of the next sheet: a 22-minute one, logged after the rest
  for (const p of (await api('GET', `/api/pumping/?child=${child.id}`)).body.results ?? []) await api('DELETE', `/api/pumping/${p.id}/`)
  const end = new Date(Date.now() - 3 * 3600_000)
  await api('POST', '/api/pumping/', { child: child.id, start: new Date(end.getTime() - 22 * MIN).toISOString(), end: end.toISOString(), amount: 80, notes: '' })
  await page.reload()
  await settle(1500)
  await page.locator('.tile-pumping .tile-main').click()
  await settle(700)
  t = await times()
  ok('the next pumping sheet is 22 min long, like the last session', closeTo(t[1] - t[0], 22) && closeTo(t[1], nowMinutes()), `${t[0]} → ${t[1]}`)
  ok('…and says so', /Like the last session: 22m, finished just now/.test(await sheet().innerText()))
  await shot('pumping-like-last')
  // a hand-picked Finished time keeps the chips honest: none reads as chosen
  await sheet().getByLabel('Finished:').fill(new Date(Date.now() - 50 * MIN).toISOString().slice(0, 16))
  await settle(200)
  ok('a hand-set time matches no chip', (await pressed()) === '', await pressed())
  await sheet().getByRole('button', { name: 'Close' }).click()
  await settle(500)

  // ---- editing an entry shows no chips
  await page.locator('.tl-row').first().click()
  await settle(700)
  ok('editing an entry has no chips', (await chips().count()) === 0 && /Edit pumping/.test(await sheet().innerText()))
  await sheet().getByRole('button', { name: 'Close' }).click()
  await settle(500)

  // ---- diaper: chips under Time set the time itself
  await page.locator('.tile-diaper .tile-main').click()
  await settle(700)
  ok('diaper sheet has the chips', (await chips().count()) === 4)
  await sheet().getByRole('button', { name: '1 h ago' }).click()
  await settle(200)
  t = await times()
  ok('"1 h ago" sets the diaper time', closeTo(t[0], nowMinutes() - 60), `${t[0]} vs ${nowMinutes() - 60}`)
  await shot('diaper-1-h-ago')
  await sheet().getByRole('button', { name: 'Just now' }).click()
  await settle(200)
  t = await times()
  ok('"Just now" brings it back', closeTo(t[0], nowMinutes()))
  await sheet().getByRole('button', { name: 'Close' }).click()
  await settle(500)

  // ---- sleep: chips under Woke up move the whole sleep, keeping its length
  await page.locator('.tile-sleep .tile-main').click()
  await settle(700)
  t = await times()
  const length = t[1] - t[0]
  await sheet().getByRole('button', { name: '15 min ago' }).click()
  await settle(200)
  t = await times()
  ok('sleep: "15 min ago" moves Woke up and Fell asleep together', closeTo(t[1], nowMinutes() - 15) && closeTo(t[1] - t[0], length), `${t[0]} → ${t[1]}, was ${length} min`)
  await shot('sleep-15-min-ago')
  await sheet().getByRole('button', { name: 'Close' }).click()
  await settle(300)

  // ---- every other add sheet has the chips too
  for (const kind of ['nursing', 'bottle', 'solids', 'potty', 'tummy', 'activity', 'growth', 'temperature', 'medicine', 'note']) {
    const tile = page.locator(`.tile-${kind} .tile-main`)
    if ((await tile.count()) === 0) continue
    await tile.click()
    await settle(600)
    if (kind === 'solids') {
      await sheet().locator('.food-card:not(.food-card-custom)').first().click()
      await sheet().getByRole('button', { name: 'Next' }).click()
      await settle(300)
    }
    ok(`${kind} sheet has the chips`, (await chips().count()) === 4, String(await chips().count()))
    if (kind === 'activity' || kind === 'bottle') await shot(`${kind}-chips`)
    await sheet().getByRole('button', { name: 'Close' }).click()
    await settle(300)
  }
  await ctx.close()
}

await run('light')
await run('dark')
await run('light', 320)
await browser.close()
for (const p of problems) console.log(`problem: ${p}`)
console.log(`${failed} failures, ${problems.length} problems`)
process.exit(failed || problems.length ? 1 : 0)
