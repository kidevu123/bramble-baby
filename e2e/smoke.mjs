import { chromium, devices } from 'playwright'
const OUT = process.argv[2]
const BASE = process.argv[3] ?? 'http://localhost:5173'
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'light' })
const page = await ctx.newPage()
const problems = []
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 300)) })
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/profile') && !r.url().includes('/bramble/')) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`) })
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` })
const settle = (ms = 700) => page.waitForTimeout(ms)
process.on('uncaughtException', async (err) => {
  console.error('FAILED:', err.message.split('\n')[0])
  try { await page.screenshot({ path: `${OUT}/ZZ-failure.png` }) } catch {}
  console.log('PROBLEMS:\n' + [...new Set(problems)].join('\n'))
  console.log('URL:', page.url())
  await browser.close()
  process.exit(1)
})
const tile = (name) => page.locator(`.tile-${name} .tile-main`)
const inDialog = () => page.locator('dialog[open]')
// The open sheet's own Close (a nested, closed sheet inside it has a Close button too).
const closeSheet = () => page.locator('dialog[open] > .sheet-head').last().getByLabel('Close').click()
const save = async () => { await inDialog().getByRole('button', { name: 'Save', exact: true }).click(); await settle(1200) }

await page.goto(BASE + '/')
await page.waitForURL(/\/signin/)
await shot('01-login')
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle()
// Reset test data from previous runs so the flow always starts at onboarding.
{
  const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
  const headers = { Authorization: `Token ${token}` }
  const kids = await (await page.request.get(BASE + '/api/children/', { headers })).json()
  for (const c of kids.results ?? []) if (['Oscar', 'Bump'].includes(c.first_name)) await page.request.delete(`${BASE}/api/children/${c.slug}/`, { headers })
  const timers = await (await page.request.get(BASE + '/api/timers/', { headers })).json()
  for (const t of timers.results ?? []) await page.request.delete(`${BASE}/api/timers/${t.id}/`, { headers })
  await page.goto(BASE + '/')
  await settle(1200)
}
if (page.url().includes('/onboarding')) {
  await shot('02-onboarding')
  await page.getByLabel('First name').fill('Oscar')
  const bd = new Date(); bd.setMonth(bd.getMonth() - 4)
  await page.getByLabel('Birth date or due date').fill(bd.toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
}
await settle(1500)
await shot('03-home-empty')

// Sleep (manual)
await tile('sleep').click(); await settle(); await shot('04-sheet-sleep'); await save()
// Nursing timer buttons visible
await tile('nursing').click(); await settle(); await shot('05-sheet-nursing'); await closeSheet(); await settle()
// Bottle with slider
await tile('bottle').click(); await settle()
await page.getByRole('spinbutton', { name: /Amount in/ }).fill('4'); await shot('06-sheet-bottle'); await save()
// Solids picture grid
await tile('solids').click(); await settle()
await page.getByRole('button', { name: /avocado/ }).click(); await page.getByRole('button', { name: /banana/ }).click()
await shot('07-solids-grid')
await page.getByRole('button', { name: 'Next' }).click(); await settle()
await page.getByRole('radio', { name: 'Loved it' }).click(); await page.getByRole('radio', { name: 'Most' }).click()
await shot('08-solids-details'); await save()
// Diaper
await tile('diaper').click(); await settle()
await page.getByRole('radio', { name: 'Poo' }).click(); await page.getByRole('radio', { name: 'Medium' }).click(); await page.getByRole('radio', { name: 'Brown' }).click()
await shot('09-sheet-diaper'); await save()
// Potty
await tile('potty').click(); await settle(); await page.getByRole('radio', { name: 'Pee' }).click(); await shot('10-sheet-potty'); await save()
// Activity
await tile('activity').click(); await settle(); await page.getByRole('radio', { name: 'Bath' }).click(); await shot('11-sheet-activity'); await save()
// Milestone
await tile('milestones').click(); await settle(); await page.locator('.milestone-chip').first().click(); await shot('12-sheet-milestone'); await save()
// Medicine
await tile('medicine').click(); await settle(); await page.getByLabel('Name').fill('Vitamin D'); await page.getByLabel('Dose', { exact: true }).fill('1'); await page.getByRole('radio', { name: 'drops' }).click(); await save()
// Growth (weight) for percentiles
await tile('growth').click(); await settle(); await page.getByRole('spinbutton', { name: 'Pounds' }).fill('14'); await page.getByRole('spinbutton', { name: 'Ounces' }).fill('8'); await save()
// Reminder sheet
await page.locator('.tile-bottle .tile-alarm').click(); await settle(); await shot('13-reminder'); await closeSheet(); await settle()
await shot('14-home-with-data')

// Sleep timer via sheet
await tile('sleep').click(); await settle(); await page.getByRole('button', { name: /Start sleep timer/ }).click()
await page.waitForURL(/\/timer\//, { timeout: 15000 }); await settle(2000); await shot('15-timer-sleep')
await page.getByRole('button', { name: 'Stop and save' }).click(); await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 }); await settle(1000)

// Customize
await page.getByRole('button', { name: 'Customize home' }).click(); await settle(); await shot('16-customize'); await inDialog().getByRole('button', { name: 'Save' }).click(); await settle()

// Reports
await page.getByRole('link', { name: 'Reports' }).click(); await settle(1500); await shot('17-reports-day')
await page.getByRole('tab', { name: 'Week' }).click(); await settle(); await shot('18-reports-week')
await page.getByRole('tab', { name: 'List' }).click(); await settle(); await shot('19-reports-list')
await page.getByRole('tab', { name: 'Summary' }).click(); await settle(); await shot('20-reports-summary')
await page.getByRole('button', { name: 'Solids', exact: true }).click(); await settle(); await shot('21-reports-solids')
await page.getByRole('button', { name: 'Reports settings' }).click(); await settle(); await shot('22-reports-settings'); await inDialog().getByRole('button', { name: 'Apply' }).click(); await settle()

// Sleep plans
await page.getByRole('link', { name: 'Sleep Plans' }).click(); await settle(1000); await shot('23-plans-questionnaire')
for (const opt of ['Crib in own room', 'Fed to sleep', '1–2', 'Feed', 'Short naps', 'Yes', 'Longer naps', 'Gentle']) {
  const b = page.getByRole('radio', { name: new RegExp(opt, 'i') }).first()
  if (await b.count()) await b.click()
}
await page.getByRole('button', { name: 'Build my plan' }).click(); await settle(1000); await shot('24-plan')

// Insights
await page.getByRole('button', { name: 'Insights' }).click(); await settle(1000); await shot('25-insights')
await page.getByRole('button', { name: 'The science' }).click(); await settle(800); await shot('26a-science')
await page.getByRole('button', { name: 'Miniplans' }).click(); await settle(); await shot('26-miniplans')

// Child
await page.getByRole('link', { name: 'Child' }).click(); await settle(1000); await page.getByRole('radio', { name: 'Boy' }).click(); await settle(600); await shot('27-child')
await page.getByRole('button', { name: /Nap window settings/ }).click(); await settle(); await shot('28-sweetspot-settings'); await inDialog().getByRole('button', { name: 'Done' }).click(); await settle()
await page.getByRole('button', { name: /Schedule Creator/ }).click(); await settle(); await shot('29-schedule'); await inDialog().getByRole('button', { name: 'Done' }).click(); await settle()

// Settings + dark
await page.goto(BASE + '/settings'); await settle(1000); await shot('30-settings')
// Appearance is one round header button: Auto -> Light -> Dark -> Auto.
await page.getByRole('button', { name: /^Appearance: Auto/ }).click(); await settle(300)
await page.getByRole('button', { name: /^Appearance: Light/ }).click(); await settle()
await page.getByRole('link', { name: 'Home' }).click(); await settle(1200); await shot('31-home-dark')
await page.goto(BASE + '/settings'); await settle(); await page.getByRole('button', { name: /^Appearance: Dark/ }).click(); await settle()

// Expecting mode: add a second child with a due date
await page.goto(BASE + '/child'); await settle(1000)
await page.getByRole('button', { name: /Add another child/ }).click(); await settle()
await page.getByLabel('First name').fill('Bump')
const due = new Date(); due.setDate(due.getDate() + 26)
await page.getByLabel('Birth date or due date').fill(due.toISOString().slice(0, 10))
await inDialog().getByRole('button', { name: 'Save' }).click(); await settle(1500)
await page.goto(BASE + '/'); await settle(1500); await shot('32-home-expecting')
await page.locator('.tile-contractions .tile-main').click(); await page.waitForURL(/\/contractions/); await settle(800)
await page.getByRole('button', { name: 'Start contraction' }).click(); await settle(2500)
await page.getByRole('button', { name: 'Stop contraction' }).click(); await settle(1200); await shot('33-contractions')

await page.setViewportSize({ width: 1440, height: 900 })
await page.goto(BASE + '/'); await settle(1500); await shot('34-home-desktop')

await browser.close()
console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : 'NO PROBLEMS')
