/**
 * Probe for the Stash list: bags grouped by place (Room temp, Fridge, Freezer, Expired), each row with the
 * sticker's sun or moon, a long place showing its first three bags and "Show N more", and the deadline on the
 * right with "Use first" over it on the bag to use first; a key above the list names the symbols showing.
 *
 * It empties the child's stash first, so it only runs against localhost: never point it at the real Baby Buddy.
 *
 * Usage: node e2e/stash-list.mjs <out-dir> [base-url=http://localhost:5173]
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/stash-list'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const HOUR = 3_600_000
const DAY = 24 * HOUR
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this probe deletes stash bags. Use the isolated stack from the README.`)
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
/** A local moment `daysAgo` days back at h:m (the sun/moon follows the phone's clock, 9 PM–6 AM is night). */
const at = (daysAgo, h, m = 0) => {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(h, m, 0, 0)
  return d
}
const isNight = (d) => d.getHours() >= 21 || d.getHours() < 6

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
  const shot = async (name, full = false) => { n += 1; await page.screenshot({ path: `${dir}/${pad(n)}-${name}.png`, fullPage: full }) }
  const ok = (name, cond, detail) => check(`[${tag}] ${name}`, cond, detail)

  await page.goto(BASE + '/')
  await page.waitForURL(/\/signin/)
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill('admin')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
  await settle(1200)
  if (page.url().includes('/onboarding')) {
    await page.getByLabel('First name').fill('Ada')
    await page.getByLabel('Birth date or due date').fill(localInput(new Date(Date.now() - 12 * DAY)).slice(0, 10))
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
  for (const bag of (await api('GET', `/bramble/milk?child=${child.id}`)).body) await api('DELETE', `/bramble/milk/${bag.id}`)

  // ---- the owner's stash from the screenshot, plus a freezer that has grown, one part-used and one expired bag
  const seed = [
    ['room', new Date(Math.floor((Date.now() - 1.5 * HOUR) / 60_000) * 60_000), 78],
    ['fridge', at(1, 12, 44), 78],
    ['fridge', at(1, 1, 9), 70],
    ['freezer', at(6, 16, 45), 57],
    ['freezer', at(4, 18, 41), 80],
    ['freezer', at(1, 0, 36), 70],
    ['freezer', at(2, 23, 10), 90],
    ['freezer', at(3, 7, 30), 110],
    ['freezer', at(5, 3, 15), 65],
    ['freezer', at(8, 14, 0), 120],
    ['freezer', at(9, 22, 40), 100],
    ['fridge', at(6, 22, 5), 60], // past the 4-day fridge window: expired
  ]
  const made = []
  for (const [i, [location, pumped, ml]] of seed.entries()) {
    const r = await api('POST', '/bramble/milk', { child: child.id, pumped_at: pumped.toISOString(), volume_ml: ml, location, client_key: `list-${tag}-${i}-${Date.now()}` })
    if (r.status !== 201) problems.push(`[${tag}] seed ${location} ${r.status} ${JSON.stringify(r.body)}`)
    made.push({ ...r.body, pumpedLocal: pumped })
  }
  await api('PATCH', `/bramble/milk/${made[1].id}`, { remaining_ml: 48 })

  await page.goto(BASE + '/milk')
  await page.locator('.stash-section').first().waitFor()
  await settle(800)
  await shot('top')

  const heads = await page.locator('.stash-section .stash-section-head h3').allInnerTexts()
  ok('places in order: Room temp, Fridge, Freezer, Expired', JSON.stringify(heads) === JSON.stringify(['Room temp', 'Fridge', 'Freezer', 'Expired']), heads.join(', '))
  const counts = await page.locator('.stash-section .stash-section-head .small').allInnerTexts()
  ok('each place says how many bags and how much', squash(counts[0]) === '1 bag · 78 mL' && squash(counts[1]) === '2 bags · 118 mL' && squash(counts[2]) === '8 bags · 692 mL', counts.map(squash).join(' | '))
  ok('the old "Stored" heading is gone', (await page.getByRole('heading', { name: 'Stored' }).count()) === 0)

  // The key: each symbol the list shows, drawn as the rows draw it, above the first place.
  const key = page.getByTestId('stash-key')
  const keyWords = (await key.locator('.stash-key-item').allInnerTexts()).map(squash)
  ok('a key above the list names every symbol showing: places, then sun and moon', JSON.stringify(keyWords) === JSON.stringify(['Room temp', 'Fridge', 'Freezer', 'Day milk', 'Night milk']), keyWords.join(', '))
  ok('… it sits above the first place', await page.evaluate(() => {
    const k = document.querySelector('[data-testid="stash-key"]')
    const first = document.querySelector('.stash-section')
    return Boolean(k && first && k.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING)
  }))
  const tones = await key.locator('.stash-key-dot').evaluateAll((els) => els.map((e) => [...e.classList].find((c) => c.startsWith('tone-'))))
  const rowTones = await Promise.all(['stash-room', 'stash-fridge', 'stash-freezer'].map((id) => page.getByTestId(id).locator('.bag-row .icon-circle').first().evaluate((e) => [...e.classList].find((c) => c.startsWith('tone-')))))
  ok('… each place in the colour its rows use (teal snowflake = Freezer)', JSON.stringify(tones) === JSON.stringify(rowTones) && tones[2] === 'tone-sleep', `${tones.join(',')} vs ${rowTones.join(',')}`)
  ok('… the sun and the moon are the rows\' own marks', (await key.locator('.bag-part.is-day svg').count()) === 1 && (await key.locator('.bag-part.is-night svg path').count()) === 2)
  ok('… and it fits the screen', await key.evaluate((e) => e.getBoundingClientRect().right <= window.innerWidth && e.scrollWidth <= e.clientWidth + 1))

  const freezer = page.getByTestId('stash-freezer')
  ok('the freezer shows only the next bag to thaw', (await freezer.locator('.bag-row').count()) === 1)
  const more = freezer.locator('.stash-more')
  ok('… and "Show 7 more" with their volume', /^Show 7 more · \d+ mL$/.test(squash(await more.innerText())), squash(await more.innerText()))
  ok('the freezer runs soonest deadline first (oldest pumped)', (await freezer.locator('.bag-row').first().innerText()).includes(made[10].code))
  ok('a short place shows every bag', (await page.getByTestId('stash-fridge').locator('.bag-row').count()) === 2 && (await page.getByTestId('stash-fridge').locator('.stash-more').count()) === 0)

  // Sun or moon on every row, matching the pumped hour (the sticker's 9 PM–6 AM default).
  let marks = 0
  let right = 0
  for (const bag of made.filter((b) => b.code)) {
    const row = page.locator('.bag-row', { hasText: bag.code })
    if (!(await row.count())) continue
    marks += 1
    const night = (await row.locator('.bag-part.is-night').count()) === 1
    const day = (await row.locator('.bag-part.is-day').count()) === 1
    if (night !== day && night === isNight(bag.pumpedLocal)) right += 1
    else problems.push(`[${tag}] ${bag.code} pumped ${bag.pumpedLocal.toString()} night=${night} day=${day}`)
  }
  ok('every visible row has the sun or the moon of its pumped hour', marks >= 5 && right === marks, `${right} of ${marks}`)
  const night = page.locator('.bag-row', { hasText: made[2].code })
  ok('the moon is the sticker\'s crescent with a star (two shapes)', (await night.locator('.bag-part.is-night svg path').count()) === 2)
  ok('the row says night milk to a screen reader', /night milk/.test((await night.getAttribute('aria-label')) ?? ''))

  const room = page.locator('.bag-row', { hasText: made[0].code })
  // A bare clock today; a weekday once its 4 hours run past midnight.
  ok('the bag to use first has "Use first" over its deadline', (await room.locator('.bag-due .bag-first-tag').count()) === 1 && /^Use first ([A-Z][a-z]{2} )?\d{1,2}:\d{2} [AP]M$/.test(squash(await room.locator('.bag-due').innerText())), squash(await room.locator('.bag-due').innerText()))
  const fridge = page.locator('.bag-row', { hasText: made[2].code })
  ok('other rows say "Good until" and the moment', /^Good until \w{3} \d{1,2}:\d{2} [AP]M$/.test(squash(await fridge.locator('.bag-due').innerText())), squash(await fridge.locator('.bag-due').innerText()))
  ok('a freezer deadline is a date, no clock', /^Good until [A-Z][a-z]{2} \d{1,2}$/.test(squash(await freezer.locator('.bag-due').first().innerText())), squash(await freezer.locator('.bag-due').first().innerText()))
  ok('the place is not repeated on the row inside its section', !/· (Fridge|Freezer|Room temp)/.test(await fridge.locator('.bag-pumped').innerText()))
  ok('a part-used bag still shows its balance', squash(await page.locator('.bag-row', { hasText: made[1].code }).locator('.bag-vol').innerText()).startsWith('48 of 78 mL left'))
  const expired = page.getByTestId('stash-expired')
  ok('expired milk sits last, in red, with its age', (await expired.locator('.bag-row.state-expired').count()) === 1 && /^Expired .+ago$/.test(squash(await expired.locator('.bag-due').innerText())), squash(await expired.locator('.bag-due').innerText()))

  // Rows stay inside the screen and the deadline column never wraps.
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.bag-row')].some((r) => r.scrollWidth > r.clientWidth + 1 || r.getBoundingClientRect().right > window.innerWidth))
  ok('no row is wider than the screen', !overflow)
  const wrapped = await page.evaluate(() => [...document.querySelectorAll('.bag-due .bag-when')].some((e) => e.getClientRects().length > 1 || e.getBoundingClientRect().height > 30))
  ok('no deadline wraps', !wrapped)

  await freezer.scrollIntoViewIfNeeded()
  await settle(300)
  await shot('freezer-collapsed')
  await more.click()
  await settle(400)
  ok('Show more opens the place whole', (await freezer.locator('.bag-row').count()) === 8 && squash(await more.innerText()) === 'Show fewer' && (await more.getAttribute('aria-expanded')) === 'true')
  await shot('freezer-open')
  await more.click()
  await settle(400)
  ok('Show fewer folds it back', (await freezer.locator('.bag-row').count()) === 1)
  await shot('page', true)

  // Milk left on the counter shows as expired, but it went in the fridge in time: say when, and it keeps its fridge days.
  const outPumped = new Date(Math.floor((Date.now() - (4 * HOUR + 15 * 60_000)) / 60_000) * 60_000)
  const out = (await api('POST', '/bramble/milk', { child: child.id, pumped_at: outPumped.toISOString(), volume_ml: 60, location: 'room', client_key: `list-out-${tag}-${Date.now()}` })).body
  await page.goto(BASE + '/milk')
  await page.locator('.stash-section').first().waitFor()
  await settle(600)
  ok('the counter bag past 4 hours sits under Expired', (await page.getByTestId('stash-expired').locator('.bag-row', { hasText: out.code }).count()) === 1)
  await page.locator('.bag-row', { hasText: out.code }).click()
  await settle(500)
  const bagSheet = page.locator('dialog[open]').last()
  const inTime = bagSheet.getByRole('region', { name: 'Went in the fridge in time' })
  const moveBtn = inTime.getByRole('button', { name: 'Move to fridge' })
  ok('its sheet asks whether it went in the fridge in time, Move off until a time is given', (await inTime.count()) === 1 && (await moveBtn.isDisabled()) && (await bagSheet.getByRole('button', { name: /Discard expired milk/ }).count()) === 1)
  await inTime.getByLabel('In the fridge at').fill(localInput(new Date(outPumped.getTime() + 4 * HOUR + 5 * 60_000)))
  await settle(300)
  ok('a time after the 4 hours says it was out too long and keeps Move off', /out too long/.test(await inTime.innerText()) && (await moveBtn.isDisabled()))
  await shot('in-time-late')
  await inTime.getByLabel('In the fridge at').fill(localInput(new Date(outPumped.getTime() + 3 * HOUR + 50 * 60_000)))
  await settle(300)
  ok('a time inside the 4 hours turns Move on', !/out too long/.test(await inTime.innerText()) && (await moveBtn.isEnabled()))
  await shot('in-time-ok')
  await moveBtn.click()
  await settle(900)
  const after = (await api('GET', `/bramble/milk/${out.id}`)).body
  ok('the bag is in the fridge, good for 4 days from the pump, the time on record', after.location === 'fridge' && Math.abs(new Date(after.expires_at).getTime() - (outPumped.getTime() + 4 * DAY)) < 5000 && /In the fridge from .* \(time set by hand\)/.test(after.notes), `${after.location} ${after.expires_at} ${JSON.stringify(after.notes)}`)
  ok('… and the list shows it under Fridge, no longer expired', (await page.getByTestId('stash-fridge').locator('.bag-row', { hasText: out.code }).count()) === 1)
  await shot('in-time-moved')

  // The bottle sheet's picker uses the same row and says the place in words (no sections there).
  await page.goto(BASE + '/?log=bottle')
  await settle(1200)
  const pick = page.getByRole('button', { name: /Use milk from the stash/ })
  if (await pick.count()) {
    await pick.first().click()
    await settle(600)
    const pickerRow = page.locator('dialog[open]').last().locator('.bag-row', { hasText: made[2].code })
    ok('the picker row has the moon and the place in words', (await pickerRow.locator('.bag-part.is-night').count()) === 1 && /· Fridge/.test(await pickerRow.locator('.bag-pumped').innerText()), squash(await pickerRow.innerText()))
    await shot('picker')
  } else ok('the bottle sheet offers the stash', false)

  await ctx.close()
}

await run('light')
await run('dark')
await run('light', { width: 320, height: 640 })
await browser.close()

if (problems.length) {
  console.log('\nProblems:')
  for (const p of problems) console.log('  ' + p)
}
const failed = checks.filter((c) => !c.ok).length
console.log(`\n${checks.length - failed}/${checks.length} checks passed${problems.length ? `, ${problems.length} problems` : ''}`)
process.exit(failed || problems.length ? 1 : 0)
