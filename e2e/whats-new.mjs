/**
 * Probe for What's new: a phone that signs in fresh starts from this build (no card, even after a reload); a phone
 * that last saw an older release gets the card with the releases since (at most six), the child's name filled in, and Got it
 * keeps it away; a phone signed in before the card existed (no record) gets the last four; Settings › What's new
 * shows every release again.
 *
 * Usage: node e2e/whats-new.mjs <out-dir> <light|dark> <base-url>   (against any stack: the mock accepts admin/admin)
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/whats-new'
const SCHEME = process.argv[3] === 'dark' ? 'dark' : 'light'
const BASE = process.argv[4] ?? 'http://localhost:5173'
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
// The release list as written (newest first), so the probe follows each new release without edits.
const RELEASES = [...readFileSync(new URL('../src/lib/whats-new.ts', import.meta.url), 'utf8').matchAll(/version: '([\d.]+)'/g)].map((m) => m[1])
const SEEN = RELEASES[3]
const dir = `${OUT}/${SCHEME}`
mkdirSync(dir, { recursive: true })
let fails = 0
const problems = []
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${SCHEME}] ${name}${ok || detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) fails += 1
}
let n = 0

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, colorScheme: SCHEME })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`console: ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
const settle = (ms = 700) => page.waitForTimeout(ms)
const shot = async (name) => { n += 1; await page.screenshot({ path: `${dir}/${String(n).padStart(2, '0')}-${name}.png` }) }
const card = page.locator('dialog[open] [data-testid="whats-new"]')
const seen = () => page.evaluate(() => localStorage.getItem('bramble.whats-new-seen'))
const versions = async () => (await card.locator('.wn-version').allTextContents()).map((t) => t.replace(/[·\s]/g, ''))

// A phone signing in for the first time: no history, now or after a reload.
await page.goto(BASE + '/signin')
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1500)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Birth date or due date').fill(new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
  await settle(1000)
}
check('a phone signing in fresh starts from this build: no card', (await card.count()) === 0 && (await seen()) === VERSION, String(await seen()))
await page.reload()
await settle(1500)
check('… and none after a reload', (await card.count()) === 0)

const name = await page.evaluate(async () => {
  const r = await fetch('/api/children/', { headers: { Authorization: `Token ${localStorage.getItem('bramble.token')}` } })
  return (await r.json()).results[0].first_name
})

// A phone that last saw the release three before this one: the three since, newest first.
await page.evaluate((v) => localStorage.setItem('bramble.whats-new-seen', v), SEEN)
await page.reload()
await settle(1500)
const after = await versions()
check(`a phone that last saw ${SEEN} gets What's new with the releases since, newest first`, (await card.count()) === 1 && JSON.stringify(after) === JSON.stringify(RELEASES.slice(0, 3)) && after[0] === VERSION, JSON.stringify(after))
const text = await card.innerText()
check("… the child's name is filled in, never a placeholder", text.includes(name) && !text.includes('{name}'), text.slice(0, 300))
check('… nothing wider than the screen', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
await shot('card')
await page.getByRole('button', { name: 'Got it' }).click()
await settle(500)
check('Got it closes it and records this build', (await card.count()) === 0 && (await seen()) === VERSION)
await page.reload()
await settle(1500)
check('… so it does not come back', (await card.count()) === 0)

// Signed in before the card existed (no record): the last four.
await page.evaluate(() => localStorage.removeItem('bramble.whats-new-seen'))
await page.reload()
await settle(1500)
check('a phone signed in before the card existed gets the last four', (await versions()).length === 4 && (await versions())[0] === VERSION, JSON.stringify(await versions()))
await page.getByRole('button', { name: 'Close' }).click()
await settle(500)
check('… the X closes it too and records this build', (await card.count()) === 0 && (await seen()) === VERSION)

// Settings › What's new: every release again.
await page.goto(BASE + '/settings')
await settle(1200)
const link = page.getByRole('button', { name: `What’s new in ${VERSION}` })
check("Settings has What's new under the list, a 44 px target", (await link.count()) === 1 && (await link.evaluate((b) => b.getBoundingClientRect().height)) >= 44)
await link.click()
await settle(600)
const all = await versions()
check('… it lists every release up to this one', all[0] === VERSION && all.length >= 6, JSON.stringify(all))
await shot('settings')

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${dir}`)
process.exit(fails || problems.length ? 1 : 0)
