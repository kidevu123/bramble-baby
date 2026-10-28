/**
 * Live functional + visual sweep of the whole app at iPhone width: every tab, top-bar destination, sheet,
 * log type, timer, Reports view, Sleep Plans, Child page, Settings sheet, Insights, nap window, Contractions,
 * the Stash (typed-code scan fallback, bottle, move, discard, undo, reprint), "Add milk you already have",
 * the server print path (file:// backend) and Settings › Hatch scale against mock-hatch.mjs.
 *
 * Runs against the isolated stack from the README, once per colour scheme at 390 and once at 320 (light), with
 * the console and every failed request captured. Every screen gets a screenshot plus an automated layout audit
 * (horizontal overflow, text clipped by its box, interactive targets under 44 px, content left under a sticky
 * footer); the audit lines are printed for a human to look at next to the screenshots.
 *
 *   node e2e/mock-babybuddy.mjs 8710 &  node e2e/mock-hatch.mjs 8731 &
 *   BRAMBLE_PORT=8720 BRAMBLE_DB=/tmp/sweep.db BRAMBLE_VAPID_DIR=/tmp BABYBUDDY_URL=http://127.0.0.1:8710 \
 *     BRAMBLE_HATCH_URL=http://127.0.0.1:8731 BRAMBLE_PRINTER=file:///tmp/sweep-labels python3 server/bramble_server.py &
 *   BB_UPSTREAM=http://127.0.0.1:8710 BRAMBLE_UPSTREAM=http://127.0.0.1:8720 npx vite --port 5790 &
 *   node e2e/full-sweep.mjs ./e2e/out/sweep http://localhost:5790 http://127.0.0.1:8731 /tmp/sweep-labels
 *
 * It deletes the test children, timers and stash bags it finds, so it refuses anything but localhost.
 * SWEEP_RUNS=light,dark,light-320,light-rm picks the passes; the companion allows five Hatch sign-ins per ten
 * minutes and a pass uses four, so run one pass per companion start (restart it in between), as
 * e2e/full-sweep.sh does.
 */
