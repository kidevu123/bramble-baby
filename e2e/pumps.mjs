/**
 * Which pump: Settings › Pumps holds the household's pumps; the pumping sheet and the timer pick one (a
 * `pump:<name>` tag on the entry, the last session's pump preselected, the pump's usual length prefilled);
 * the timeline names it; Reports › Summary › Pump ranks the pumps.
 *   node e2e/pumps.mjs <out-dir> <base-url> [light|dark]
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/pumps'
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
const api = async (method, path, body) => {
  const r = await fetch(BB + path, { method, headers: { Authorization: `Token ${TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }
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
const shownMinutes = (text) => { const m = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); if (!m) return NaN; let h = Number(m[1]) % 12; if (m[3].toUpperCase() === 'PM') h += 12; return h * 60 + Number(m[2]) }
const times = async () => (await sheet().locator('.time-field-value').allInnerTexts()).map(shownMinutes)
const diff = (a, b) => ((b - a) % 1440 + 1440) % 1440

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
  await page.getByLabel('Birth date or due date').fill(new Date(Date.now() - 20 * DAY).toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
  await settle(1000)
}
const child = (await api('GET', '/api/children/')).body.results[0]
for (const p of (await api('GET', `/api/pumping/?child=${child.id}`)).body.results ?? []) await api('DELETE', `/api/pumping/${p.id}/`)

// ---- a new household starts with no pumps (no one else's list); then the household's four are set
await page.goto(BASE + '/settings')
await settle(800)
const pumpsRow = page.getByRole('button', { name: /^Pumps/ })
check('a new household starts with no pumps', /Add your pumps/.test(await pumpsRow.innerText()) && !/Eufy/.test(await pumpsRow.innerText()), await pumpsRow.innerText())
// ---- a household that pumped before 1.34 and got an empty list from its first-run rule (no pump tags back then)
// gets its four back, Medela included, on the next load (2026-10-21: "their Medela option went away")
const putSettings = (body) => fetch(`${BASE}/bramble/settings/${child.id}`, { method: 'PUT', headers: { Authorization: `Token ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const old = (await api('POST', '/api/pumping/', { child: child.id, start: '2026-10-10T09:00:00', end: '2026-10-10T09:20:00', amount: 60 })).body
await putSettings({ pumps: [], pumpsDecided: null })
await page.reload()
await settle(1500)
check('an upgraded household whose pumps vanished gets Eufy, Spectra, Medela, Ameda back', /Eufy, Spectra, Medela, Ameda/.test(await pumpsRow.innerText()), await pumpsRow.innerText())
const decided = await fetch(`${BASE}/bramble/settings/${child.id}`, { headers: { Authorization: `Token ${TOKEN}` } }).then((r) => r.json())
check('… decided once, so a list saved later is never touched again', decided.pumpsDecided === 2 && decided.pumps.length === 4, JSON.stringify(decided))
await api('DELETE', `/api/pumping/${old.id}/`)
await fetch(`${BASE}/bramble/settings/${child.id}`, { method: 'PUT', headers: { Authorization: `Token ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ pumps: [{ name: 'Eufy', minutes: 30 }, { name: 'Spectra', minutes: 20 }, { name: 'Medela', minutes: 20 }, { name: 'Ameda', minutes: 20 }] }) })

// ---- Settings › Pumps: the four, add one, save
await page.goto(BASE + '/settings')
await settle(800)
check('Settings has a Pumps row naming the household pumps', /Eufy, Spectra, Medela, Ameda/.test(await pumpsRow.innerText()), await pumpsRow.innerText())
await pumpsRow.click()
await settle(600)
check('the Pumps sheet lists four pumps with their usual minutes', (await sheet().locator('.pump-row').count()) === 4 && (await sheet().getByLabel('Pump 1 usual minutes').inputValue()) === '30')
await shot('settings-pumps')
await sheet().getByRole('button', { name: 'Add a pump' }).click()
await sheet().getByLabel('Pump 5 name').fill('Elvie')
await sheet().getByLabel('Pump 5 usual minutes').fill('25')
await sheet().getByRole('button', { name: 'Save pumps' }).click()
await settle(800)
check('the saved list shows on the row', /Elvie/.test(await pumpsRow.innerText()), await pumpsRow.innerText())
const saved = (await fetch(`${BASE}/bramble/settings/${child.id}`, { headers: { Authorization: `Token ${TOKEN}` } }).then((r) => r.json()).catch(() => null))
check('the pumps are a shared child setting on the companion', saved?.pumps?.length === 5 && saved.pumps[4].name === 'Elvie' && saved.pumps[4].minutes === 25, JSON.stringify(saved?.pumps))

// ---- the pumping sheet: pick a pump, the length follows, the tag is saved
await page.goto(BASE + '/')
await settle(1000)
await page.getByRole('button', { name: /^Pumping/ }).first().click()
await settle(900)
const pills = () => sheet().getByRole('radiogroup', { name: 'Pump' }).getByRole('radio')
check('the sheet offers the pumps as pills', (await pills().allInnerTexts()).join(',') === 'Eufy,Spectra,Medela,Ameda,Elvie', (await pills().allInnerTexts()).join(','))
// Scoped to the pumps: "Milk goes in" (Fridge, chosen by default) sits on the same sheet.
const chosenPump = () => sheet().getByRole('radiogroup', { name: 'Pump' }).getByRole('radio', { checked: true })
check('no pump is preselected before any session', (await chosenPump().count()) === 0)
await sheet().getByRole('radio', { name: 'Eufy' }).click()
await settle(300)
let t = await times()
check("picking the Eufy sets the session to its usual 30 min, finished now", diff(t[0], t[1]) === 30, `${t[0]} → ${t[1]}`)
check('…and says so', /Set to the Eufy's usual 30 min/.test(await sheet().innerText()))
await sheet().getByRole('radio', { name: 'Spectra' }).click()
await settle(300)
t = await times()
check('switching to the Spectra makes it 20 min', diff(t[0], t[1]) === 20, `${t[0]} → ${t[1]}`)
await shot('pumping-sheet-pump')
await sheet().getByLabel('Volume in mL').fill('60')
await sheet().getByRole('button', { name: 'Save', exact: true }).click()
await settle(1500)
let entries = (await api('GET', `/api/pumping/?child=${child.id}`)).body.results
check('the entry carries the pump as a tag beside the caregiver tag', entries.length === 1 && entries[0].tags.includes('pump:Spectra') && entries[0].tags.some((x) => x.startsWith('caregiver:')), JSON.stringify(entries[0]?.tags))
await settle(500)
const row = page.locator('.tl-row').first()
check('the timeline row names the pump', /Spectra/.test(await row.innerText()), await row.innerText())
await shot('home-timeline')

// ---- the next sheet opens on the last pump; editing shows the entry's own pump; re-tap clears it
await page.getByRole('button', { name: /^Pumping/ }).first().click()
await settle(900)
check('the next session opens on the last pump', (await chosenPump().innerText()) === 'Spectra')
await sheet().getByRole('radio', { name: 'Spectra' }).click()
await settle(200)
check('tapping the chosen pump again clears it', (await chosenPump().count()) === 0)
await sheet().getByRole('button', { name: 'Close' }).click()
await settle(500)
await row.click()
await settle(800)
check('editing shows the entry\'s pump', /Edit pumping/.test(await sheet().innerText()) && (await chosenPump().innerText()) === 'Spectra')
await sheet().getByRole('radio', { name: 'Medela' }).click()
await sheet().getByRole('button', { name: 'Save', exact: true }).click()
await settle(1500)
entries = (await api('GET', `/api/pumping/?child=${child.id}`)).body.results
check('changing the pump on an edit replaces the tag and keeps the rest', entries[0].tags.filter((x) => x.startsWith('pump:')).join() === 'pump:Medela' && entries[0].tags.some((x) => x.startsWith('caregiver:')), JSON.stringify(entries[0].tags))

// ---- Reports › Summary › Pump: ranked, with the per-minute leader and the caveats
const at = (daysAgo, hour, minutes) => { const s = new Date(Date.now() - daysAgo * DAY); s.setHours(hour, 0, 0, 0); return { start: s.toISOString(), end: new Date(s.getTime() + minutes * 60_000).toISOString() } }
const seed = [
  ['Eufy', 120, 30, 6, 1], ['Eufy', 110, 30, 7, 2], ['Eufy', 100, 30, 14, 3],
  ['Spectra', 100, 20, 12, 1], ['Spectra', 90, 20, 15, 2], ['Spectra', 95, 20, 18, 3],
  [null, 80, 20, 9, 4],
]
for (const [pump, amount, minutes, hour, daysAgo] of seed) {
  await api('POST', '/api/pumping/', { child: child.id, ...at(daysAgo, hour, minutes), amount, notes: '', tags: pump ? [`pump:${pump}`] : [] })
}
// The week before that: two sessions of 100 mL a day, outside the 7-day range of the cards below but read by the trend.
for (let daysAgo = 8; daysAgo <= 14; daysAgo += 1) for (const hour of [8, 14]) await api('POST', '/api/pumping/', { child: child.id, ...at(daysAgo, hour, 20), amount: 100, notes: '', tags: [] })
await page.goto(BASE + '/reports')
await settle(1000)
await page.getByRole('tab', { name: 'Summary' }).click()
await settle(600)
// Every category tab is as wide as its name (the row scrolls): before 1.30.2 they shrank and the names overlapped.
const squeezed = await page.$$eval('.cat-tab', (tabs) => tabs.filter((t) => t.scrollWidth > t.clientWidth + 1).map((t) => t.textContent))
check('no category tab is narrower than its name', squeezed.length === 0, squeezed.join(', '))
await page.getByRole('button', { name: 'Pumping', exact: true }).click()
await settle(900)
const compare = page.getByTestId('pump-compare')
// The explanations sit folded under each card ("About this chart"): closed at first, open to read them here.
check('each card keeps its explanations folded away until asked', (await page.locator('details.about').count()) >= 3 && (await page.locator('details.about[open]').count()) === 0)
await page.locator('details.about').evaluateAll((ds) => ds.forEach((d) => { d.open = true }))
await settle(200)
const text = (await compare.innerText()).replace(/\s+/g, ' ')
check('the comparison card is there', (await compare.count()) === 1)
const supply = page.getByTestId('supply-trend')
const supplyText = (await supply.innerText()).replace(/\s+/g, ' ')
// This week: 120+100 + 110+90 + 100+95 + 80 = 695 mL over the 4 logged days (today is left out); the week before: 200 mL a day.
check('the supply trend reads the last full week against the one before, with the sessions a day', /Last 7 days 174 mL a day · 1\.8 sessions a day · 4 of 7 days logged The 7 before 200 mL a day · 2 sessions a day Down/.test(supplyText) && /Down 13% on the week before: 174 mL a day from 200 mL\. About as many sessions a day \(1\.8\), so each one gives less\./.test(supplyText), supplyText)
await supply.scrollIntoViewIfNeeded()
await settle(300)
await page.screenshot({ path: `${OUT}/supply-trend-${SCHEME}.png` })
check('the daily pumping bars carry a labelled average line', (await page.locator('.bars-avg').count()) >= 1 && /avg \d+/.test(await page.locator('.bars-avg-label').first().textContent()) && /dashed line is the average on full days with pumping/.test((await page.locator('.card', { hasText: 'Volume / day' }).innerText()).replace(/\s+/g, ' ')))
// every session: 120+110+100 + 100+90+95 + 60 (Medela) + 80 (no pump) = 755 over 8 → 94 mL
check('the comparison carries a dashed line at the average over every session', (await compare.locator('.pc-avg').count()) === 1 && /All sessions avg 94 mL/.test(await compare.locator('.pc-avg-label').textContent()) && /untagged ones included/.test(text), await compare.locator('.pc-avg-label').textContent())
const bars = () => compare.locator('.pc-bar').evaluateAll((els) => els.map((e) => e.dataset.pump))
const barOf = (name) => compare.locator(`.pc-bar[data-pump="${name}"]`)
check('one bar per pump, most per session first', (await bars()).join() === 'Eufy,Spectra,Medela', (await bars()).join())
check('each bar carries its average and its session count', /110 mL/.test(await barOf('Eufy').textContent()) && /3 sessions/.test(await barOf('Eufy').textContent()) && /95 mL/.test(await barOf('Spectra').textContent()) && /60 mL/.test(await barOf('Medela').textContent()) && /1 session$/.test((await barOf('Medela').textContent()).trim()))
check('the best bar is the full-colour one', (await barOf('Eufy').getAttribute('class')).includes('best') && !(await barOf('Spectra').getAttribute('class')).includes('best'))
check('the thin pump is called out, the morning slots are named, no verdict paragraph', /Fewer than 3 sessions on Medela/.test(text) && /Spectra: none before 10 AM/.test(text) && !/gives the most per session/.test(text), text)
check('the sessions without a pump are counted with a way to tag them', /1 session without a pump recorded/.test(text) && (await compare.getByRole('button', { name: 'Tag them' }).count()) === 1, text)
await compare.getByRole('tab', { name: 'mL per minute' }).click()
await settle(300)
check('per minute re-ranks the bars: the Spectra leads', (await bars())[0] === 'Spectra' && /4\.8/.test(await barOf('Spectra').textContent()) && /3\.7/.test(await barOf('Eufy').textContent()), (await bars()).join())
await compare.getByRole('tab', { name: 'mL per session' }).click()
await settle(200)
await shot('reports-pumps')

// ---- tag the session without a pump from the card
await compare.getByRole('button', { name: 'Tag them' }).click()
await settle(600)
check('the tagging sheet lists the untagged session with its volume and the pumps as pills', (await sheet().locator('.tag-row').count()) === 1 && /80 mL/.test(await sheet().locator('.tag-row').innerText()) && (await sheet().getByRole('radio', { name: 'Spectra' }).count()) === 1)
await shot('tag-pumps')
await sheet().getByRole('radio', { name: 'Spectra' }).click()
await settle(1500)
entries = (await api('GET', `/api/pumping/?child=${child.id}`)).body.results
const was80 = entries.find((e) => e.amount === 80)
check('the tap writes the pump tag onto that entry', was80.tags.includes('pump:Spectra'), JSON.stringify(was80.tags))
check('the sheet says every session names its pump now', /Every session in this range names its pump/.test(await sheet().innerText()))
await sheet().getByRole('button', { name: 'Close' }).click()
await settle(800)
check('the comparison counts it: the Spectra has 4 sessions and the untagged line is gone', /4 sessions/.test(await barOf('Spectra').textContent()) && !/without a pump recorded/.test(await compare.innerText()), (await compare.innerText()).replace(/\s+/g, ' '))

// ---- the timer: pick the pump before Stop
await page.goto(BASE + '/')
await settle(800)
await page.getByRole('button', { name: /^Pumping/ }).first().click()
await settle(800)
await sheet().getByRole('button', { name: 'Start pumping timer' }).click()
await page.waitForURL(/\/timer\//, { timeout: 15000 })
await settle(1200)
check('the timer offers the pumps and preselects the last one', (await page.getByRole('radiogroup', { name: 'Pump' }).getByRole('radio', { checked: true }).innerText()) === 'Medela')
await page.getByRole('radio', { name: 'Ameda' }).click()
await page.getByLabel('Volume in mL').fill('40')
await shot('timer-pump')
await page.getByRole('button', { name: 'Stop and save' }).click()
await settle(2000)
entries = (await api('GET', `/api/pumping/?child=${child.id}`)).body.results
const fromTimer = entries.find((e) => e.amount === 40)
check('the timer\'s entry carries the pump tag', Boolean(fromTimer) && fromTimer.tags.includes('pump:Ameda'), JSON.stringify(fromTimer?.tags))

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
