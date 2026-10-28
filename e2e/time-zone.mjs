/**
 * The household time zone (2026-10-25: a family's container ran in UTC, so "Last session 6:30 PM" came for a 2:30 PM
 * pump). An admin's phone records its zone the first time it opens the app; Settings › Notifications says which
 * zone the notification times are in; a phone in another zone can move it there; a phone never overwrites a zone
 * already set.
 *   node e2e/time-zone.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack (the companion's own zone is whatever the host runs, usually UTC).
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/time-zone'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const SCHEME = process.argv[4] === 'dark' ? 'dark' : 'light'
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this probe changes the companion's setup. Use the isolated stack from docs/DEVELOPMENT.md.`)
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })
let fails = 0
const problems = []
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} [${SCHEME}] ${name}${cond || detail === undefined ? '' : ` — ${detail}`}`)
  if (!cond) fails += 1
}
const squash = (t) => t.replace(/\s+/g, ' ').trim()
const DAY = 86_400_000

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
async function phone(timezoneId) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, colorScheme: SCHEME, timezoneId })
  await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml' } })) })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`console: ${m.text().slice(0, 300)}`) })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\/profile|\/login\//.test(r.url())) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`) })
  await page.goto(BASE + '/signin')
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill('admin')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
  await page.waitForTimeout(1200)
  if (page.url().includes('/onboarding')) {
    await page.getByLabel('First name').fill('Ada')
    await page.getByLabel('Birth date or due date').fill(new Date(Date.now() - 20 * DAY).toISOString().slice(0, 10))
    await page.getByRole('button', { name: 'Start tracking' }).click()
    await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
  }
  await page.waitForTimeout(1500)
  const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
  const config = async () => (await page.request.get(`${BASE}/bramble/config`, { headers: { Authorization: `Token ${token}` } })).json()
  const sheet = () => page.locator('dialog[open]').last()
  const openNotifications = async () => {
    await page.goto(BASE + '/settings')
    await page.waitForTimeout(1000)
    await page.getByRole('button', { name: /^Notifications/ }).click()
    await page.waitForTimeout(1000)
  }
  return { page, config, sheet, openNotifications }
}

const ny = await phone('America/New_York')
const first = await ny.config()
check('an admin phone in New York records the household zone on launch', first.timeZone?.value === 'America/New_York' && first.timeZone?.source === 'settings', JSON.stringify(first.timeZone))
await ny.openNotifications()
const line = ny.sheet().getByTestId('time-zone')
check('Settings › Notifications says which zone the times are in', /Times in notifications: New York \(E[DS]T\)/.test(squash(await line.innerText())), squash(await line.innerText()))
check('… and offers no change on a phone already in it', (await line.getByRole('button').count()) === 0)
await ny.page.screenshot({ path: `${OUT}/01-notifications-ny-${SCHEME}.png` })

const london = await phone('Europe/London')
const after = await london.config()
check('a second phone elsewhere does not overwrite the zone on launch', after.timeZone?.value === 'America/New_York', JSON.stringify(after.timeZone))
await london.openNotifications()
const lline = london.sheet().getByTestId('time-zone')
check('… it says this phone is somewhere else and offers to move it', /This phone is in London \(GMT\)/.test(squash(await lline.innerText())) && (await lline.getByRole('button', { name: 'Use this phone’s' }).count()) === 1, squash(await lline.innerText()))
await london.page.screenshot({ path: `${OUT}/02-notifications-london-${SCHEME}.png` })
await lline.getByRole('button', { name: 'Use this phone’s' }).click()
await london.page.waitForTimeout(1200)
check('… one tap moves the household there', (await london.config()).timeZone?.value === 'Europe/London' && /Times in notifications: London/.test(squash(await lline.innerText())), squash(await lline.innerText()))
check('nothing wider than the screen', await london.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
// Put it back for the next run on the same stack.
await london.page.request.put(`${BASE}/bramble/config`, { headers: { Authorization: `Token ${await london.page.evaluate(() => localStorage.getItem('bramble.token'))}`, 'Content-Type': 'application/json' }, data: { timeZone: null } })

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
