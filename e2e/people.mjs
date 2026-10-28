/**
 * Probe for People (Settings › Household): one Baby Buddy login per person, roles on the timeline.
 * Runs against the isolated stack that e2e/people.sh brings up (mock Baby Buddy + two companions + two vite
 * dev servers), at iPhone width, for one colour scheme per run:
 *
 *   admin's phone   Settings › People: just you → give yourself a role → add Mom (validation, then a real
 *                   login) → the list; log a bottle; remove Mom and bring her back.
 *   Mom's phone     a second browser context: signs in as the new person, sees herself as "you" with no
 *                   admin controls, logs a bottle, gets the duplicate warning naming Dad, changes her own
 *                   password and signs in with it, is signed out while removed.
 *   unavailable     the second stack, whose companion cannot find Baby Buddy's manage.py: the sheet names
 *                   BABYBUDDY_HOME and the env file, Add is off, roles still save.
 *
 * Usage: node e2e/people.mjs <out-dir> <light|dark> <base-url> <unavailable-base-url>
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/people'
const SCHEME = process.argv[3] ?? 'light'
const BASE = process.argv[4] ?? 'http://localhost:5890'
const BASE_B = process.argv[5] ?? 'http://localhost:5891'
for (const base of [BASE, BASE_B]) {
  if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) {
    console.error(`Refusing to run against ${base}: this probe creates and removes logins. Use e2e/people.sh.`)
    process.exit(2)
  }
}
const MOM_PASSWORD = 'walnut-cradle-77'
const MOM_PASSWORD_2 = 'quiet-harbour-31'
const DAY = 24 * 3_600_000

const checks = []
const problems = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const pad = (n) => String(n).padStart(2, '0')
const squash = (s) => s.replace(/\s+/g, ' ').trim()
const dir = `${OUT}/${SCHEME}`
mkdirSync(dir, { recursive: true })
let shotN = 0

const browser = await chromium.launch()

/** One phone: a browser context with its own sign-in, screenshots and helpers. */
async function phone(label) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: SCHEME })
  await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml' } })) })
  const page = await ctx.newPage()
  // "Failed to load resource" console lines carry no URL; the response / requestfailed handlers below do.
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`[${label}] console: ${m.text().slice(0, 300)}`) })
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`))
  // A request the browser drops because the page navigated away (ERR_ABORTED) is not a failure of the app.
  page.on('requestfailed', (r) => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') problems.push(`[${label}] request failed ${r.method()} ${r.url()} (${r.failure()?.errorText})`) })
  page.on('response', (r) => {
    const url = r.url()
    // Expected refusals: the probe deliberately sends bad input and uses a removed login.
    if (r.status() >= 400 && !/\/api\/profile|\/login\/|\/bramble\/people/.test(url)) problems.push(`[${label}] http ${r.status()} ${r.request().method()} ${url}`)
  })
  const settle = (ms = 600) => page.waitForTimeout(ms)
  const shot = async (name) => { shotN += 1; await page.screenshot({ path: `${dir}/${pad(shotN)}-${label}-${name}.png` }) }
  const sheet = () => page.locator('dialog[open]').last()
  const ok = (name, cond, detail) => check(`[${SCHEME}/${label}] ${name}`, cond, detail)
  const signIn = async (base, username, password) => {
    await page.goto(base + '/signin')
    await page.waitForURL(/\/signin/)
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  const openPeople = async (base) => {
    await page.goto(base + '/settings')
    await settle(900)
    await page.locator('.settings-row', { hasText: 'People' }).click()
    await settle(900)
  }
  const rows = () => sheet().locator('.people-list .people-row')
  const row = (text) => sheet().locator('.people-list li', { hasText: text }).first()
  return { ctx, page, settle, shot, sheet, ok, signIn, openPeople, rows, row, label }
}

// ---------------------------------------------------------------- admin's phone
const dad = await phone('dad')
{
  const { page, settle, shot, sheet, ok, signIn, rows, row } = dad
  await signIn(BASE, 'admin', 'admin')
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
  for (const f of (await api('GET', `/api/feedings/?child=${child.id}`)).body.results ?? []) await api('DELETE', `/api/feedings/${f.id}/`)

  // Settings row and the empty state
  await page.goto(BASE + '/settings')
  await settle(900)
  const rowText = squash(await page.locator('.settings-row', { hasText: 'People' }).innerText())
  ok('Settings has a People row and no "your name" row', rowText.startsWith('People') && !(await page.getByText('Your name on the timeline').count()), rowText)
  ok('People row says what to do first', rowText.includes('Set who you are'), rowText)
  await shot('settings')
  await page.locator('.settings-row', { hasText: 'People' }).click()
  await settle(900)
  ok('empty state: just you', (await sheet().getAttribute('aria-label')) === 'People' && squash(await sheet().locator('.people-band-title').innerText()) === 'Just you so far')
  ok('your own row is marked you and has no role yet', (await rows().count()) === 1 && (await row('admin').locator('.people-pill.you').count()) === 1 && (await row('admin').locator('.people-pill.ask').count()) === 1)
  await shot('people-empty')

  // Give yourself a role
  await rows().first().click()
  await settle(700)
  ok('your own sheet is titled You', (await sheet().getAttribute('aria-label')) === 'You')
  await shot('people-you-edit')
  await sheet().getByRole('radio', { name: 'Dad' }).click()
  await sheet().getByRole('button', { name: 'Save', exact: true }).click()
  await settle(900)
  ok('saving a role confirms with the new label', /Saved\. The timeline now shows Dad/.test(squash(await sheet().innerText())))
  ok('you cannot remove yourself', (await sheet().getByRole('button', { name: /Remove/ }).count()) === 0 && /cannot remove yourself/.test(await sheet().innerText()))
  await sheet().locator('.sheet-head').first().getByLabel('Close').click()
  await settle(500)
  ok('the list shows Dad with the you pill', squash(await row('admin').locator('.people-row-title').innerText()).startsWith('Dad you'), squash(await row('admin').locator('.people-row-title').innerText()))

  // Add a person: validation first, then Mom
  await sheet().getByRole('button', { name: 'Add a person' }).click()
  await settle(700)
  ok('add sheet opens on Mom', (await sheet().getAttribute('aria-label')) === 'Add a person' && (await sheet().getByRole('radio', { name: 'Mom' }).getAttribute('aria-checked')) === 'true')
  await sheet().getByRole('button', { name: 'Create login' }).click()
  await settle(400)
  const addText = squash(await sheet().innerText())
  ok('empty form is refused with field hints, nothing sent', addText.includes('Choose a username') && addText.includes('Choose a password'))
  await shot('people-add-errors')
  await sheet().getByLabel('Their name').fill('Sara')
  await sheet().getByLabel('Username').fill('mom')
  await sheet().getByLabel(/^Password/).fill('short')
  await sheet().getByRole('button', { name: 'Create login' }).click()
  await settle(400)
  ok('a short password is refused before sending', /At least 8 characters/.test(await sheet().innerText()))
  await sheet().getByLabel(/^Password/).fill(MOM_PASSWORD)
  await sheet().getByRole('button', { name: 'Show' }).click()
  await shot('people-add-filled')
  await sheet().getByRole('button', { name: 'Create login' }).click()
  await settle(2500)
  ok('the add sheet closes and Mom is in the list', (await sheet().getAttribute('aria-label')) === 'People' && squash(await row('mom').locator('.people-row-title').innerText()).startsWith('Mom'), squash(await row('mom').locator('.people-row-title').innerText()))
  ok('the band counts two people', squash(await sheet().locator('.people-band-title').innerText()) === '2 people')
  const listing = (await api('GET', '/bramble/people')).body
  const mom = listing.people.find((p) => p.username === 'mom')
  ok('the server knows Mom with her role and a Baby Buddy user id', mom && mom.role === 'mom' && mom.name === 'Sara' && typeof mom.user_id === 'number' && mom.active && !mom.staff)
  await shot('people-list')
  // Adding the same username again is refused by the form before anything is sent.
  await sheet().getByRole('button', { name: 'Add a person' }).click()
  await settle(500)
  await sheet().getByLabel('Username').fill('MOM')
  await sheet().getByLabel(/^Password/).fill(MOM_PASSWORD)
  await sheet().getByRole('button', { name: 'Create login' }).click()
  await settle(400)
  ok('a username already in the household is refused', /already in the household/.test(await sheet().innerText()))
  await sheet().locator('.sheet-head').first().getByLabel('Close').click()
  await settle(300)
  await sheet().locator('.sheet-head').first().getByLabel('Close').click()
  await settle(300)
  ok('the Settings row now lists the roles', squash(await page.locator('.settings-row', { hasText: 'People' }).innerText()).includes('Dad, Mom'))

  // Dad logs a bottle
  await page.goto(BASE + '/')
  await settle(1000)
  await page.locator('.tile-bottle .tile-main').click()
  await settle(700)
  ok('no duplicate warning when nobody logged anything', (await sheet().locator('.dup-warning').count()) === 0)
  await sheet().getByRole('spinbutton', { name: /Amount in/ }).fill('60')
  await sheet().getByRole('button', { name: 'Save', exact: true }).click()
  await settle(1500)
  const dadRow = page.locator('.tl-row', { hasText: 'Bottle' }).first()
  ok('Dad’s bottle is marked Dad on the timeline', squash(await dadRow.locator('.tl-by').innerText()) === 'Dad', squash(await dadRow.innerText()))
  await page.locator('.tl-list').scrollIntoViewIfNeeded()
  await shot('home-dad-bottle')
}

// ---------------------------------------------------------------- Mom's phone
const mom = await phone('mom')
{
  const { page, settle, shot, sheet, ok, signIn, openPeople, rows, row } = mom
  await signIn(BASE, 'mom', MOM_PASSWORD)
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
  await settle(1500)
  ok('Mom signs in with the login Dad created and lands on Home', page.url().endsWith('/'), page.url())
  const dadRow = page.locator('.tl-row', { hasText: 'Bottle' }).first()
  ok('Mom sees Dad’s bottle marked Dad', squash(await dadRow.locator('.tl-by').innerText()) === 'Dad')
  await page.locator('.tile-bottle .tile-main').click()
  await settle(700)
  const warning = squash(await sheet().locator('.dup-warning').innerText().catch(() => ''))
  ok('the duplicate warning names Dad', /^Dad already logged bottle/.test(warning), warning)
  await shot('home-dup-warning')
  await sheet().getByRole('spinbutton', { name: /Amount in/ }).fill('40')
  await sheet().getByRole('button', { name: 'Save', exact: true }).click()
  await settle(1500)
  const momRow = page.locator('.tl-row', { hasText: 'Bottle' }).first()
  ok('Mom’s bottle is marked Mom', squash(await momRow.locator('.tl-by').innerText()) === 'Mom', squash(await momRow.innerText()))
  await page.locator('.tl-list').scrollIntoViewIfNeeded()
  await shot('home-both-bottles')

  await openPeople(BASE)
  ok('Mom sees the household but cannot add people', (await rows().count()) === 2 && (await sheet().getByRole('button', { name: 'Add a person' }).count()) === 0 && /Only an admin can add or remove/.test(await sheet().innerText()))
  ok('Mom is marked you, Dad is marked admin', (await row('mom').locator('.people-pill.you').count()) === 1 && (await row('admin').locator('.people-pill', { hasText: 'admin' }).count()) === 1)
  ok('Mom cannot open Dad’s row', (await row('admin').locator('button').count()) === 0)
  await shot('people-as-mom')
  await row('mom').locator('button').click()
  await settle(600)
  ok('Mom’s own sheet has no Remove', (await sheet().getByRole('button', { name: /Remove/ }).count()) === 0)
  await sheet().getByLabel(/^New password/).fill(MOM_PASSWORD_2)
  await sheet().getByRole('button', { name: 'Change password' }).click()
  await settle(2000)
  ok('Mom changes her own password', /Password changed/.test(await sheet().innerText()))
  await shot('people-mom-password')
  await sheet().locator('.sheet-head').first().getByLabel('Close').click()
  await settle(300)
  await sheet().locator('.sheet-head').first().getByLabel('Close').click()
  await settle(300)
  await page.getByRole('button', { name: /Sign out/ }).click()
  await page.getByRole('group', { name: 'Sign out of this phone' }).getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL(/\/signin/)
  await signIn(BASE, 'mom', MOM_PASSWORD)
  await settle(1200)
  ok('the old password no longer works', page.url().includes('/signin') && /Wrong username or password/.test(await page.locator('main').innerText()))
  await signIn(BASE, 'mom', MOM_PASSWORD_2)
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
  await settle(800)
  ok('the new password works', !page.url().includes('/signin'))
}

// ---------------------------------------------------------------- Dad removes Mom, Mom is signed out, Dad brings her back
{
  const { settle, shot, sheet, ok, openPeople, row } = dad
  await openPeople(BASE)
  await row('mom').locator('button').click()
  await settle(600)
  await sheet().getByRole('button', { name: 'Remove Mom' }).click()
  await settle(300)
  ok('removing asks first and says what happens', /Their login stops working on every phone/.test(await sheet().innerText()))
  await sheet().locator('.people-confirm').scrollIntoViewIfNeeded()
  await shot('people-remove-confirm')
  await sheet().getByRole('button', { name: 'Remove', exact: true }).click()
  await settle(2500)
  ok('the removed person stays listed as removed with Bring back', /removed/.test(await sheet().innerText()) && (await sheet().getByRole('button', { name: 'Bring back' }).count()) === 1)
  await shot('people-removed')

  const momPage = mom.page
  await momPage.goto(BASE + '/')
  await momPage.waitForURL(/\/signin/, { timeout: 15000 }).catch(() => null)
  mom.ok('a removed person is signed out on her phone', momPage.url().includes('/signin'), momPage.url())
  await mom.signIn(BASE, 'mom', MOM_PASSWORD_2)
  await mom.settle(1200)
  mom.ok('and cannot sign in again', momPage.url().includes('/signin'))
  await mom.shot('signin-while-removed')

  await sheet().getByRole('button', { name: 'Bring back' }).click()
  await settle(2500)
  ok('Bring back restores the login', (await sheet().getByRole('button', { name: 'Remove Mom' }).count()) === 1)
  await sheet().locator('.sheet-head').first().getByLabel('Close').click()
  await settle(300)
  ok('Mom is active in the list again', (await row('mom').locator('.people-pill.off').count()) === 0)
  await mom.signIn(BASE, 'mom', MOM_PASSWORD_2)
  await momPage.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
  mom.ok('Mom can sign in again after being brought back', !momPage.url().includes('/signin'))
  // What she logged while she was removed-and-restored is still hers.
  await momPage.goto(BASE + '/')
  await mom.settle(1000)
  const chips = await momPage.locator('.tl-row .tl-by').allInnerTexts()
  mom.ok('the timeline still shows Mom and Dad', chips.map(squash).includes('Mom') && chips.map(squash).includes('Dad'), chips.join(','))
}

// ---------------------------------------------------------------- the server that cannot create logins
const unavailable = await phone('unavailable')
{
  const { page, settle, shot, sheet, ok, signIn, openPeople, rows } = unavailable
  await signIn(BASE_B, 'admin', 'admin')
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
  await settle(1200)
  await openPeople(BASE_B)
  const notice = squash(await sheet().locator('.people-notice').innerText().catch(() => ''))
  ok('the sheet says this server cannot create logins, naming BABYBUDDY_HOME and the env file', notice.includes('can’t create logins') && notice.includes('BABYBUDDY_HOME') && notice.includes('/opt/bramble-server/data/env'), notice)
  ok('Add a person is off', await sheet().getByRole('button', { name: 'Add a person' }).isDisabled())
  ok('logins seen in caregiver tags are listed so they can be given a role', (await rows().count()) >= 1)
  await shot('people-unavailable')
  await rows().first().click()
  await settle(600)
  await sheet().getByRole('radio', { name: 'Grandpa' }).click()
  await sheet().getByRole('button', { name: 'Save', exact: true }).click()
  await settle(900)
  ok('roles still save without the Django channel', /Saved\. The timeline now shows Grandpa/.test(squash(await sheet().innerText())))
  ok('the password section explains instead of failing', /Passwords are changed in Baby Buddy, which this server cannot reach yet/.test(await sheet().innerText()))
  await shot('people-unavailable-edit')
}

await browser.close()
const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed (${SCHEME}); screenshots in ${dir}`)
if (problems.length) console.log('PROBLEMS:\n' + [...new Set(problems)].join('\n'))
process.exit(failed.length || problems.length ? 1 : 0)