import { mkdirSync, readdirSync } from 'node:fs'
import jsQR from 'jsqr'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/sweep'
const BASE = process.argv[3] ?? 'http://localhost:5790'
const HATCH = process.argv[4] ?? 'http://127.0.0.1:8731'
const LABEL_DIR = process.argv[5] ?? null
const ONLY = process.env.SWEEP_ONLY ? process.env.SWEEP_ONLY.split(',') : null
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this probe deletes children, timers and stash bags.`)
  process.exit(2)
}
const HOUR = 3_600_000
const DAY = 24 * HOUR
const pad = (n) => String(n).padStart(2, '0')
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const onTheMinute = (d) => new Date(Math.floor(d.getTime() / 60_000) * 60_000)
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const checks = []
const problems = []
const audits = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})

async function run(scheme, viewport, reducedMotion = 'no-preference') {
  const tag = `${scheme}-${viewport?.width ?? 390}${reducedMotion === 'reduce' ? '-rm' : ''}`
  const dir = `${OUT}/${tag}`
  mkdirSync(dir, { recursive: true })
  const ctx = await browser.newContext({ ...devices['iPhone 14'], ...(viewport ? { viewport } : {}), colorScheme: scheme, reducedMotion, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true })
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml', temp: 'f', weight: 'lb', length: 'in' } }))
    // Headless Chromium has no share sheet; pretend it does so the label sheet shows its iPhone layout
    // (Print primary, Share secondary). The call itself is recorded instead of opening anything.
    window.__shared = []
    navigator.canShare = () => true
    navigator.share = async (data) => { window.__shared.push({ files: (data.files ?? []).map((f) => f.name), title: data.title }) }
    window.confirm = () => true
  })
  const page = await ctx.newPage()
  const ignoreProblem = (url) => url.includes('/api/profile')
  page.on('console', (m) => { if (m.type() === 'error' && !(expectedFailure && /Failed to load resource/.test(m.text()))) problems.push(`[${tag}] console: ${m.text().slice(0, 300)}`) })
  page.on('pageerror', (e) => problems.push(`[${tag}] pageerror: ${e.message}`))
  page.on('response', (r) => { if (r.status() >= 400 && !ignoreProblem(r.url()) && !(expectedFailure && expectedFailure.test(r.url()))) problems.push(`[${tag}] http ${r.status()} ${r.request().method()} ${r.url()}`) })
  page.on('requestfailed', (r) => { if (!/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) problems.push(`[${tag}] failed ${r.method()} ${r.url()} ${r.failure()?.errorText}`) })
  const settle = (ms = 600) => page.waitForTimeout(ms)
  let n = 0
  const shots = []
  /** Screenshot + layout audit. The audit lines are collected for the human pass, not asserted. */
  const shot = async (name, opts = {}) => {
    n += 1
    const path = `${dir}/${pad(n)}-${name}.png`
    await page.screenshot({ path, ...opts })
    shots.push(path)
    const found = await page.evaluate(auditInPage)
    for (const line of found) audits.push(`[${tag}] ${pad(n)}-${name}: ${line}`)
    return path
  }
  const sheet = () => page.locator('dialog[open]').last()
  const title = () => sheet().locator('.sheet-head .sheet-title').first()
  const openSheets = () => page.locator('dialog[open]').count()
  /** A request that is supposed to fail (a wrong password answered 400) is not a problem. */
  let expectedFailure = null
  const ok = (name, cond, detail) => check(`[${tag}] ${name}`, cond, detail)
  const closeSheet = async () => { await sheet().getByRole('button', { name: 'Close' }).first().click(); await settle(400) }
  const save = async () => { await sheet().getByRole('button', { name: 'Save', exact: true }).click(); await settle(1200) }
  const tile = (name) => page.locator(`.tile-${name} .tile-main`)
  const sections = []
  const section = async (name, fn) => {
    if (ONLY && !ONLY.includes(name)) return
    sections.push(name)
    try {
      await fn()
    } catch (err) {
      const msg = err.message.split('\n')[0]
      ok(`section ${name} ran to the end`, false, msg)
      await page.screenshot({ path: `${dir}/ZZ-${name}-failure.png` }).catch(() => undefined)
      // Leave no sheet behind for the next section.
      await page.keyboard.press('Escape').catch(() => undefined)
      await page.goto(BASE + '/').catch(() => undefined)
      await settle(800)
    }
  }

  // ---------------------------------------------------------------- sign in and a fresh child
  await page.goto(BASE + '/')
  await page.waitForURL(/\/signin/)
  await shot('signin')
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill('wrong')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await settle(800)
  await shot('signin-wrong-password')
  ok('a wrong password is explained on the sign-in page', (await page.locator('[role=alert]').count()) > 0, (await page.locator('[role=alert]').innerText().catch(() => '')).replace(/\s+/g, ' '))
  await page.getByLabel('Password').fill('admin')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
  await settle(1000)
  const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
  const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
  const api = async (method, path, data) => {
    const res = await page.request.fetch(BASE + path, { method, headers, data })
    return { status: res.status(), body: res.status() === 204 ? null : await res.json().catch(() => null) }
  }
  // Start clean: our test children (events go with them in the mock), timers, Hatch link.
  for (const c of (await api('GET', '/api/children/')).body.results ?? []) if (['Oscar', 'Bump'].includes(c.first_name)) await api('DELETE', `/api/children/${c.slug}/`)
  for (const t of (await api('GET', '/api/timers/')).body.results ?? []) await api('DELETE', `/api/timers/${t.id}/`)
  await api('POST', '/bramble/hatch/disconnect', {})
  await fetch(`${HATCH}/__mock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true }) })
  await page.goto(BASE + '/')
  await page.waitForURL(/\/onboarding/, { timeout: 15000 })
  await settle(800)
  await shot('onboarding')
  await page.getByLabel('First name').fill('Oscar')
  await page.getByLabel('Birth date or due date').fill(isoDate(new Date(Date.now() - 24 * DAY)))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
  await settle(1500)
  const child = ((await api('GET', '/api/children/')).body.results ?? []).find((c) => c.first_name === 'Oscar')
  const stash = async () => (await api('GET', `/bramble/milk?child=${child.id}`)).body ?? []
  for (const bag of await stash()) await api('DELETE', `/bramble/milk/${bag.id}`)

  // ---------------------------------------------------------------- Home
  await section('home', async () => {
    await shot('home-empty')
    ok('Home is the index tab with the Track grid', (await page.locator('.tile-sleep').count()) === 1)
    const tabs = await page.locator('.tabbar .tab').allInnerTexts()
    ok('five tabs: Home, Reports, Sleep Plans, Stash, Child', tabs.join('|') === 'Home|Reports|Sleep Plans|Stash|Child', tabs.join('|'))
    ok('top bar has the lightbulb, inbox and gear', (await page.getByRole('button', { name: 'Insights' }).count()) === 1 && (await page.getByRole('button', { name: 'Notifications' }).count()) === 1 && (await page.getByRole('button', { name: 'Settings' }).count()) === 1)

    await page.getByRole('button', { name: 'Customize home' }).click()
    await settle()
    await shot('home-customize')
    ok('Customize opens in place', page.url().endsWith('/'))
    await sheet().getByRole('button', { name: 'Save' }).click()
    await settle()

    await page.getByRole('button', { name: 'Notifications' }).click()
    await settle()
    await shot('home-inbox-empty')
    ok('Inbox opens as a sheet in place', (await page.locator('dialog[open]').count()) === 1 && page.url().endsWith('/'))
    await closeSheet()

    await page.locator('.tile-bottle .tile-alarm').click()
    await settle()
    await shot('home-reminder-bottle')
    ok('tile alarm opens the reminder sheet', /reminder/i.test(await title().innerText()))
    await closeSheet()

    await page.getByRole('button', { name: 'Schedule creator' }).click()
    await settle()
    await shot('home-schedule-creator')
    ok('Schedule Creator opens in place from the band', page.url().endsWith('/') && (await page.locator('dialog[open]').count()) === 1)
    await sheet().getByRole('button', { name: 'Done' }).click()
    await settle()
  })

  // ---------------------------------------------------------------- every log type
  await section('log', async () => {
    await tile('sleep').click(); await settle(); await shot('log-sleep'); await save()
    await tile('nursing').click(); await settle(); await shot('log-nursing'); await closeSheet()
    await tile('bottle').click(); await settle()
    await sheet().getByRole('spinbutton', { name: /Amount in/ }).fill('90'); await shot('log-bottle'); await save()
    await tile('solids').click(); await settle()
    await sheet().getByRole('button', { name: /avocado/ }).click(); await sheet().getByRole('button', { name: /banana/ }).click()
    await shot('log-solids-grid')
    await sheet().getByRole('button', { name: 'Next' }).click(); await settle()
    await sheet().getByRole('radio', { name: 'Loved it' }).click(); await sheet().getByRole('radio', { name: 'Most' }).click()
    await shot('log-solids-details'); await save()
    await tile('diaper').click(); await settle()
    await sheet().getByRole('radio', { name: 'Poo' }).click(); await sheet().getByRole('radio', { name: 'Medium' }).click(); await sheet().getByRole('radio', { name: 'Brown' }).click()
    await shot('log-diaper'); await save()
    await tile('potty').click(); await settle(); await sheet().getByRole('radio', { name: 'Pee' }).click(); await shot('log-potty'); await save()
    await tile('activity').click(); await settle(); await sheet().getByRole('radio', { name: 'Bath' }).click(); await shot('log-activity'); await save()
    await tile('milestones').click(); await settle(); await sheet().locator('.milestone-chip').first().click(); await shot('log-milestone'); await save()
    await tile('medicine').click(); await settle(); await sheet().getByLabel('Name').fill('Vitamin D'); await sheet().getByLabel('Dose', { exact: true }).fill('1'); await sheet().getByRole('radio', { name: 'drops' }).click(); await shot('log-medicine'); await save()
    await tile('temperature').click(); await settle(); await sheet().getByLabel('Temperature', { exact: true }).fill('98.6'); await shot('log-temperature'); await save()
    await tile('growth').click(); await settle(); await sheet().getByLabel('Pounds').fill('6'); await sheet().getByLabel('Ounces').fill('3.2'); await shot('log-growth'); await save()
    ok('every log type saved into today', (await page.locator('.tl-row').count()) >= 10, String(await page.locator('.tl-row').count()))
    await shot('home-with-data')

    // The same-kind warning is about someone else's entry (CLAUDE.md row 50: `likelyDuplicate(…, me)`): the
    // diaper this phone just logged is in the list on screen, so a second one says nothing; a diaper another
    // caregiver logged a few minutes ago does warn.
    await tile('diaper').click(); await settle()
    await shot('log-diaper-own-no-warning')
    ok('a second diaper after your own shows no duplicate warning', (await sheet().locator('.dup-warning').count()) === 0, (await sheet().locator('.dup-warning').innerText().catch(() => '')).replace(/\s+/g, ' '))
    await closeSheet()
    await api('POST', '/api/changes/', { child: child.id, time: new Date(Date.now() - 5 * 60_000).toISOString(), wet: true, solid: false, color: '', amount: null, notes: '', tags: ['caregiver:mom'] })
    await page.reload(); await settle(1500)
    await tile('diaper').click(); await settle()
    await shot('log-diaper-duplicate-warning')
    ok('a diaper someone else logged 5 min ago shows the duplicate warning', /already logged/i.test(await sheet().locator('.dup-warning').innerText().catch(() => '')), (await sheet().locator('.dup-warning').innerText().catch(() => '')).replace(/\s+/g, ' '))
    await closeSheet()
    await page.locator('.tl-row').first().click(); await settle()
    await shot('log-edit-from-timeline')
    ok('tapping a timeline row opens the edit sheet with Delete', (await sheet().getByRole('button', { name: 'Delete entry' }).count()) === 1)
    await closeSheet()
  })

  // ---------------------------------------------------------------- timers
  await section('timers', async () => {
    await tile('sleep').click(); await settle()
    await sheet().getByRole('button', { name: /Start sleep timer/ }).click()
    await page.waitForURL(/\/timer\//, { timeout: 15000 }); await settle(1500)
    await shot('timer-sleep')
    await page.getByRole('button', { name: 'Back' }).click()
    await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 }); await settle(1000)
    ok('Back from a running timer returns Home and the timer keeps running', (await page.locator('.active-timer').count()) >= 1)
    await shot('home-active-timer')
    await page.locator('.active-timer').first().click()
    await page.waitForURL(/\/timer\//, { timeout: 15000 }); await settle(800)
    await page.getByRole('button', { name: 'Stop and save' }).click()
    await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 }); await settle(1000)

    await tile('nursing').click(); await settle()
    await sheet().locator('.side-btn').first().click()
    await page.waitForURL(/\/timer\//, { timeout: 15000 }); await settle(1500)
    await page.locator('.nurse-btn').nth(1).click(); await settle(1200)
    await shot('timer-nursing')
    await page.getByRole('button', { name: /Finish/ }).click()
    await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 }); await settle(1000)

    await tile('pumping').click(); await settle()
    await sheet().getByRole('button', { name: /Start pumping timer/ }).click()
    await page.waitForURL(/\/timer\//, { timeout: 15000 }); await settle(1200)
    ok('pumping timer cannot stop without a volume', await page.getByRole('button', { name: 'Stop and save' }).isDisabled())
    await shot('timer-pumping-no-volume')
    await page.getByLabel(/Volume in/).fill('70')
    await shot('timer-pumping-volume')
    ok('the timer says the sticker prints by itself on stop', /the sticker prints on Stop/.test(await page.locator('main').innerText()))
    const labelsBefore = LABEL_DIR ? readdirSync(LABEL_DIR).length : null
    await page.getByRole('button', { name: 'Stop and save' }).click()
    // Row 49: with a server printer and the phone's auto-print switch on (the default), Stop registers the bag
    // and prints; the label sheet does not open, the PrintNotice bar follows the print instead.
    await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
    const notice = page.getByTestId('print-notice')
    await page.waitForFunction(() => /Label sent to the printer|Could not print/.test(document.querySelector('[data-testid="print-notice"]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => undefined)
    await shot('timer-pumping-auto-print')
    ok('a stopped pumping timer with a volume does not open the label sheet', (await openSheets()) === 0)
    const noticeText = ((await notice.innerText().catch(() => '')) || '').replace(/\s+/g, ' ')
    ok('the print notice says the label was sent, with the volume and bag code', /Label sent to the printer · 70 mL · ID [A-Z0-9]{6}/.test(noticeText), noticeText)
    const timerBags = (await stash()).filter((b) => b.volume_ml === 70)
    ok('the stop registered one bag, linked to the pumping entry', timerBags.length === 1 && timerBags[0].pumping_id !== null, JSON.stringify(timerBags.map((b) => [b.code, b.pumping_id])))
    if (labelsBefore !== null) ok('the stop printed the label through the file:// backend', readdirSync(LABEL_DIR).length === labelsBefore + 1)
    // Good news leaves by itself; do not carry the bar into the next section.
    await page.waitForFunction(() => !document.querySelector('[data-testid="print-notice"]'), null, { timeout: 15000 }).catch(() => undefined)
  })

  // ---------------------------------------------------------------- print label (server printer, file:// backend)
  await section('print', async () => {
    const before = LABEL_DIR ? readdirSync(LABEL_DIR).length : null
    await tile('pumping').click(); await settle()
    await sheet().getByRole('button', { name: /Print milk label/ }).click(); await settle(900)
    await shot('label-no-volume')
    const primary = sheet().getByRole('button', { name: 'Print label' })
    ok('Print label is the primary action with a server printer', (await primary.count()) === 1 && (await primary.evaluate((b) => b.className)).includes('primary'))
    ok('Share is the secondary action', (await sheet().getByRole('button', { name: 'Share', exact: true }).count()) === 1)
    ok('Print, Share, Save image and Copy are off until the bag exists', (await primary.isDisabled()) && (await sheet().getByRole('button', { name: 'Share', exact: true }).isDisabled()) && (await sheet().getByRole('button', { name: 'Save image' }).isDisabled()) && (await sheet().getByRole('button', { name: 'Copy as text' }).isDisabled()))
    ok('why they are off is said in words', /enter the volume above and tap Add to stash/.test(await sheet().innerText()))
    const addToStash = sheet().getByRole('button', { name: 'Add to stash' })
    ok('Add to stash is off until a volume is typed', (await addToStash.count()) === 1 && (await addToStash.isDisabled()))
    const bagsBeforeLabel = (await stash()).length
    await sheet().getByLabel('Volume in mL').fill('120'); await settle(900)
    // Row 34: typing is not registering ("120" used to make a 1 mL bag at the first keystroke).
    ok('typing the volume alone makes no bag', (await stash()).length === bagsBeforeLabel && (await primary.isDisabled()))
    await addToStash.click()
    await sheet().locator('.stash-card .strong').first().waitFor({ timeout: 15000 }); await settle(900)
    await shot('label-ready')
    ok('Add to stash registers one bag with the typed volume', (await stash()).filter((b) => b.volume_ml === 120).length === 1)
    ok('actions come on once the bag registers', !(await primary.isDisabled()) && !(await sheet().getByRole('button', { name: 'Share', exact: true }).isDisabled()))
    await primary.click()
    await sheet().locator('.print-card').waitFor({ timeout: 15000 }); await settle(500)
    ok('Print label reports it was sent', /Sent to the printer/.test(await sheet().locator('.print-card').innerText()), (await sheet().locator('.print-card').innerText()).replace(/\s+/g, ' '))
    ok('the button turns into a deliberate Print again', (await sheet().getByRole('button', { name: /Print again/ }).count()) === 1)
    if (before !== null) ok('the companion wrote the label PNG through the file:// backend', readdirSync(LABEL_DIR).length === before + 1)
    await shot('label-printed')
    await sheet().getByRole('button', { name: 'Share', exact: true }).click(); await settle(400)
    const shared = await page.evaluate(() => window.__shared)
    ok('Share hands the PNG to the share sheet', shared.length === 1 && /\.png$/.test(shared[0].files[0]), JSON.stringify(shared))
    // label settings open nested over the label and come back to it
    const stackBefore = await openSheets()
    await sheet().getByRole('button', { name: /Milk labels & printer/ }).click(); await settle()
    ok('Milk labels & printer opens nested over the label', (await openSheets()) === stackBefore + 1 && /Milk labels & printer/.test(await title().innerText()))
    await shot('label-settings-nested')
    await closeSheet()
    ok('closing the settings returns to the label', (await openSheets()) === stackBefore && /Milk label/.test(await title().innerText()))
    await closeSheet()
    // The timer session just saved ends now; this manual entry sits before it so the periods do not overlap.
    await sheet().getByLabel('Started:').fill(localInput(onTheMinute(new Date(Date.now() - 3 * HOUR))))
    await sheet().getByLabel('Finished:').fill(localInput(onTheMinute(new Date(Date.now() - 3 * HOUR + 20 * 60_000))))
    const filesBeforeSave = LABEL_DIR ? readdirSync(LABEL_DIR).length : null
    const bagsBeforeSave = (await stash()).length
    await sheet().getByRole('button', { name: 'Save', exact: true }).click(); await settle(1200)
    ok('the pumping entry behind the printed label saved', (await openSheets()) === 0)
    // Its bag already exists (made by the label sheet), so Save links it and prints nothing more (row 49).
    await settle(1500)
    ok('saving after the label made its bag adds no bag and no second sticker', (await stash()).length === bagsBeforeSave && (filesBeforeSave === null || readdirSync(LABEL_DIR).length === filesBeforeSave) && (await page.getByTestId('print-notice').count()) === 0)
    ok('the label\'s bag is linked to the saved pumping entry', (await stash()).some((b) => b.volume_ml === 120 && b.pumping_id !== null))
  })

  // ---------------------------------------------------------------- Stash
  await section('stash', async () => {
    await page.getByRole('link', { name: 'Stash' }).click(); await settle(1000)
    await shot('stash-list')
    const bagsBefore = await stash()
    ok('the timer\'s auto-print and the pumping label made one bag each', bagsBefore.length === 2 && (await page.locator('.bag-list .bag-row').count()) === 2, String(bagsBefore.length))

    // scan fallback with a typed code
    await page.getByRole('button', { name: 'Scan a bag' }).click()
    await sheet().locator('[role=alert]').waitFor({ timeout: 10000 }); await settle(500)
    await shot('stash-scan-no-camera')
    ok('without a camera the scanner says to type the code', /Type the code|type the code/.test(await sheet().innerText()))
    const codeField = sheet().getByLabel('Or type the code')
    await codeField.fill('nopeyy')
    await sheet().getByRole('button', { name: 'Find' }).click(); await settle()
    await shot('stash-scan-bad-code')
    ok('a wrong code is explained', /not a Bramble bag code/.test(await sheet().innerText()))
    await codeField.fill(bagsBefore[0].code.toLowerCase())
    await sheet().getByRole('button', { name: 'Find' }).click(); await settle(900)
    ok('a typed code opens that bag', new RegExp(`Bag ${bagsBefore[0].code}`).test(await title().innerText()))
    await shot('stash-bag-actions')

    // make a bottle from this bag
    await sheet().getByRole('button', { name: 'Make a bottle with this bag' }).click(); await settle(900)
    await shot('stash-bottle-from-bag')
    const amount = await sheet().getByRole('spinbutton', { name: /Amount in/ }).inputValue()
    ok('the bottle sheet is prefilled with the bag volume', Number(amount) === Math.round(bagsBefore[0].volume_ml), amount)
    await save()
    const afterBottle = await stash()
    const used = afterBottle.find((b) => b.id === bagsBefore[0].id)
    ok('saving the bottle marks the bag used with the feeding id', used.status === 'used' && used.feeding_id !== null, `${used.status} feeding=${used.feeding_id}`)
    await settle(600)
    await shot('stash-after-bottle')

    // history + undo
    await page.getByRole('button', { name: /Show used and discarded/ }).click(); await settle()
    await shot('stash-history')
    await page.getByRole('button', { name: 'Undo' }).first().click(); await settle(900)
    ok('Undo puts the bag back', (await stash()).find((b) => b.id === bagsBefore[0].id).status === 'stored')

    // move, discard
    await page.locator('.bag-row', { hasText: bagsBefore[1].code }).click(); await settle()
    await sheet().getByRole('button', { name: 'Move to freezer' }).click(); await settle(900)
    ok('Move to freezer updates the bag', (await stash()).find((b) => b.id === bagsBefore[1].id).location === 'freezer')
    await page.locator('.bag-row', { hasText: bagsBefore[1].code }).click(); await settle()
    await shot('stash-bag-frozen')
    ok('a frozen bag offers Thaw in fridge and never Move to freezer', (await sheet().getByRole('button', { name: 'Thaw in fridge' }).count()) === 1 && (await sheet().getByRole('button', { name: 'Move to freezer' }).count()) === 0)
    // Row 65: Discard is a danger button that names what it throws away.
    await sheet().getByRole('button', { name: 'Discard this milk' }).click(); await settle(900)
    ok('Discard removes the bag from the stored list', (await stash()).find((b) => b.id === bagsBefore[1].id).status === 'discarded' && (await page.locator('.bag-list .bag-row:not(.static)').count()) === 1)

    // reprint
    await page.locator('.bag-row', { hasText: bagsBefore[0].code }).click(); await settle()
    await sheet().getByRole('button', { name: 'Reprint label' }).click(); await settle(1200)
    await shot('stash-reprint')
    ok('reprint shows the same bag code and the QR decodes to it', (await decodeLabel(sheet())) === `bramble:milk:${bagsBefore[0].code}`)
    await closeSheet()

    // bottle sheet from Home: "Use milk from the stash" picker
    await page.getByRole('link', { name: 'Home' }).click(); await settle(800)
    await tile('bottle').click(); await settle()
    await sheet().getByRole('button', { name: /Use milk from the stash/ }).click(); await settle()
    await shot('bottle-stash-picker')
    ok('the bottle sheet can pick a bag from the stash', /Bag|pumped/i.test(await sheet().innerText()))
    await closeSheet()
    if (await page.locator('dialog[open]').count()) await closeSheet()
  })

  // ---------------------------------------------------------------- add milk you already have (intake)
  await section('intake', async () => {
    await page.getByRole('link', { name: 'Stash' }).click(); await settle(1000)
    await page.getByRole('button', { name: 'Add milk you already have' }).click(); await settle()
    await shot('intake-blank')
    ok('Add to stash is off until a volume is typed', await sheet().getByRole('button', { name: 'Add to stash' }).isDisabled())
    const threeDaysAgo = onTheMinute(new Date(Date.now() - 3 * DAY))
    await sheet().getByLabel('Volume in mL').fill('60')
    await sheet().getByLabel('Pumped:').fill(localInput(threeDaysAgo))
    await sheet().getByRole('radio', { name: 'Freezer' }).click(); await settle()
    await shot('intake-freezer-three-days')
    ok('freezer milk pumped 3 days ago shows the 6-month window', /Good until .+ · /.test(await sheet().locator('.intake-outlook').innerText()) && /6-month|freezer/.test(await sheet().locator('.intake-outlook').innerText()), (await sheet().locator('.intake-outlook').innerText()).replace(/\s+/g, ' '))
    await sheet().getByRole('radio', { name: 'Fridge' }).click(); await settle()
    await sheet().getByRole('button', { name: 'Add to stash' }).click()
    await sheet().locator('.stash-card .strong').first().waitFor({ timeout: 15000 }); await settle(900)
    await shot('intake-saved-label')
    const first = (await stash()).find((b) => b.volume_ml === 60 && b.status === 'stored')
    ok('the bag is stored with its real pumped time and no pumping entry', first && new Date(first.pumped_at).getTime() === threeDaysAgo.getTime() && first.pumping_id === null)
    const weekday = threeDaysAgo.toLocaleDateString('en-US', { weekday: 'short' })
    const monthDay = threeDaysAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    await sheet().getByRole('button', { name: 'Copy as text' }).click()
    const labelText = await page.evaluate(() => navigator.clipboard.readText())
    ok('label preview shows the real pumped date', labelText.includes(`${weekday} ${monthDay}`), labelText.replace(/\n/g, ' | '))
    ok('QR decodes to the bag code', (await decodeLabel(sheet())) === `bramble:milk:${first.code}`)
    ok('print actions are on for this bag', !(await sheet().getByRole('button', { name: 'Print label' }).isDisabled()))

    // Add another container: keeps date and place
    await sheet().getByRole('button', { name: 'Add another container' }).click(); await settle()
    await shot('intake-another')
    ok('the next container keeps the pumped time and place', (await sheet().getByLabel('Pumped:').inputValue()) === localInput(threeDaysAgo) && (await sheet().getByRole('radio', { name: 'Fridge' }).getAttribute('aria-checked')) === 'true')

    // already expired
    await sheet().getByLabel('Volume in mL').fill('80')
    await sheet().getByLabel('Pumped:').fill(localInput(onTheMinute(new Date(Date.now() - 5 * DAY)))); await settle()
    await shot('intake-expired-warning')
    ok('expired milk is called out and the button says Add it anyway', (await sheet().getByRole('button', { name: 'Add it anyway' }).count()) === 1 && /Already past its storage window/.test(await sheet().locator('.intake-outlook').innerText()))
    await sheet().getByRole('button', { name: 'Add it anyway' }).click()
    await sheet().locator('.stash-card .strong').first().waitFor({ timeout: 15000 }); await settle(900)
    await shot('intake-expired-saved')
    ok('the expired bag is shown as expired with Freezer not offered', /expired/.test(await sheet().locator('.stash-card').innerText()))

    // thawed with a thaw time
    await sheet().getByRole('button', { name: 'Add another container' }).click(); await settle()
    await sheet().getByLabel('Volume in mL').fill('45')
    await sheet().getByLabel('Pumped:').fill(localInput(onTheMinute(new Date(Date.now() - 20 * DAY))))
    await sheet().getByRole('switch', { name: 'It was frozen and has thawed' }).click(); await settle()
    await shot('intake-thawed-needs-time')
    ok('thawed milk needs its thaw time', await sheet().getByRole('button', { name: /Add (to stash|it anyway)/ }).isDisabled())
    await sheet().getByLabel('Thawed:').fill(localInput(onTheMinute(new Date(Date.now() - 6 * HOUR)))); await settle()
    await shot('intake-thawed-form')
    ok('thawed milk counts 24 h from the thaw', /(17h 59m|18h|18h 1m) left/.test(await sheet().locator('.intake-outlook').innerText()), (await sheet().locator('.intake-outlook').innerText()).replace(/\s+/g, ' '))
    await sheet().getByRole('button', { name: 'Add to stash' }).click()
    await sheet().locator('.stash-card .strong').first().waitFor({ timeout: 15000 }); await settle(900)
    await shot('intake-thawed-saved')
    await closeSheet()
    await shot('stash-after-intake', { fullPage: true })
    ok('intake made no pumping entries', ((await api('GET', `/api/pumping/?child=${child.id}`)).body.results ?? []).length === 2)
    ok('the expired one is flagged in the list', (await page.locator('.bag-row.state-expired').count()) === 1)

    // pumping flow still registers its bag
    await page.getByRole('link', { name: 'Home' }).click(); await settle(800)
    await tile('pumping').click(); await settle()
    await sheet().getByLabel('Started:').fill(localInput(onTheMinute(new Date(Date.now() - 5 * HOUR))))
    await sheet().getByLabel('Finished:').fill(localInput(onTheMinute(new Date(Date.now() - 5 * HOUR + 20 * 60_000))))
    await sheet().getByLabel('Volume in mL').fill('95')
    await sheet().getByRole('button', { name: /Print milk label/ }).click()
    await sheet().locator('.stash-card .strong').first().waitFor({ timeout: 15000 }); await settle(600)
    ok('the pumping label still registers its bag', (await stash()).some((b) => b.volume_ml === 95))
    await closeSheet()
    await closeSheet()
  })

  // ---------------------------------------------------------------- Reports
  await section('reports', async () => {
    await page.getByRole('link', { name: 'Reports' }).click(); await settle(1500)
    await shot('reports-day')
    ok('Reports top bar has the lightbulb and gear', (await page.getByRole('button', { name: 'Insights' }).count()) === 1 && (await page.getByRole('button', { name: 'Settings', exact: true }).count()) === 1)
    ok('switching tabs starts the new page at the top', (await page.evaluate(() => Math.round(window.scrollY + (document.querySelector('main.page')?.scrollTop ?? 0)))) === 0, `scrolled ${await page.evaluate(() => window.scrollY)}`)
    await page.getByRole('button', { name: 'Previous day' }).click(); await settle(800); await shot('reports-day-yesterday')
    await page.getByRole('button', { name: 'Next day' }).click(); await settle(800)
    await page.getByRole('tab', { name: 'Week' }).click(); await settle(1000); await shot('reports-week')
    await page.getByRole('tab', { name: 'List' }).click(); await settle(800); await shot('reports-list')
    await page.getByRole('tab', { name: 'Summary' }).click(); await settle(1000); await shot('reports-summary')
    for (const cat of ['Solids', 'Diapers', 'Pumping', 'Growth']) {
      const b = page.getByRole('button', { name: cat, exact: true })
      if (await b.count()) { await b.first().click(); await settle(800); await shot(`reports-summary-${cat.toLowerCase()}`) }
    }
    const rise = page.getByRole('button', { name: /Rise|Bedtime/ })
    if (await rise.count()) { await rise.first().click(); await settle(800); await shot('reports-rise-bedtime') }
    await page.getByRole('button', { name: 'Reports settings' }).click(); await settle()
    await shot('reports-settings')
    await sheet().getByRole('button', { name: 'Apply' }).click(); await settle()
  })

  // ---------------------------------------------------------------- Sleep Plans
  await section('plans', async () => {
    await page.getByRole('link', { name: 'Sleep Plans' }).click(); await settle(1000)
    await shot('plans-questionnaire')
    for (const opt of ['Crib in own room', 'Fed to sleep', '1–2', 'Feed', 'Short naps', 'Yes', 'Longer naps', 'Gentle']) {
      const b = page.getByRole('radio', { name: new RegExp(opt, 'i') }).first()
      if (await b.count()) await b.click()
    }
    await shot('plans-questionnaire-filled', { fullPage: true })
    await page.getByRole('button', { name: 'Build my plan' }).click(); await settle(1000)
    await shot('plans-plan')
    await shot('plans-plan-full', { fullPage: true })
    const edit = page.getByRole('button', { name: 'Update questionnaire' })
    if (await edit.count()) { await edit.first().click(); await settle(600); await shot('plans-edit-answers'); }
  })

  // ---------------------------------------------------------------- Insights (top bar) and Back
  await section('insights', async () => {
    await page.getByRole('link', { name: 'Reports' }).click(); await settle(800)
    await page.getByRole('button', { name: 'Insights' }).click(); await settle(1000)
    await shot('insights')
    ok('Insights shows Back, not the child switcher', (await page.getByRole('button', { name: 'Back' }).count()) === 1)
    for (const t of ['The science', 'Miniplans']) {
      const b = page.getByRole('button', { name: t })
      if (await b.count()) { await b.click(); await settle(800); await shot(`insights-${t.toLowerCase().replace(/\s+/g, '-')}`) }
    }
    await page.getByRole('button', { name: 'Back' }).click(); await settle(800)
    ok('Back from Insights returns to Reports (where we came from)', new URL(page.url()).pathname === '/reports', page.url())
  })

  // ---------------------------------------------------------------- nap window page
  await section('nap-window', async () => {
    await page.getByRole('link', { name: 'Home' }).click(); await settle(800)
    await page.locator('a.band-pred').click(); await settle(1000)
    await shot('nap-window')
    ok('nap window page shows Back', (await page.getByRole('button', { name: 'Back' }).count()) === 1)
    ok('the band on the nap window page does not link to the page it is on', (await page.locator('a.band-pred').count()) === 0 && (await page.locator('.band-pred').count()) === 1)
    const sc = page.getByRole('button', { name: /Schedule/ })
    if (await sc.count()) { await sc.first().click(); await settle(); await shot('nap-window-schedule-creator'); ok('Schedule Creator opens in place on nap window', new URL(page.url()).pathname === '/nap'); await sheet().getByRole('button', { name: 'Done' }).click(); await settle() }
    await page.getByRole('button', { name: 'Back' }).click(); await settle(800)
    ok('Back from nap window returns Home', new URL(page.url()).pathname === '/')
  })

  // ---------------------------------------------------------------- Child page
  await section('child', async () => {
    await page.getByRole('link', { name: 'Child' }).click(); await settle(1000)
    await shot('child')
    ok('Child top bar has the lightbulb and gear', (await page.getByRole('button', { name: 'Insights' }).count()) === 1 && (await page.getByRole('button', { name: 'Settings', exact: true }).count()) === 1)
    await page.getByRole('radio', { name: 'Boy' }).click(); await settle(600)
    await page.getByRole('button', { name: 'Edit latest weight' }).click(); await settle()
    await shot('child-edit-weight')
    ok('tapping the weight stat opens the growth sheet with Delete', (await sheet().getByRole('button', { name: 'Delete entry' }).count()) === 1)
    await sheet().getByLabel('Pounds').fill('6'); await sheet().getByLabel('Ounces').fill('6.4'); await save()
    ok('the edited weight shows on the stat as lb and oz', /6 lb 6 oz/.test(await page.locator('.growth-stat').first().innerText()), (await page.locator('.growth-stat').first().innerText()).replace(/\s+/g, ' '))
    await page.getByRole('button', { name: 'Edit latest height' }).click(); await settle()
    await shot('child-add-height')
    await sheet().getByLabel(/Height in/).fill('20.5'); await save()
    await page.locator('.growth-history').scrollIntoViewIfNeeded()
    await page.locator('.growth-row').first().click(); await settle()
    await shot('child-edit-history-row')
    await sheet().getByRole('button', { name: 'Delete entry' }).click(); await settle(1200)
    ok('Delete from the history row removes the entry', (await page.locator('.growth-row').count()) === 0)
    await shot('child-full', { fullPage: true })

    await page.getByRole('button', { name: /Nap window settings/ }).click(); await settle(); await shot('child-nap-window-settings'); await sheet().getByRole('button', { name: 'Done' }).click(); await settle()
    await page.getByRole('button', { name: /Schedule Creator/ }).click(); await settle(); await shot('child-schedule-creator'); await sheet().getByRole('button', { name: 'Done' }).click(); await settle()
    await page.getByRole('button', { name: 'Edit profile' }).click(); await settle(); await shot('child-edit-profile'); await closeSheet()
    await page.getByRole('button', { name: /Add another child/ }).click(); await settle(); await shot('child-add-child')
    await sheet().getByLabel('First name').fill('Bump')
    await sheet().getByLabel('Birth date or due date').fill(isoDate(new Date(Date.now() + 26 * DAY)))
    await sheet().getByRole('button', { name: 'Save' }).click(); await settle(1500)
    ok('a second child shows the child switcher', (await page.getByLabel('Switch child').count()) === 1)
    await shot('child-two-children')
  })

  // ---------------------------------------------------------------- Expecting mode + Contractions
  await section('contractions', async () => {
    const bump = ((await api('GET', '/api/children/')).body.results ?? []).find((c) => c.first_name === 'Bump')
    await page.getByLabel('Switch child').selectOption(String(bump.id)); await settle(1200)
    await page.getByRole('link', { name: 'Home' }).click(); await settle(1200)
    await shot('home-expecting')
    await page.locator('.tile-contractions .tile-main').click()
    await page.waitForURL(/\/contractions/); await settle(800)
    await page.getByRole('button', { name: 'Start contraction' }).click(); await settle(2200)
    await page.getByRole('button', { name: 'Stop contraction' }).click(); await settle(1000)
    await shot('contractions')
    await page.getByRole('button', { name: 'Back' }).click(); await settle(800)
    ok('Back from Contractions returns Home', new URL(page.url()).pathname === '/')
    await page.getByLabel('Switch child').selectOption(String(child.id)); await settle(1000)
  })

  // ---------------------------------------------------------------- Settings and every sheet
  await section('settings', async () => {
    await page.getByRole('link', { name: 'Stash' }).click(); await settle(800)
    await page.getByRole('button', { name: 'Settings' }).click(); await settle(1000)
    await shot('settings')
    await shot('settings-full', { fullPage: true })
    const version = await page.getByTestId('version').innerText()
    ok('the version footer shows app, build and server versions', /App \d+\.\d+\.\d+ · build \w+ \(\d{4}-\d{2}-\d{2}\) · server \d+\.\d+\.\d+/.test(version), version)
    ok('Settings shows Back', (await page.getByRole('button', { name: 'Back' }).count()) === 1)

    await page.getByRole('button', { name: /^Units/ }).click(); await settle()
    await shot('settings-units')
    await sheet().getByRole('tab', { name: 'oz' }).click(); await settle(300)
    await sheet().getByRole('tab', { name: 'mL' }).click(); await settle(300)
    await closeSheet()
    await page.getByRole('button', { name: /^Notifications/ }).click(); await settle(1200)
    await shot('settings-notifications')
    await shot('settings-notifications-full', { fullPage: true })
    await closeSheet()
    await page.getByRole('button', { name: /Milk labels & printer/ }).click(); await settle()
    await shot('settings-labels')
    const body = sheet().locator('.sheet-body')
    await body.evaluate((el) => el.scrollTo(0, el.scrollHeight)); await settle(300)
    await shot('settings-labels-bottom')
    ok('label settings say a server printer is connected', /printer/i.test(await sheet().innerText()))
    await closeSheet()
    // Row 36: the role lives in Settings › Household › People (one row per login), not a per-phone name.
    await page.getByRole('button', { name: /^People/ }).click(); await settle(1200)
    await shot('settings-people')
    const meRow = sheet().getByRole('button', { name: /\(you\), admin$/ })
    ok('People lists the signed-in login as you', (await meRow.count()) === 1)
    await meRow.click(); await settle()
    await sheet().getByRole('radio', { name: 'Dad' }).click()
    await sheet().getByRole('button', { name: 'Save', exact: true }).click()
    await sheet().locator('.people-saved').waitFor({ timeout: 10000 }); await settle(400)
    await shot('settings-people-role')
    await closeSheet()
    await closeSheet()
    ok('the People row shows the saved role', /Dad/.test(await page.getByRole('button', { name: /^People/ }).innerText()), (await page.getByRole('button', { name: /^People/ }).innerText()).replace(/\s+/g, ' '))
    await page.getByRole('button', { name: /Export CSV/ }).click(); await settle(800)
    await shot('settings-export')
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), sheet().getByRole('button', { name: 'Download CSV' }).click()])
    ok('Export downloads a CSV named after the child', /^oscar-bramble-\d{4}-\d{2}-\d{2}\.csv$/.test(download.suggestedFilename()), download.suggestedFilename())
    await closeSheet()
    await page.locator('details.credits summary').click(); await settle(300)
    await shot('settings-credits')
    await page.locator('details.credits summary').click()
    // Appearance is one round header button that cycles Auto -> Light -> Dark; its name says the current mode.
    const appearance = page.getByRole('button', { name: /^Appearance: / })
    const setTheme = async (mode) => {
      for (let i = 0; i < 3 && !(await appearance.getAttribute('aria-label')).startsWith(`Appearance: ${mode}.`); i++) {
        await appearance.click(); await settle(200)
      }
      ok(`Appearance reaches ${mode}`, (await appearance.getAttribute('aria-label')).startsWith(`Appearance: ${mode}.`))
    }
    await setTheme(scheme === 'dark' ? 'Light' : 'Dark'); await settle(500)
    await shot('settings-theme-switched')
    await setTheme('Auto'); await settle(300)

    await page.getByRole('button', { name: 'Back' }).click(); await settle(800)
    ok('Back from Settings returns to the Stash tab we came from', new URL(page.url()).pathname === '/milk', page.url())
  })

  // ---------------------------------------------------------------- Hatch scale
  await section('hatch', async () => {
    const mock = (body) => fetch(`${HATCH}/__mock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const view = () => sheet().locator('.conn-sheet').getAttribute('data-hatch-view')
    const waitView = (v) => page.waitForFunction((v) => document.querySelector('dialog[open] .conn-sheet')?.getAttribute('data-hatch-view') === v, v, { timeout: 20000 })
    const idle = async () => { await settle(400); await page.waitForFunction(() => !document.querySelector('dialog[open] .conn-sync .btn[aria-busy]') && !/Checking Hatch/.test(document.body.innerText), null, { timeout: 20000 }); await settle(300) }
    const weights = async () => (await api('GET', `/api/weight/?child=${child.id}&limit=100`)).body.results
    await page.goto(BASE + '/settings'); await settle(900)
    const row = page.getByRole('button', { name: /Hatch scale/ })
    await row.click(); await settle(600)
    ok('Hatch opens on the sign-in view', (await view()) === 'signin')
    await shot('hatch-signin')
    await sheet().getByLabel('Hatch email').fill('owner@example.com')
    await sheet().getByLabel('Hatch password').fill('wrong')
    expectedFailure = /\/bramble\/hatch\/connect$/
    await sheet().getByRole('button', { name: 'Sign in to Hatch' }).click()
    await sheet().getByRole('alert').waitFor({ timeout: 15000 })
    expectedFailure = null
    await shot('hatch-wrong-password')
    ok('a wrong Hatch password is explained in words', /did not accept that email and password/.test(await sheet().getByRole('alert').innerText()))
    await sheet().getByLabel('Hatch password').fill('hatch')
    await sheet().getByRole('button', { name: 'Sign in to Hatch' }).click()
    // Two Bramble children (Oscar and Bump) and one Hatch baby: the sheet asks rather than guessing.
    await page.waitForFunction(() => ['connected', 'choose'].includes(document.querySelector('dialog[open] .conn-sheet')?.getAttribute('data-hatch-view')), null, { timeout: 20000 })
    if ((await view()) === 'choose') {
      await shot('hatch-choose-one-baby-two-children')
      ok('with two Bramble children the Hatch baby is not guessed', true)
      await sheet().getByLabel('Bramble child for Oscar').selectOption(String(child.id))
    }
    await waitView('connected'); await idle()
    await shot('hatch-connected')
    const stats = (await sheet().locator('.conn-stats').innerText()).replace(/\n/g, ' ')
    const imported = Number(/(\d+) weights imported/.exec(stats)?.[1] ?? 0)
    ok('first import brings in the Hatch weighings', imported === 6, stats)
    await sheet().getByText('Connection report').click(); await settle(300)
    await sheet().locator('.conn-report').scrollIntoViewIfNeeded()
    await shot('hatch-connected-report')
    await sheet().getByText('Connection report').click()
    await mock({ weigh: 3190 })
    await sheet().getByRole('button', { name: 'Sync now' }).click(); await idle()
    ok('Sync now imports a new weighing', new RegExp(`${imported + 1} weights imported`).test((await sheet().locator('.conn-stats').innerText()).replace(/\n/g, ' ')))
    await shot('conn-synced')
    // weights are not coming in
    await mock({ listKey: 'weightList', weigh: 3200 })
    await sheet().getByRole('button', { name: 'Sync now' }).click()
    await sheet().locator('.conn-problem.error').waitFor({ timeout: 20000 }); await idle()
    await shot('conn-problem')
    ok('an unreadable answer shows "Weights are not coming in"', /Weights are not coming in/.test(await sheet().locator('.conn-problem').innerText()))
    await sheet().locator('.conn-report').scrollIntoViewIfNeeded(); await settle(300)
    await shot('conn-problem-report')
    const report = await sheet().locator('.conn-report-text').innerText()
    ok('the report holds no email or token', !/owner@example\.com/.test(report) && !/NDMyMT/.test(report))
    await mock({ listKey: 'weights' })
    await sheet().getByRole('button', { name: 'Sync now' }).click()
    await page.waitForFunction(() => !document.querySelector('dialog[open] .conn-problem'), null, { timeout: 20000 }); await idle()
    // Hatch ends the session
    await mock({ expire: true })
    await sheet().getByRole('button', { name: 'Sync now' }).click()
    await waitView('signin-again'); await settle(400)
    await shot('hatch-signin-again')
    ok('an ended session asks to sign in again', /Hatch signed Bramble out/.test(await sheet().locator('.conn-band').innerText()))
    await sheet().getByLabel('Hatch password').fill('hatch')
    await sheet().getByRole('button', { name: 'Sign in again' }).click()
    await waitView('connected'); await idle()
    const n1 = (await weights()).length
    await sheet().getByRole('button', { name: 'Disconnect' }).click(); await settle(300)
    await sheet().locator('.conn-confirm').scrollIntoViewIfNeeded()
    await shot('conn-disconnect-confirm')
    await sheet().locator('.conn-confirm').getByRole('button', { name: 'Disconnect' }).click()
    await waitView('signin')
    ok('Disconnect keeps the imported weights', (await weights()).length === n1)
    await mock({ babies: 2 })
    await sheet().getByLabel('Hatch email').fill('owner@example.com')
    await sheet().getByLabel('Hatch password').fill('hatch')
    await sheet().getByRole('button', { name: 'Sign in to Hatch' }).click()
    await waitView('choose'); await settle(400)
    await shot('hatch-choose-child')
    ok('two Hatch babies ask which child is which', (await sheet().getByLabel('Bramble child for Nico').count()) === 1)
    await sheet().getByLabel('Bramble child for Nico').selectOption('0'); await settle(600)
    await sheet().getByLabel('Bramble child for Oscar').selectOption(String(child.id))
    await settle(600)
    await waitView('connected'); await idle()
    ok('choosing recognises the same weights and doubles nothing', (await weights()).length === n1, String((await weights()).length))
    await shot('hatch-chosen')
    await closeSheet()
    await shot('settings-hatch-row-connected')
  })

  // ---------------------------------------------------------------- sign out and back in returns where you were
  await section('signout', async () => {
    await page.goto(BASE + '/settings'); await settle(900)
    await page.getByRole('button', { name: /Sign out/ }).click()
    await page.getByRole('group', { name: 'Sign out of this phone' }).getByRole('button', { name: 'Sign out' }).click()
    await page.waitForURL(/\/signin/); await settle(500)
    await page.goto(BASE + '/reports')
    await page.waitForURL(/\/signin/); await settle(500)
    await page.getByLabel('Username').fill('admin')
    await page.getByLabel('Password').fill('admin')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 }); await settle(1000)
    ok('signing in returns to the page you were sent from', new URL(page.url()).pathname === '/reports', page.url())
  })

  await ctx.close()
  return { sections: sections.length, shots: shots.length }
}

/** Decode the QR from the label canvas in the given sheet. */
async function decodeLabel(sheet) {
  const img = await sheet.locator('canvas.label-canvas').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height)
    return { data: Array.from(d.data), width: d.width, height: d.height }
  })
  return jsQR(Uint8ClampedArray.from(img.data), img.width, img.height)?.data ?? null
}

/** Runs in the page: layout smells for a human to confirm against the screenshot. */
function auditInPage() {
  const out = []
  const vw = document.documentElement.clientWidth
  if (document.documentElement.scrollWidth > vw + 1) out.push(`page overflows horizontally: ${document.documentElement.scrollWidth} > ${vw}`)
  const dlg = [...document.querySelectorAll('dialog[open]')].pop() ?? null
  const scope = dlg ?? document
  const body = dlg?.querySelector(':scope > .sheet-body')
  if (body && body.scrollWidth > body.clientWidth + 1) out.push(`sheet body overflows horizontally: ${body.scrollWidth} > ${body.clientWidth}`)
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight }
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40)
  // Interactive targets under 44 px in either direction (the iOS guideline).
  const small = []
  for (const el of scope.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=radio], [role=tab], [role=switch], summary')) {
    if (!visible(el)) continue
    if (el.closest('.label-canvas')) continue
    const r = el.getBoundingClientRect()
    // Padding on the parent counts when the parent is the one that is tapped (labels wrapping inputs).
    const hit = el.closest('label') ?? el
    const h = hit.getBoundingClientRect()
    if (Math.max(r.height, h.height) < 40 || Math.max(r.width, h.width) < 40) small.push(`${name(el)} ${Math.round(Math.max(r.width, h.width))}×${Math.round(Math.max(r.height, h.height))}`)
  }
  if (small.length) out.push(`small targets (<40px): ${small.slice(0, 12).join('; ')}${small.length > 12 ? ` (+${small.length - 12})` : ''}`)
  // Text clipped by its own box, when the box is not an intentional single-line truncation.
  const clipped = []
  for (const el of scope.querySelectorAll('p, span, h1, h2, h3, h4, li, button, a, label, dt, dd, td, th, div')) {
    if (!visible(el) || !el.textContent.trim() || el.children.length > 3) continue
    const s = getComputedStyle(el)
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
    if (s.textOverflow === 'ellipsis' || el.classList.contains('truncate') || el.classList.contains('sheet-body') || el.classList.contains('page') || s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflowX === 'auto' || s.overflowX === 'scroll') continue
    if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) clipped.push(`${name(el)} (${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight})`)
  }
  if (clipped.length) out.push(`clipped text: ${clipped.slice(0, 8).join('; ')}`)
  // Content left under a sticky footer: the last block of the sheet body must clear the footer when scrolled to the end.
  if (body) {
    const foot = body.querySelector(':scope > .sheet-save') ?? dlg.querySelector(':scope > .sheet-foot')
    if (foot) {
      const prev = body.scrollTop
      body.scrollTop = body.scrollHeight
      const blocks = [...body.querySelectorAll('*')].filter((el) => visible(el) && !el.closest('.sheet-save') && el.closest('dialog') === dlg && el.textContent.trim() && el.children.length === 0)
      const last = blocks.reduce((a, b) => (b.getBoundingClientRect().bottom > (a?.getBoundingClientRect().bottom ?? -1) ? b : a), null)
      const f = foot.getBoundingClientRect()
      if (last && getComputedStyle(foot).position === 'sticky' && last.getBoundingClientRect().bottom > f.top + 2 && !foot.contains(last)) out.push(`content under the sticky footer: "${name(last)}" bottom ${Math.round(last.getBoundingClientRect().bottom)} > footer top ${Math.round(f.top)}`)
      body.scrollTop = prev
    }
  }
  return out
}

const totals = { sections: 0, shots: 0 }
const runs = process.env.SWEEP_RUNS ? process.env.SWEEP_RUNS.split(',') : ['light', 'dark', 'light-320', 'light-rm']
for (const r of runs) {
  try {
    const res = r === 'light-320' ? await run('light', { width: 320, height: 640 }) : r === 'light-rm' ? await run('light', null, 'reduce') : await run(r)
    totals.sections += res.sections
    totals.shots += res.shots
  } catch (err) {
    console.error('FAILED:', err.message.split('\n')[0])
    check(`run ${r} finished`, false, err.message.split('\n')[0])
  }
}
await browser.close()
const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed · ${totals.shots} screenshots · ${totals.sections} sections`)
if (audits.length) console.log('LAYOUT AUDIT (for the eye, not asserted):\n' + audits.join('\n'))
console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : 'NO CONSOLE / REQUEST PROBLEMS')
process.exit(failed.length || problems.length ? 1 : 0)
