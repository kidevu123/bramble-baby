/**
 * Probe for "add milk you already have" (Stash tab → label sheet without a pumping entry).
 * Runs against the isolated stack from the README (mock Baby Buddy + companion + vite dev), at iPhone
 * width, once per colour scheme. It adds two bottles pumped three days ago, one already expired and one
 * thawed, checks the remaining time, the label and its QR code, replays a save to prove it is idempotent,
 * and then runs the pumping label flow to confirm that still registers and links its bag.
 *
 * It starts by emptying the child's stash and pumping entries, so it only runs against localhost: never
 * point it at the real Baby Buddy.
 *
 * Usage: node e2e/stash-intake.mjs <out-dir> [base-url=http://localhost:5173]
 */
import { mkdirSync } from 'node:fs'
import jsQR from 'jsqr'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/stash-intake'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const HOUR = 3_600_000
const DAY = 24 * HOUR
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this probe deletes stash bags and pumping entries. Use the isolated stack from the README.`)
  process.exit(2)
}

const checks = []
const problems = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const pad = (n) => String(n).padStart(2, '0')
/** A Date as the value a datetime-local input takes. */
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const onTheMinute = (d) => new Date(Math.floor(d.getTime() / 60_000) * 60_000)
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance

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
  const kids = (await api('GET', '/api/children/')).body
  const child = kids.results[0]
  const stash = async () => (await api('GET', `/bramble/milk?child=${child.id}`)).body
  for (const bag of await stash()) await api('DELETE', `/bramble/milk/${bag.id}`)
  for (const p of (await api('GET', `/api/pumping/?child=${child.id}`)).body.results ?? []) await api('DELETE', `/api/pumping/${p.id}/`)

  await page.goto(BASE + '/milk')
  await settle(1000)
  await shot('stash-empty')
  ok('Stash has one way in to add existing milk', (await page.getByRole('button', { name: 'Add milk you already have' }).count()) === 1)

  // ---- bottle 1: pumped three days ago, in the fridge
  const created = []
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/bramble/milk')) created.push(r.postDataJSON()) })
  await page.getByRole('button', { name: 'Add milk you already have' }).click()
  await settle()
  await shot('add-form-blank')
  ok('nothing is registered just by opening the sheet', (await stash()).length === 0 && created.length === 0)
  ok('Add to stash is off until the volume is typed', await sheet().getByRole('button', { name: 'Add to stash' }).isDisabled())
  ok('Pumped defaults to now', /Today/.test(await sheet().locator('.time-field-value').first().innerText()))

  const threeDaysAgo = onTheMinute(new Date(Date.now() - 3 * DAY))
  await sheet().getByLabel('Volume in mL').fill('60')
  await sheet().getByLabel('Pumped:').fill(localInput(threeDaysAgo))
  await settle()
  const outlook = await sheet().locator('.intake-outlook').innerText()
  ok('form says one day is left for milk pumped three days ago', /Good until .+ · 1 day left/.test(outlook) && /4-day fridge window/.test(outlook), outlook.replace(/\s+/g, ' '))
  await shot('add-form-three-days-ago')
  await sheet().getByRole('button', { name: 'Add to stash' }).click()
  await sheet().locator('.stash-card .strong').first().waitFor()
  await settle(900)
  await shot('bottle-1-saved-label')

  let bags = await stash()
  ok('one bag after the first bottle', bags.length === 1)
  const first = bags[0]
  ok('pumped time is the real one', new Date(first.pumped_at).getTime() === threeDaysAgo.getTime(), first.pumped_at)
  ok('expiry is four days from pumping', new Date(first.expires_at).getTime() - new Date(first.pumped_at).getTime() === 4 * DAY)
  ok('about one day left, not four', near(new Date(first.expires_at).getTime() - Date.now(), DAY, 2 * 60_000), `${((new Date(first.expires_at).getTime() - Date.now()) / HOUR).toFixed(2)} h left`)
  ok('no pumping entry is attached', first.pumping_id === null)
  const card = (await sheet().locator('.stash-card').innerText()).replace(/\s+/g, ' ')
  ok('saved card shows the code and the time left', card.includes(`Bag ${first.code}`) && /1 day left/.test(card), card)

  // the label: real pumped date in its text, QR decodes to the bag code
  const weekday = threeDaysAgo.toLocaleDateString('en-US', { weekday: 'short' })
  const monthDay = threeDaysAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  await sheet().getByRole('button', { name: 'Copy as text' }).click()
  const labelText = await page.evaluate(() => navigator.clipboard.readText())
  ok('label text carries the real pumped date', labelText.includes(`${weekday} ${monthDay} ·`) && labelText.includes('60 mL'), labelText.replace(/\n/g, ' | '))
  const decode = async () => {
    const img = await sheet().locator('canvas.label-canvas').evaluate((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height)
      return { data: Array.from(d.data), width: d.width, height: d.height }
    })
    return jsQR(Uint8ClampedArray.from(img.data), img.width, img.height)?.data ?? null
  }
  const qr = await decode()
  ok('QR on the label decodes to the bag code', qr === `bramble:milk:${first.code}`, String(qr))
  ok('print actions are on once the bag exists', !(await sheet().getByRole('button', { name: 'Save image' }).isDisabled()))

  // ---- bottle 2: "Add another container" keeps date and place, asks only for the volume
  await sheet().getByRole('button', { name: 'Add another container' }).click()
  await settle()
  const kept = await sheet().getByLabel('Pumped:').inputValue()
  ok('next container keeps the pumped date', kept === localInput(threeDaysAgo), kept)
  ok('next container keeps the place', (await sheet().getByRole('radio', { name: 'Fridge' }).getAttribute('aria-checked')) === 'true')
  ok('next container needs its own volume', (await sheet().getByLabel('Volume in mL').inputValue()) === '' && (await sheet().getByRole('button', { name: 'Add to stash' }).isDisabled()))
  ok('running tally is shown', /1 added so far/.test(await sheet().locator('.intake-added').innerText()))
  await shot('add-another')
  await sheet().getByRole('button', { name: /Same as the last one: 60 mL/ }).click()
  await sheet().getByRole('button', { name: 'Add to stash' }).click()
  await sheet().locator('.stash-card .strong').first().waitFor()
  await settle(900)
  await shot('bottle-2-saved-label')
  bags = await stash()
  const second = bags.find((b) => b.id !== first.id)
  ok('an identical second bottle is its own bag', bags.length === 2 && second.code !== first.code && second.volume_ml === first.volume_ml && second.pumped_at === first.pumped_at)
  ok('each container sent its own key', created.length === 2 && created[0].client_key !== created[1].client_key && /^[0-9a-f]{32}$/.test(created[0].client_key))
  ok('second label has its own QR', (await decode()) === `bramble:milk:${second.code}`)

  // a retry of the very same save (lost response, double tap) returns the same bag
  const replay = await api('POST', '/bramble/milk', created[1])
  ok('replaying a save does not add a bag', replay.body.id === second.id && (await stash()).length === 2)

  // ---- bottle 3: already past its window
  await sheet().getByRole('button', { name: 'Add another container' }).click()
  await settle()
  const fiveDaysAgo = onTheMinute(new Date(Date.now() - 5 * DAY))
  await sheet().getByLabel('Volume in mL').fill('80')
  await sheet().getByLabel('Pumped:').fill(localInput(fiveDaysAgo))
  await settle()
  const warning = (await sheet().locator('.intake-outlook').innerText()).replace(/\s+/g, ' ')
  const advice = (await sheet().locator('.sheet-save [role=alert]').innerText()).replace(/\s+/g, ' ')
  ok('expired milk is called out before it is saved', /Already past its storage window/.test(warning) && /4-day fridge window/.test(warning) && /already expired/.test(advice), `${warning} | ${advice}`)
  ok('the button says what it does', (await sheet().getByRole('button', { name: 'Add it anyway' }).count()) === 1 && (await sheet().getByRole('button', { name: 'Add to stash' }).count()) === 0)
  await shot('expired-warning')
  await sheet().locator('.sheet-body').evaluate((el) => el.scrollTo(0, el.scrollHeight)).catch(() => undefined)
  await sheet().getByRole('button', { name: 'Add it anyway' }).click()
  await sheet().locator('.stash-card .strong').first().waitFor()
  await settle(900)
  const expiredCard = (await sheet().locator('.stash-card').innerText()).replace(/\s+/g, ' ')
  ok('saved expired bag is shown as expired', /expired (yesterday|1d ago|\d+h)/.test(expiredCard) && /past its storage window/.test(expiredCard), expiredCard)
  await shot('expired-saved')
  bags = await stash()
  const expired = bags.find((b) => b.volume_ml === 80)
  ok('expired bag is stored with its real, past expiry', expired && new Date(expired.expires_at).getTime() < Date.now() && expired.status === 'stored')
  const reminders = (await api('GET', `/bramble/reminders?child=${child.id}`)).body
  const forBag = (bag) => reminders.filter((r) => r.tag === `milk:${bag.id}`)
  ok('no reminders are queued for the expired bag', forBag(expired).length === 0)
  ok('reminders for the one-day bag are both still ahead', forBag(first).length === 2 && forBag(first).every((r) => new Date(r.at).getTime() > Date.now()))

  // ---- bottle 4: frozen earlier, thawed six hours ago
  await sheet().getByRole('button', { name: 'Add another container' }).click()
  await settle()
  await sheet().getByLabel('Volume in mL').fill('45')
  await sheet().getByLabel('Pumped:').fill(localInput(onTheMinute(new Date(Date.now() - 20 * DAY))))
  await sheet().getByRole('switch', { name: 'It was frozen and has thawed' }).click()
  await settle()
  ok('thawed milk needs a thaw time before it can be saved', (await sheet().getByRole('button', { name: /Add (to stash|it anyway)/ }).isDisabled()) && /Choose when it was thawed/.test(await sheet().locator('.sheet-save [role=alert]').innerText()))
  await shot('thawed-needs-time')
  const thawedAt = onTheMinute(new Date(Date.now() - 6 * HOUR))
  await sheet().getByLabel('Thawed:').fill(localInput(thawedAt))
  await settle()
  const thawOutlook = (await sheet().locator('.intake-outlook').innerText()).replace(/\s+/g, ' ')
  // The thaw time is set to the minute, so the form can say a minute either side of 18 h.
  ok('thawed milk counts 24 h from the thaw', /Good until .+ · (18h( [01]m)?|17h 59m) left/.test(thawOutlook) && /after thawing/.test(thawOutlook), thawOutlook)
  await shot('thawed-form')
  await sheet().getByRole('button', { name: 'Add to stash' }).click()
  await sheet().locator('.stash-card .strong').first().waitFor()
  await settle(900)
  await shot('thawed-saved-label')
  bags = await stash()
  const thawed = bags.find((b) => b.volume_ml === 45)
  ok('thawed bag keeps the thaw time that was entered', thawed && thawed.thawed === true && new Date(thawed.thawed_at).getTime() === thawedAt.getTime() && new Date(thawed.expires_at).getTime() === thawedAt.getTime() + DAY)
  await sheet().getByRole('button', { name: 'Copy as text' }).click()
  const thawedText = await page.evaluate(() => navigator.clipboard.readText())
  ok('thawed label says so and never offers the freezer', /Thawed/.test(thawedText) && /Do not refreeze/.test(thawedText) && !/Freezer [A-Z]/.test(thawedText), thawedText.replace(/\n/g, ' | '))

  ok('adding existing milk made no pumping entries', ((await api('GET', `/api/pumping/?child=${child.id}`)).body.results ?? []).length === 0)

  // ---- back on the Stash page
  await sheet().getByRole('button', { name: 'Close' }).click()
  await settle(900)
  ok('all four containers are listed', (await page.locator('.bag-list .bag-row').count()) === 4)
  ok('the expired one is flagged in the list', (await page.locator('.bag-row.state-expired').count()) === 1)
  await page.screenshot({ path: `${dir}/${pad(++n)}-stash-list.png`, fullPage: true })

  // reopening starts a blank container, it does not resurrect or re-add the last one
  await page.getByRole('button', { name: 'Add milk you already have' }).click()
  await settle()
  ok('reopening shows a blank container', (await sheet().getByLabel('Volume in mL').inputValue()) === '' && (await sheet().locator('.intake-added').count()) === 0)
  await sheet().getByRole('button', { name: 'Close' }).click()
  await settle()
  ok('reopening and closing adds nothing', (await stash()).length === 4)

  // reprint of a bag added this way: same code, same pumped date
  await page.locator('.bag-row', { hasText: first.code }).click()
  await settle()
  await shot('bag-actions')
  await sheet().getByRole('button', { name: 'Reprint label' }).click()
  await settle(1200)
  ok('reprint finds the same bag and code', (await decode()) === `bramble:milk:${first.code}` && (await stash()).length === 4)
  await shot('reprint')
  await sheet().getByRole('button', { name: 'Close' }).click()
  await settle()

  // ---- the pumping flow still registers its bag on open and links it on save
  await page.goto(BASE + '/')
  await settle(1200)
  await page.locator('.tile-pumping .tile-main').click()
  await settle()
  await sheet().getByLabel('Volume in mL').fill('90')
  await sheet().getByRole('button', { name: /Print milk label/ }).click()
  await sheet().locator('.stash-card .strong').first().waitFor()
  await settle(900)
  await shot('pumping-label')
  bags = await stash()
  const pumped = bags.find((b) => b.volume_ml === 90)
  ok('pumping label registers its bag as soon as it opens', bags.length === 5 && pumped && pumped.location === 'fridge' && pumped.thawed === false)
  ok('pumping label has no intake form', (await sheet().locator('.intake-form').count()) === 0 && (await sheet().getByRole('button', { name: 'Add another container' }).count()) === 0)
  ok('pumping label QR decodes to its bag', (await decode()) === `bramble:milk:${pumped.code}`)
  await sheet().getByRole('button', { name: 'Close' }).click()
  await settle()
  await sheet().getByRole('button', { name: 'Save', exact: true }).click()
  await settle(1500)
  const entries = (await api('GET', `/api/pumping/?child=${child.id}`)).body.results ?? []
  const linked = (await stash()).find((b) => b.id === pumped.id)
  ok('saving the pumping entry links the bag to it', entries.length === 1 && linked.pumping_id === entries[0].id)

  await ctx.close()
}

try {
  await run('light')
  await run('dark')
  await run('light', { width: 320, height: 640 })
} catch (err) {
  console.error('FAILED:', err.message.split('\n')[0])
  check('probe ran to the end', false, err.message.split('\n')[0])
}
await browser.close()
const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (problems.length) console.log('PROBLEMS:\n' + [...new Set(problems)].join('\n'))
process.exit(failed.length || problems.length ? 1 : 0)
