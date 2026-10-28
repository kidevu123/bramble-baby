/**
 * Probe for the simple screen (grandparents): runs against the stack e2e/simple-screen.sh brings up.
 *
 *   admin's phone    adds Grandma (the login is created by the fake Baby Buddy Django), sees "Their phone shows:
 *                    Simple screen" with Bottle and Diaper on in her People sheet, makes premade bottles 1 and 2.
 *   Grandma's phone  a second browser context: no tab bar, no Settings, two big buttons; Bottle → 1 → Yes, all of it
 *                    saves a 60 mL feeding tagged caregiver:nana and empties spot 1; "Oops, take it back"
 *                    deletes it and puts the bottle back; Diaper → Poop saves at once; No, she left some → About half
 *                    (the admin's timeline says finished / not finished); no bottles
 *                    left says so; the admin narrows her to Diaper only, then gives her the full app.
 *
 * Usage: node e2e/simple-screen.mjs <out-dir> <light|dark> <base-url>
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/simple-screen'
const SCHEME = process.argv[3] === 'dark' ? 'dark' : 'light'
const BASE = process.argv[4] ?? 'http://localhost:5890'
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this probe creates logins. Use e2e/simple-screen.sh.`)
  process.exit(2)
}
const NANA_PASSWORD = 'clover-meadow-12'
const dir = `${OUT}/${SCHEME}`
mkdirSync(dir, { recursive: true })
let fails = 0
const problems = []
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${SCHEME}] ${name}${ok || detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) fails += 1
}
const squash = (s) => s.replace(/\s+/g, ' ').trim()
let n = 0

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
async function phone(label) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, colorScheme: SCHEME })
  await ctx.addInitScript(() => { if (!localStorage.getItem('bramble.prefs')) localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml' } })) })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`[${label}] console: ${m.text().slice(0, 300)}`) })
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`))
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\/profile|\/login\//.test(r.url())) problems.push(`[${label}] http ${r.status()} ${r.request().method()} ${r.url()}`) })
  const settle = (ms = 700) => page.waitForTimeout(ms)
  const shot = async (name) => { n += 1; await page.screenshot({ path: `${dir}/${String(n).padStart(2, '0')}-${label}-${name}.png` }) }
  const signIn = async (username, password) => {
    await page.goto(BASE + '/signin')
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
    await settle(1500)
  }
  const token = () => page.evaluate(() => localStorage.getItem('bramble.token'))
  const call = async (method, path, body) => {
    const t = await token()
    const r = await fetch(BASE + path, { method, headers: { Authorization: `Token ${t}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, body: await r.json().catch(() => null) }
  }
  return { ctx, page, settle, shot, signIn, call }
}

// ---- admin: a child, Grandma, two premade bottles
const admin = await phone('admin')
await admin.signIn('admin', 'admin')
if (admin.page.url().includes('/onboarding')) {
  await admin.page.getByLabel('First name').fill('Ada')
  await admin.page.getByLabel('Birth date or due date').fill(new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10))
  await admin.page.getByRole('button', { name: 'Start tracking' }).click()
  await admin.page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
  await admin.settle(1000)
}
const child = (await admin.call('GET', '/api/children/')).body.results[0]
const added = await admin.call('POST', '/bramble/people', { username: 'nana', password: NANA_PASSWORD, role: 'grandma' })
check('the admin adds Grandma; she gets the simple screen with both buttons', added.status === 201 && added.body.screen === 'simple' && added.body.simpleActions.join() === 'bottle,diaper', JSON.stringify(added.body))
await admin.page.goto(BASE + '/settings')
await admin.settle(900)
await admin.page.locator('.settings-row', { hasText: 'People' }).click()
await admin.settle(1200)
await admin.page.locator('dialog[open] .people-list li', { hasText: 'Grandma' }).first().click()
await admin.settle(800)
const field = admin.page.getByTestId('screen-field')
check('her People sheet says what her phone shows: Simple screen, Bottle and Diaper on', (await field.count()) === 1 && (await field.getByRole('radio', { name: 'Simple screen' }).getAttribute('aria-checked')) === 'true' && (await field.getByRole('switch').evaluateAll((s) => s.map((x) => x.getAttribute('aria-checked')))).join() === 'true,true')
await field.scrollIntoViewIfNeeded()
await admin.shot('people-grandma')
const bags = []
for (const [i, ml] of [[1, 60], [2, 60]]) bags.push((await admin.call('POST', '/bramble/milk', { child: child.id, pumped_at: new Date(Date.now() - (i + 2) * 3_600_000).toISOString(), volume_ml: ml, location: 'fridge', client_key: `simple-bag-${i}-${Date.now()}` })).body)
const made = await admin.call('POST', '/bramble/milk/bottles', { child: child.id, bottles: bags.map((b, i) => ({ spot: i + 1, takes: [{ bag: b.id, amount_ml: 60 }], client_key: `simple-bottle-${i}-${Date.now()}` })) })
check('premade bottles 1 and 2 are in the fridge', made.status === 201 && made.body.length === 2, JSON.stringify(made.body).slice(0, 200))

// ---- Grandma's phone
const nana = await phone('nana')
const page = nana.page
await nana.signIn('nana', NANA_PASSWORD)
const simple = page.getByTestId('simple-page')
check('her phone opens on the simple screen: no tab bar, no Settings', (await simple.count()) === 1 && (await page.locator('nav.tabbar').count()) === 0 && (await page.getByRole('link', { name: /Settings/ }).count()) === 0)
check('the child, the day and time, and one prompt', /Ada/.test(await simple.innerText()) && /Tap what you just did/.test(await simple.innerText()))
const big = async () => (await page.locator('.simple-big .simple-big-label').allTextContents()).map(squash)
check('two big buttons: Bottle and Diaper', JSON.stringify(await big()) === JSON.stringify(['Bottle', 'Diaper']), JSON.stringify(await big()))
const heights = await page.locator('.simple-big').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height))
check('each is at least 110 px tall', heights.every((h) => h >= 110), JSON.stringify(heights))
const label = await page.locator('.simple-big-label').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
check('the words are at least 30 px', label >= 30, String(label))
check('nothing wider than the screen', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
await nana.shot('home')

// Bottle → 1 → Yes, all of it
await page.getByRole('button', { name: /^Bottle/ }).click()
await nana.settle(800)
check('Which bottle? shows the fridge numbers 1 and 2', (await page.locator('.simple-spot .simple-spot-num').allTextContents()).join() === '1,2')
await nana.shot('which-bottle')
await page.getByRole('button', { name: /^Bottle 1,/ }).click()
await nana.settle(400)
check('one question: did she finish it, yes or no', /Did Ada finish bottle 1\?/.test(await simple.innerText()) && JSON.stringify(await big()) === JSON.stringify(['Yes, all of it', 'No, she left some']), JSON.stringify(await big()))
await nana.shot('finish')
await page.getByRole('button', { name: /^Yes, all of it/ }).click()
await nana.settle(1500)
const saved = page.getByTestId('simple-saved')
check('Saved, with what was saved and the time', (await saved.count()) === 1 && /Bottle 1 · finished · 60 mL · \d{1,2}:\d{2} [AP]M/.test(await saved.innerText()), squash(await simple.innerText()))
await nana.shot('saved')
let feeds = (await admin.call('GET', `/api/feedings/?child=${child.id}`)).body.results ?? []
const feed = feeds.filter((f) => (f.notes ?? '').includes('Premade bottle 1')).sort((a, b) => b.id - a.id)[0]
check('the feeding is a 60 mL bottle at now, tagged as Grandma', feed && Number(feed.amount) === 60 && feed.notes === 'Premade bottle 1 · finished' && feed.method === 'bottle' && (feed.tags ?? []).includes('caregiver:nana') && Math.abs(Date.parse(feed.start) - Date.now()) < 5 * 60_000, JSON.stringify(feed))
const stash = async () => (await admin.call('GET', `/bramble/milk?child=${child.id}`)).body
check('bottle 1 left its spot', (await stash()).find((b) => b.kind === 'bottle' && b.spot === 1)?.status === 'used')
// Oops
await page.getByRole('button', { name: 'Oops, take it back' }).click()
await nana.settle(1500)
check('Taken back', (await page.getByTestId('simple-undone').count()) === 1)
feeds = (await admin.call('GET', `/api/feedings/?child=${child.id}`)).body.results ?? []
const back = (await stash()).filter((b) => b.kind === 'bottle')
check('… the feeding is gone and bottle 1 is back in its spot', !feeds.some((f) => f.id === feed?.id) && back.find((b) => b.spot === 1)?.status === 'stored', JSON.stringify({ feeds: feeds.map((f) => f.id), feed: feed?.id, back: back.map((b) => [b.id, b.spot, b.status, b.remaining_ml]) }))
await page.getByRole('button', { name: 'Done' }).click()
await nana.settle(500)

// Diaper → Poop: one tap
await page.getByRole('button', { name: /^Diaper/ }).click()
await nana.settle(500)
check('What was in the diaper? Pee, Poop, Both', JSON.stringify(await big()) === JSON.stringify(['Pee', 'Poop', 'Both']), JSON.stringify(await big()))
await nana.shot('diaper')
await page.getByRole('button', { name: /^Poop/ }).click()
await nana.settle(1500)
check('Saved after one tap', /Diaper · poop · \d{1,2}:\d{2} [AP]M/.test(await page.getByTestId('simple-saved').innerText()))
const changes = (await admin.call('GET', `/api/changes/?child=${child.id}`)).body.results ?? []
check('the diaper is poop only, now, tagged as Grandma', changes.some((c) => c.solid && !c.wet && (c.tags ?? []).includes('caregiver:nana') && Math.abs(Date.parse(c.time) - Date.now()) < 5 * 60_000), JSON.stringify(changes.slice(0, 2)))
await page.getByRole('button', { name: 'Done' }).click()
await nana.settle(1500)
check('home says when the last diaper was, in words', /Last diaper \d{1,2}:\d{2} [AP]M · just now/.test(await simple.innerText()), squash(await simple.innerText()))

// Bottle 2, about half; then bottle 1; then none left
await page.getByRole('button', { name: /^Bottle/ }).click()
await nana.settle(600)
await page.getByRole('button', { name: /^Bottle 2,/ }).click()
await nana.settle(300)
await page.getByRole('button', { name: /^No, she left some/ }).click()
await nana.settle(400)
check('No asks how much is left: a little, about half, most of it', /How much is left in bottle 2\?/.test(await simple.innerText()) && JSON.stringify(await big()) === JSON.stringify(['A little', 'About half', 'Most of it']), JSON.stringify(await big()))
check('… each says what she drank', /She drank about 45 mL[\s\S]*She drank about 30 mL[\s\S]*She drank about 15 mL/.test(await simple.innerText()), squash(await simple.innerText()))
await nana.shot('how-much-left')
await page.getByRole('button', { name: /^About half/ }).click()
await nana.settle(1500)
check('About half left saves half the bottle, marked not finished', /Bottle 2 · not finished · she drank about 30 mL/.test(await page.getByTestId('simple-saved').innerText()))
feeds = (await admin.call('GET', `/api/feedings/?child=${child.id}`)).body.results ?? []
const half = feeds.filter((f) => (f.notes ?? '').includes('Premade bottle 2')).sort((a, b) => b.id - a.id)[0]
check('… the feeding is 30 mL with the note "not finished, about half left"', half && Number(half.amount) === 30 && half.notes === 'Premade bottle 2 · not finished, about half left', JSON.stringify(half))
check('… and bottle 2 left its spot whole', (await stash()).find((b) => b.kind === 'bottle' && b.spot === 2)?.status === 'used')
await page.getByRole('button', { name: 'Done' }).click()
await nana.settle(500)
await page.getByRole('button', { name: /^Bottle/ }).click()
await nana.settle(600)
await page.getByRole('button', { name: /^Bottle 1,/ }).click()
await nana.settle(300)
await page.getByRole('button', { name: /^Yes, all of it/ }).click()
await nana.settle(1500)
await page.getByRole('button', { name: 'Done' }).click()
await nana.settle(500)
await page.getByRole('button', { name: /^Bottle/ }).click()
await nana.settle(1200)
check('with no bottles left it says to ask Mom or Dad', (await page.getByTestId('simple-no-bottles').count()) === 1)
await nana.shot('no-bottles')
await page.getByRole('button', { name: /Back/ }).click()
await nana.settle(400)

// The parents see the mark on their timeline.
await admin.page.goto(BASE + '/')
await admin.settle(2000)
const timeline = squash(await admin.page.locator('main').innerText())
check("the admin's timeline says which bottle was finished and which was not", /Bottle · not finished[^·]*Bottle · breast milk · 30 mL/.test(timeline) && /Bottle · finished[^·]*Bottle · breast milk · 60 mL/.test(timeline), timeline.slice(0, 600))
await admin.page.getByText('Bottle · not finished').first().scrollIntoViewIfNeeded()
await admin.shot('timeline-marks')

// The admin narrows her to Diaper only, then gives her the full app.
check('Grandma cannot change her own screen', (await nana.call('PATCH', '/bramble/people/nana', { screen: 'full' })).status === 403)
await admin.call('PATCH', '/bramble/people/nana', { simpleActions: ['diaper'] })
await page.reload()
await nana.settle(2000)
check('Diaper only: one big button', JSON.stringify(await big()) === JSON.stringify(['Diaper']), JSON.stringify(await big()))
await admin.call('PATCH', '/bramble/people/nana', { screen: 'full' })
await page.reload()
await nana.settle(2500)
check('the full app once the admin says so', (await page.getByTestId('simple-page').count()) === 0 && (await page.locator('nav.tabbar').count()) === 1)

// The way out: "Signed in as Grandma ›" opens one screen whose big button is Back; Sign out is the smaller one.
await admin.call('PATCH', '/bramble/people/nana', { screen: 'simple', simpleActions: ['bottle', 'diaper'] })
await page.reload()
await nana.settle(2500)
const whoBtn = page.getByRole('button', { name: /^Signed in as Grandma/ })
check('the simple screen has a way out: "Signed in as Grandma" is a button at least 44 px tall', (await whoBtn.count()) === 1 && (await whoBtn.evaluate((b) => b.getBoundingClientRect().height)) >= 44)
await whoBtn.click()
await nana.settle(400)
check('… it opens a screen whose big button is Back, with Sign out under it', (await page.getByTestId('simple-account').count()) === 1 && /Not Grandma\? Sign out here/.test(await simple.innerText()) && (await page.locator('.simple-big', { hasText: 'Back' }).count()) === 1)
await nana.shot('sign-out')
await page.locator('.simple-big', { hasText: 'Back' }).click()
await nana.settle(400)
check('… Back goes home and stays signed in', /Tap what you just did/.test(await simple.innerText()))
await whoBtn.click()
await nana.settle(400)
await page.getByRole('button', { name: 'Sign out' }).click()
await page.waitForURL((u) => u.pathname.startsWith('/signin'), { timeout: 10000 }).catch(() => {})
await nana.settle(800)
check('… Sign out signs the phone out', page.url().includes('/signin') && !(await page.evaluate(() => localStorage.getItem('bramble.token'))), page.url())

await browser.close()
for (const p of problems) console.log('problem:', p)
console.log(`\n${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${dir}`)
process.exit(fails || problems.length ? 1 : 0)
