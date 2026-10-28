/**
 * A household sets up its own Bramble from the app, nothing on the server: the printer (Settings › Milk labels &
 * printer: a Zebra on the network, then a test label, then None), and the push contact (Settings › Notifications).
 * The mock admin is Baby Buddy staff, so both forms show; the stack's host printer (BRAMBLE_PRINTER=file://…) is
 * the fallback this starts from.
 *   [LABELS=<file-printer dir>] node e2e/household-setup.mjs <out-dir> <base-url> [light|dark]
 */
import { mkdirSync, readdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/household-setup'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const SCHEME = process.argv[4] === 'dark' ? 'dark' : 'light'
const LABELS = process.env.LABELS ?? null
const TOKEN = 'mocktoken0000000000000000000000000000000'
const DAY = 86_400_000
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this probe changes the server's printer. Use the isolated stack from the README.`)
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })

let fails = 0
const problems = []
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || detail === undefined ? '' : ` — ${detail}`}`)
  if (!cond) fails += 1
}
const squash = (t) => t.replace(/\s+/g, ' ').trim()
const headers = { Authorization: `Token ${TOKEN}`, 'Content-Type': 'application/json' }
const companion = async (method, path, body) => {
  const r = await fetch(`${BASE}/bramble${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json().catch(() => null) }
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
const shot = async (name) => { n += 1; await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}-${SCHEME}.png`, fullPage: false }) }
const sheet = () => page.locator('dialog[open]').last()

await page.goto(BASE + '/')
await page.waitForURL(/\/signin/)
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1200)
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Noor')
  await page.getByLabel('Birth date or due date').fill(new Date(Date.now() - 20 * DAY).toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
  await settle(1000)
}
await companion('PUT', '/config', { printer: null, pushContact: null })

// ---- the printer: set from the app
await page.goto(BASE + '/settings')
await settle(1000)
await page.getByRole('button', { name: /Milk labels/ }).click()
await settle(1000)
const setup = sheet().getByTestId('printer-setup')
check('the printer card says where its printer is set (the host here)', /Set on the server \(BRAMBLE_PRINTER\)/.test(await setup.innerText()), squash(await setup.innerText()))
await setup.getByRole('button', { name: 'Change printer' }).click()
await settle(400)
const form = sheet().getByTestId('printer-form')
await form.getByRole('radio', { name: 'Zebra' }).click()
await form.getByLabel("Printer's IP address").fill('192.0.2.10')
check('the port starts at 9100', (await form.getByLabel('Port').inputValue()) === '9100')
await form.getByLabel('Port').fill('91OO')
check('a bad port says why and Save waits', /port is a number/.test(await form.innerText()) && (await form.getByRole('button', { name: 'Save printer' }).isDisabled()))
await form.getByLabel('Port').fill('9100')
await shot('printer-form')
await form.getByRole('button', { name: 'Save printer' }).click()
await settle(1200)
let config = (await companion('GET', '/config')).body
check('saved on the server as this household\'s printer', config.printer.spec === 'zebra://192.0.2.10:9100' && config.printer.source === 'settings', JSON.stringify(config.printer))
check('the card shows it', /Set here · zebra:\/\/192\.0\.2\.10:9100/.test(await sheet().getByTestId('printer-setup').innerText()))
// back to the stack's file printer for the test label (a Zebra at a documentation address cannot answer)
await companion('PUT', '/config', { printer: null })
await page.reload()
await settle(1200)
await page.getByRole('button', { name: /Milk labels/ }).click()
await settle(1000)
const before = LABELS ? readdirSync(LABELS).length : 0
await sheet().getByTestId('printer-setup').getByRole('button', { name: 'Print a test label' }).click()
await settle(2000)
check('a test label goes to the printer', /Test label sent/.test(await sheet().getByTestId('printer-setup').innerText()))
if (LABELS) check('… and reaches it', readdirSync(LABELS).length - before === 1)
// None: no printer even though the host set one
await sheet().getByTestId('printer-setup').getByRole('button', { name: 'Change printer' }).click()
await settle(400)
await sheet().getByTestId('printer-form').getByRole('radio', { name: 'None' }).click()
await sheet().getByTestId('printer-form').getByRole('button', { name: 'Save printer' }).click()
await settle(1500)
check('None means no printer: labels go through the share sheet', /No printer on the Bramble server/.test(await sheet().innerText()) && (await companion('GET', '/print/status')).body.configured === false, squash(await sheet().locator('.ls-printer').innerText()))
await shot('printer-none')
await companion('PUT', '/config', { printer: null })
await sheet().getByRole('button', { name: 'Close' }).click()
await settle(400)

// ---- the push contact: missing until an admin sets it
await page.getByRole('button', { name: /^Notifications/ }).click()
await settle(1000)
const contact = sheet().getByTestId('push-contact')
check('the push contact is called out while missing', (await contact.count()) === 1 && /nothing is sent/.test(await contact.innerText()) && (await contact.evaluate((el) => el.classList.contains('is-missing'))))
await contact.getByLabel('Contact email').fill('not an email')
await contact.getByRole('button', { name: 'Save contact' }).click()
await settle(800)
check('a bad email is refused in words', /Enter an email address/.test(await contact.innerText()), squash(await contact.innerText()))
problems.splice(0, problems.length, ...problems.filter((p) => !/http 400 PUT .*\/bramble\/config/.test(p) && !/status of 400/.test(p)))
await contact.getByLabel('Contact email').fill('parent@example.com')
await contact.getByRole('button', { name: 'Save contact' }).click()
await settle(1000)
config = (await companion('GET', '/config')).body
check('saved as a mailto: contact', config.pushContact.value === 'mailto:parent@example.com' && config.pushContact.source === 'settings', JSON.stringify(config.pushContact))
check('… and the server now has its contact', (await (await fetch(`${BASE}/bramble/health`)).json()).contact === true)
check('once set it is one quiet line with Change', /Push contact: parent@example\.com Change/.test(squash(await sheet().getByTestId('push-contact').innerText())), squash(await sheet().getByTestId('push-contact').innerText()))
await shot('push-contact')
await companion('PUT', '/config', { pushContact: null })

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
