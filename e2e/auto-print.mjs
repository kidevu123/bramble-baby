/**
 * "Save prints the sticker": with a printer on the Bramble server (the file:// backend here), saving a new
 * pumping entry with a volume registers its bag and prints the label with no label sheet, and the
 * PrintNotice bar says so; the entry's label sheet then reprints the same bag (no second one); the
 * stopped pumping timer does the same instead of opening the label sheet; and the switch in Settings ›
 * Milk labels & printer turns it off. Runs against the isolated stack from the README at iPhone width.
 *
 * It empties the child's stash and pumping entries first, so it only runs against localhost.
 * Usage: node e2e/auto-print.mjs <out-dir> [base-url=http://localhost:5173] [label-dir]
 */
import { mkdirSync, readdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/auto-print'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const LABEL_DIR = process.argv[4] ?? null
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this probe deletes stash bags and pumping entries. Use the isolated stack from the README.`)
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })
let failed = 0
const problems = []
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const pad = (n) => String(n).padStart(2, '0')
/** datetime-local value for a moment, in the browser's local time (the probe and the browser share a clock). */
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const DAY = 86_400_000

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const ctx = await browser.newContext({ ...devices['iPhone 14'] })
await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml' } })) })
const page = await ctx.newPage()
// The 503 is the failure this probe provokes on purpose; the browser logs it as a resource error.
page.on('console', (m) => { if (m.type() === 'error' && !/status of 503/.test(m.text())) problems.push(`console: ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/profile') && !r.url().includes('/print/label')) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`) })
const settle = (ms = 600) => page.waitForTimeout(ms)
let n = 0
const shot = async (name) => { n += 1; await page.screenshot({ path: `${OUT}/${pad(n)}-${name}.png` }) }
const sheet = () => page.locator('dialog[open]').last()
const notice = () => page.getByTestId('print-notice')

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
const stash = async () => (await api('GET', `/bramble/milk?child=${child.id}`)).body
for (const bag of await stash()) await api('DELETE', `/bramble/milk/${bag.id}`)
for (const p of (await api('GET', `/api/pumping/?child=${child.id}`)).body.results ?? []) await api('DELETE', `/api/pumping/${p.id}/`)
// The household's pumps (a new household starts with none; Settings › Pumps sets them).
await api('PUT', `/bramble/settings/${child.id}`, { pumps: [{ name: 'Eufy', minutes: 30 }, { name: 'Spectra', minutes: 20 }, { name: 'Medela', minutes: 20 }, { name: 'Ameda', minutes: 20 }] })
for (const t of (await api('GET', '/api/timers/')).body.results ?? []) await api('DELETE', `/api/timers/${t.id}/`)
const printer = (await api('GET', '/bramble/print/status')).body
ok('companion has a printer configured (file backend for this probe)', printer.configured === true, JSON.stringify(printer))
const labelFiles = () => (LABEL_DIR ? readdirSync(LABEL_DIR).length : null)
const filesBefore = labelFiles()
const posts = []
page.on('request', (r) => { if (r.url().includes('/bramble/print/label') && r.method() === 'POST') posts.push(r.postDataJSON()) })

// ---- the pumping sheet: type the volume, Save, the sticker prints
await page.goto(BASE + '/')
await settle(1200)
await page.locator('.tile-pumping .tile-main').click()
await settle(700)
const launch = sheet().locator('.sheet-save') // the footer: the Label button and, when Save prints, the line saying so
await sheet().getByLabel('Volume in mL').fill('60')
await settle(200)
ok('the milk goes in the fridge unless someone picks otherwise', (await sheet().getByRole('radio', { name: 'Fridge' }).getAttribute('aria-checked')) === 'true' && (await sheet().getByTestId('place-note').count()) === 0)
ok('with a volume typed the sheet says the label prints by itself on save', /Prints by itself when you save/.test(await launch.innerText()), (await launch.innerText()).replace(/\s+/g, ' '))
await shot('pumping-sheet-prints-on-save')
await sheet().getByRole('button', { name: 'Save', exact: true }).click()
await notice().waitFor({ timeout: 8000 })
await settle(300)
await shot('notice-sending-or-sent')
ok('the sheet closed on save', (await page.locator('dialog[open]').count()) === 0)
await page.waitForFunction(() => /Label sent to the printer/.test(document.querySelector('[data-testid="print-notice"]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {})
const text1 = (await notice().innerText()).replace(/\s+/g, ' ')
ok('the notice says the label was sent, with the volume and the bag code', /Label sent to the printer · 60 mL · ID [A-Z0-9]{6}/.test(text1), text1)
await shot('notice-sent')
const bags1 = await stash()
ok('one bag registered from the save, linked to the pumping entry, in the fridge', bags1.length === 1 && bags1[0].pumping_id !== null && bags1[0].volume_ml === 60 && bags1[0].location === 'fridge', JSON.stringify(bags1.map((b) => [b.code, b.volume_ml, b.pumping_id])))
ok('one print job, carrying that bag code', posts.length === 1 && posts[0].code === bags1[0]?.code && typeof posts[0].png === 'string' && posts[0].png.length > 1000, `${posts.length} jobs, code ${posts[0]?.code}`)
if (filesBefore !== null) ok('the label file reached the printer backend', labelFiles() === filesBefore + 1, `${labelFiles()} files`)
await page.waitForFunction(() => !document.querySelector('[data-testid="print-notice"]'), null, { timeout: 12000 }).catch(() => {})
ok('good news leaves by itself', (await notice().count()) === 0)

// ---- the entry's own label sheet reprints the same bag
await page.locator('.tl-row', { hasText: 'Pumping' }).first().click()
await settle(700)
ok('editing the entry does not promise a print', !/Prints by itself/.test(await sheet().locator('.sheet-save').innerText()))
await sheet().getByRole('button', { name: /Print milk label/ }).click()
await sheet().locator('.stash-card .strong').first().waitFor()
await settle(800)
const bagLine = (await sheet().locator('.stash-card').first().innerText()).replace(/\s+/g, ' ')
ok('the label sheet found the same bag (no second one)', bagLine.includes(`Bag ${bags1[0].code}`) && (await stash()).length === 1, bagLine.slice(0, 60))
ok('Print label is there for a reprint', (await sheet().getByRole('button', { name: 'Print label' }).count()) === 1)
await shot('reprint-same-bag')
await sheet().locator('.sheet-head').first().getByLabel('Close').click()
await settle(300)
await sheet().locator('.sheet-head').first().getByLabel('Close').click()
await settle(400)

// ---- the pumping timer: stop prints, Home opens without the label sheet
await page.locator('.tile-pumping .tile-main').click()
await settle(600)
await sheet().getByRole('button', { name: /Start pumping timer/ }).click()
await page.waitForURL(/\/timer\//, { timeout: 10000 })
await settle(800)
// Everything a pumping session needs is on screen without scrolling at iPhone 14 size in the Home Screen app
// (390 × 764 once the status bar and home indicator are taken off): the clock, Stop, the volume, the pump and
// where the milk goes. The owner never saw a row that sat under the fold.
{
  const before = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 764 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await settle(400)
  const parts = {
    clock: page.locator('.timer-clock'),
    Stop: page.getByRole('button', { name: 'Stop and save' }),
    volume: page.getByLabel('Volume in mL'),
    'pump pills': page.getByRole('radiogroup', { name: 'Pump' }),
    'place pills': page.getByRole('radiogroup', { name: 'Milk goes in' }),
  }
  const off = []
  for (const [name, loc] of Object.entries(parts)) {
    const box = await loc.boundingBox()
    if (!box || box.y < 0 || box.y + box.height > 764 || box.x < 0 || box.x + box.width > 390) off.push(`${name} ${box ? `${Math.round(box.y)}–${Math.round(box.y + box.height)}` : 'missing'}`)
  }
  const scrolled = await page.evaluate(() => window.scrollY)
  ok('timer at 390 × 764: clock, Stop, volume, pump and place all on screen unscrolled', off.length === 0 && scrolled === 0, off.join(', '))
  ok('Stop says it waits for the volume', /Volume first/.test(await parts.Stop.innerText()) && (await parts.Stop.isDisabled()))
  await shot('timer-390x764')
  await page.setViewportSize(before)
  await settle(300)
}
await page.getByLabel('Volume in mL').fill('45')
ok('with a volume Stop is ready and no longer says it waits', !(await page.getByRole('button', { name: 'Stop and save' }).isDisabled()) && !/Volume first/.test(await page.getByRole('button', { name: 'Stop and save' }).innerText()))
// Kept out for the next bottle: the timer says when it has to be in the fridge and when the reminder comes.
await page.getByRole('radio', { name: 'Room temp' }).click()
await settle(200)
const placeText = await page.getByTestId('place-note').innerText()
ok('kept out: the timer names the fridge deadline and the reminder', /^Fridge it or feed it by \d{1,2}:\d{2} [AP]M\. Bramble reminds you at \d{1,2}:\d{2} [AP]M\.$/.test(placeText), placeText)
await shot('timer-kept-out')
await page.getByRole('button', { name: 'Stop and save' }).click()
await page.waitForURL((u) => u.pathname === '/', { timeout: 10000 })
await notice().waitFor({ timeout: 8000 })
await settle(300)
ok('the timer stop did not open the label sheet', (await page.locator('dialog[open]').count()) === 0)
await page.waitForFunction(() => /Label sent to the printer/.test(document.querySelector('[data-testid="print-notice"]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {})
const text2 = (await notice().innerText()).replace(/\s+/g, ' ')
ok('the timer\'s label was sent too', /Label sent to the printer · 45 mL · ID [A-Z0-9]{6}/.test(text2), text2)
await shot('timer-stop-printed')
const bags2 = await stash()
const outBag = bags2.find((b) => b.volume_ml === 45)
ok('two bags now, both from saves; the timer\'s is at room temperature', bags2.length === 2 && posts.length === 2 && outBag?.location === 'room', JSON.stringify(bags2.map((b) => [b.volume_ml, b.location])))
const outRems = ((await api('GET', `/bramble/reminders?child=${child.id}`)).body ?? []).filter((r) => r.tag === `milk:${outBag?.id}`).map((r) => r.title)
ok('the bag kept out gets a fridge-by reminder, then the too-long one', outRems.length === 2 && /^Fridge the milk by /.test(outRems[0]) && /^Milk out too long/.test(outRems[1]), JSON.stringify(outRems))
await page.waitForFunction(() => !document.querySelector('[data-testid="print-notice"]'), null, { timeout: 12000 }).catch(() => {})

// ---- a failed print says so and stays
await page.route('**/bramble/print/label', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Could not reach the printer: it is off.' }) }))
await page.locator('.tile-pumping .tile-main').click()
await settle(600)
await sheet().getByRole('button', { name: '1 h ago' }).click()
await sheet().getByLabel('Volume in mL').fill('30')
await sheet().getByRole('button', { name: 'Save', exact: true }).click()
await notice().waitFor({ timeout: 8000 })
await page.waitForFunction(() => /Could not print/.test(document.querySelector('[data-testid="print-notice"]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {})
const text3 = (await notice().innerText()).replace(/\s+/g, ' ')
ok('a failed print is named in the server\'s words and says the entry is saved', /Could not print the label for 30 mL/.test(text3) && /it is off/.test(text3) && /entry is saved/.test(text3), text3)
await shot('notice-failed')
await settle(8000)
ok('a failure stays until dismissed', (await notice().count()) === 1)
await notice().getByRole('button', { name: 'Dismiss' }).click()
await settle(300)
ok('Dismiss clears it', (await notice().count()) === 0)
ok('the bag still registered even though the print failed', (await stash()).length === 3)
await page.unroute('**/bramble/print/label')

// ---- the switch in Settings turns it off
await page.getByRole('button', { name: 'Settings' }).click()
await settle(900)
const labelsRow = page.locator('.settings-row', { hasText: 'Milk labels' })
ok('the Settings row says the sticker prints on save', /prints on save/.test(await labelsRow.innerText()), (await labelsRow.innerText()).replace(/\s+/g, ' '))
await labelsRow.click()
await settle(700)
const toggle = sheet().getByRole('switch', { name: 'Print when a pumping is saved' })
ok('Settings › Milk labels & printer has the switch, on', (await toggle.count()) === 1 && (await toggle.getAttribute('aria-checked')) === 'true')
await shot('settings-switch')
await toggle.click()
await settle(300)
await sheet().locator('.sheet-head').first().getByLabel('Close').click()
await settle(300)
ok('with the switch off the row no longer says it prints on save', !/prints on save/.test(await labelsRow.innerText()), (await labelsRow.innerText()).replace(/\s+/g, ' '))
await page.getByRole('button', { name: 'Back' }).click()
await settle(900)
await page.locator('.tile-pumping .tile-main').click()
await settle(600)
ok('with the switch off the sheet no longer promises a print', !/Prints by itself/.test(await sheet().locator('.sheet-save').innerText()))
await sheet().getByLabel('Started:').fill(localInput(new Date(Date.now() - 4 * 3600_000)))
await sheet().getByLabel('Finished:').fill(localInput(new Date(Date.now() - 3.75 * 3600_000)))
await sheet().getByLabel('Volume in mL').fill('50')
await sheet().getByRole('button', { name: 'Save', exact: true }).click()
await settle(2500)
ok('off: no notice, no new bag, no print', (await notice().count()) === 0 && (await stash()).length === 3 && posts.length === 3)
await shot('switch-off-no-print')

await browser.close()
for (const p of problems) console.log(`problem: ${p}`)
console.log(`${failed} failures, ${problems.length} problems; screenshots in ${OUT}`)
process.exit(failed || problems.length ? 1 : 0)
