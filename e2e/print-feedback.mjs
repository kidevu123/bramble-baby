/**
 * Probe for the "Print label" feedback in the milk label sheet (companion printer attached, here the
 * file:// backend): tapping Print shows a sending state at once, then a "Sent to the printer" card with
 * the time and the printer's answer, the button becomes "Print again · sent N s ago", a double tap sends
 * one job, and a failed print is called out in plain language with "Try again". Runs against the isolated
 * stack from the README at iPhone width, light and dark, and screenshots every state.
 *
 * It empties the child's stash and pumping entries first, so it only runs against localhost.
 *
 * Usage: node e2e/print-feedback.mjs <out-dir> [base-url=http://localhost:5173]
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/print-feedback'
const BASE = process.argv[3] ?? 'http://localhost:5173'
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
const DAY = 86_400_000

const browser = await chromium.launch()

async function run(scheme) {
  const dir = `${OUT}/${scheme}`
  mkdirSync(dir, { recursive: true })
  const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme })
  await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml' } })) })
  const page = await ctx.newPage()
  // The 503 is the failure this probe provokes on purpose; the browser logs it as a resource error.
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 503/.test(m.text())) problems.push(`[${scheme}] console: ${m.text().slice(0, 300)}`) })
  page.on('pageerror', (e) => problems.push(`[${scheme}] pageerror: ${e.message}`))
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/profile') && !r.url().includes('/print/label')) problems.push(`[${scheme}] http ${r.status()} ${r.request().method()} ${r.url()}`) })
  const settle = (ms = 600) => page.waitForTimeout(ms)
  let n = 0
  const shot = async (name) => { n += 1; await page.screenshot({ path: `${dir}/${pad(n)}-${name}.png` }) }
  const sheet = () => page.locator('dialog[open]').last()
  const ok = (name, cond, detail) => check(`[${scheme}] ${name}`, cond, detail)

  // ---- sign in, a child, an empty stash
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
    await page.getByLabel('Birth date or due date').fill(born.toISOString().slice(0, 10))
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
  for (const p of (await api('GET', `/api/pumping/?child=${child.id}`)).body.results ?? []) await api('DELETE', `/api/pumping/${p.id}/`)
  const printer = (await api('GET', '/bramble/print/status')).body
  ok('companion has a printer configured (file backend for this probe)', printer.configured === true && printer.kind === 'file', JSON.stringify(printer))

  // ---- the label from a pumping session
  await page.goto(BASE + '/')
  await settle(1200)
  await page.locator('.tile-pumping .tile-main').click()
  await settle()
  await sheet().getByLabel('Volume in mL').fill('90')
  await sheet().getByRole('button', { name: /Print milk label/ }).click()
  await sheet().locator('.stash-card .strong').first().waitFor()
  await settle(900)
  const printBtn = () => sheet().getByRole('button', { name: 'Print label' })
  ok('Print label is the primary action once the bag exists', (await printBtn().count()) === 1 && !(await printBtn().isDisabled()))
  await shot('label-ready')

  // Slow the print request down so the sending state is visible, and count what reaches the companion.
  const posts = []
  const jobIds = []
  page.on('response', async (r) => { if (r.url().includes('/bramble/print/label') && r.status() === 200) jobIds.push((await r.json()).job?.id) })
  let delayMs = 1500
  let fail = null
  await page.route('**/bramble/print/label', async (route) => {
    posts.push(route.request().postDataJSON())
    await new Promise((r) => setTimeout(r, delayMs))
    if (fail) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: fail }) })
    return route.continue()
  })

  // ---- tap, then tap again at once: one job
  await printBtn().click()
  await printBtn().click({ force: true, timeout: 500 }).catch(() => {})
  await settle(300)
  const sending = sheet().getByRole('button', { name: /Sending to the printer/ })
  ok('the button turns into "Sending to the printer…" at once and is disabled', (await sending.count()) === 1 && (await sending.isDisabled()))
  await shot('sending')
  await sheet().locator('.print-card.state-sent').waitFor({ timeout: 8000 })
  await settle(400)
  ok('a double tap sent exactly one job', posts.length === 1, `${posts.length} POST /print/label`)
  ok('the job carried the bag code for the server log', typeof posts[0]?.code === 'string' && posts[0].code.length === 6, String(posts[0]?.code))
  ok('the label image itself is what was printed', typeof posts[0]?.png === 'string' && posts[0].png.length > 1000)
  const card = (await sheet().locator('.print-card').innerText()).replace(/\s+/g, ' ')
  ok('"Sent to the printer" card with a time and what sent means on this backend', /Sent to the printer \d{1,2}:\d\d:\d\d [AP]M/.test(card) && /file/.test(card), card)
  const again = () => sheet().getByRole('button', { name: /Print again/ })
  ok('the primary action is now a deliberate "Print again · sent … ago"', (await again().count()) === 1 && /sent (just now|\d+ s ago)/.test((await again().innerText()).replace(/\s+/g, ' ')), (await again().innerText()).replace(/\s+/g, ' '))
  ok('the old "Print label" button is gone', (await printBtn().count()) === 0)
  await shot('sent')
  await settle(6000)
  ok('the Print again button counts the seconds', /sent \d+ s ago/.test((await again().innerText()).replace(/\s+/g, ' ')), (await again().innerText()).replace(/\s+/g, ' '))
  await shot('print-again-later')

  // ---- a second label on purpose still prints
  delayMs = 200
  await again().click()
  await settle(900)
  ok('Print again sends a second job', posts.length === 2)
  const jobs = await Promise.all(jobIds.slice(0, 2).map((id) => api('GET', `/bramble/print/job/${id}`)))
  ok('both jobs are on record on the companion', jobs.length === 2 && jobs.every((j) => j.status === 200 && j.body.backend === 'file' && j.body.state === 'sent' && j.body.checking === false), JSON.stringify(jobs.map((j) => j.body?.state)))

  // ---- a failure is loud and says why
  fail = 'Could not reach the Zebra at 192.0.2.2:9100: [Errno 113] No route to host. Is it on and on the network?'
  delayMs = 300
  await again().click()
  await sheet().locator('.print-card.state-failed').waitFor({ timeout: 5000 })
  await settle(400)
  const failed = (await sheet().locator('.print-card.state-failed').innerText()).replace(/\s+/g, ' ')
  ok('the failure card names the problem in the server\'s words', /Could not print/.test(failed) && /No route to host/.test(failed), failed)
  ok('the action becomes "Try again"', (await sheet().getByRole('button', { name: 'Try again' }).count()) === 1)
  ok('nothing in the sheet still says "Printing"', !/Printing on the label printer/.test(await sheet().innerText()))
  await shot('failed')

  // ---- and Try again recovers
  fail = null
  await sheet().getByRole('button', { name: 'Try again' }).click()
  await sheet().locator('.print-card.state-sent').waitFor({ timeout: 5000 })
  ok('Try again prints and the sent card is back', posts.length === 4 && (await sheet().locator('.print-card.state-failed').count()) === 0)
  await shot('recovered')

  await page.unroute('**/bramble/print/label')
  await ctx.close()
}

try {
  await run('light')
  await run('dark')
} catch (err) {
  console.error('FAILED:', err.message.split('\n')[0])
  check('probe ran to the end', false, err.message.split('\n')[0])
}
await browser.close()
const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (problems.length) console.log('PROBLEMS:\n' + [...new Set(problems)].join('\n'))
process.exit(failed.length || problems.length ? 1 : 0)
