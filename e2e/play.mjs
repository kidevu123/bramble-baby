/**
 * The Play tab: ideas by age (CDC's tips from 2 months, the first weeks from the NHS and the AAP), today's three,
 * Did it / Undo as a Play activity, tummy time, the week by area, every idea for the age, and the sleep plan's new
 * way in from the Child tab. Against the mock stack; saves screenshots and exits non-zero when a step fails.
 *
 *   node e2e/play.mjs ./e2e/out/play http://localhost:5173 light
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/play'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const THEME = process.argv[4] === 'dark' ? 'dark' : 'light'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: THEME })
const page = await ctx.newPage()
const problems = []
const checks = []
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push('console: ' + m.text().slice(0, 300)) })
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
const shot = (name, opts = {}) => page.screenshot({ path: `${OUT}/${name}-${THEME}.png`, ...opts })
const settle = (ms = 500) => page.waitForTimeout(ms)
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }
const daysAgo = (d) => { const x = new Date(); x.setDate(x.getDate() - d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

await page.goto(BASE + '/')
await page.waitForURL(/\/signin/)
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(800)
const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
{
  const kids = await (await page.request.get(BASE + '/api/children/', { headers })).json()
  for (const c of kids.results ?? []) await page.request.delete(`${BASE}/api/children/${c.slug}/`, { headers })
  await page.goto(BASE + '/')
  await settle(1000)
}
if (page.url().includes('/onboarding')) {
  await page.getByLabel('First name').fill('Oscar')
  await page.getByLabel('Birth date or due date').fill(daysAgo(80)) // 2 months and 3 weeks: CDC's 2-month list
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
}
await settle(1200)
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
const plays = async () => (await (await page.request.get(`${BASE}/bramble/activities?child=${child.id}`, { headers })).json()).filter((a) => a.type === 'play')

// ---- the tab
const tabs = (await page.locator('.tabbar .tab-label').allInnerTexts()).join('|')
check('Play is the middle tab, where Sleep Plans was', tabs === 'Home|Reports|Play|Stash|Child', tabs)
await page.getByRole('link', { name: 'Play', exact: true }).click()
await settle(1200)
const stageLine = (await page.getByTestId('play-stage').innerText()).trim()
check("a 2-month-old gets CDC's 2-month list", /^2 TO 4 MONTHS · CDC.S TIPS FOR A 2-MONTH-OLD$/i.test(stageLine), stageLine)
const today = page.getByTestId('play-today')
const areasToday = await today.locator('.play-area').allInnerTexts()
const titles = await today.locator('.play-title').allInnerTexts()
check('three ideas for today, each a different kind', (await today.count()) === 3 && new Set(areasToday.map((a) => a.trim())).size === 3, `${titles.join(' | ')} · ${areasToday.map((a) => a.trim()).join(', ')}`)
check('each says what to do', (await today.locator('.play-text').allInnerTexts()).every((t) => t.length > 30))
check('nothing overflows the screen', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await shot('01-play-today')
await shot('01b-play-full', { fullPage: true })

// ---- Did it: a Play activity tagged with the idea, on the timeline; Undo takes it back
await today.first().getByRole('button', { name: /^Did it/ }).click()
await settle(900)
check('Did it marks the idea done with the time', (await today.first().getByTestId('play-done').count()) === 1 && /Done \d+:\d\d/.test(await today.first().getByTestId('play-done').innerText()))
let logged = await plays()
check('it is saved as a Play activity named for the idea and tagged with it', logged.length === 1 && logged[0].notes === titles[0] && logged[0].tags.some((t) => t.startsWith('idea:m2-')), JSON.stringify(logged.map((a) => [a.notes, a.tags])))
const weekText = () => page.getByTestId('play-week').innerText().then((t) => t.replace(/\n/g, ' '))
const tallyTotal = async () => (await page.getByTestId('play-week').locator('.play-tally-n').allInnerTexts()).reduce((s, n) => s + Number(n), 0)
check('the week counts it under its kind', (await tallyTotal()) === 1, await weekText())
await page.getByRole('link', { name: 'Home', exact: true }).click()
await settle(1200)
const home = (await page.locator('main').innerText()).replace(/\n/g, ' ')
check('Home shows it on the timeline as Play', home.includes(titles[0]) && /Play/.test(home))
await page.getByRole('link', { name: 'Play', exact: true }).click()
await settle(1000)
check('it is still marked done after leaving and coming back', (await today.first().getByTestId('play-done').count()) === 1)
await today.first().getByRole('button', { name: 'Undo' }).click()
await settle(900)
logged = await plays()
check('Undo removes it', logged.length === 0 && (await today.first().getByRole('button', { name: /^Did it/ }).count()) === 1 && (await tallyTotal()) === 0)

// ---- Three others
await page.getByTestId('play-others').click()
await settle(300)
const others = await today.locator('.play-title').allInnerTexts()
check('Three others shows a different set', others.length === 3 && others.join('|') !== titles.join('|'), others.join(' | '))

// ---- tummy time
const tummy = (await page.getByTestId('play-tummy').innerText()).replace(/\n/g, ' ')
check("tummy time is shown with the AAP's figure for the age", /Tummy time today · none logged/.test(tummy) && /15 to 30 minutes over the day/.test(tummy), tummy)
await page.getByTestId('play-tummy').click()
await settle(700)
check('a tap opens the tummy time sheet in place', (await page.locator('dialog[open]').count()) === 1 && /tummy/i.test(await page.locator('dialog[open]').innerText()))
await page.locator('dialog[open]').getByLabel('Close').click()
await settle(400)

// ---- every idea for the age, by kind, folded
const groups = page.getByTestId('play-all').locator('details')
const counts = (await groups.locator('summary .small').allInnerTexts()).map(Number)
check('every idea for the age is listed by kind, folded', (await groups.count()) === 4 && counts.reduce((a, b) => a + b, 0) === 9 && (await page.getByTestId('play-row').first().isVisible()) === false, `counts ${counts.join('+')}`)
await groups.nth(1).locator('summary').click()
await settle(300)
const rows = groups.nth(1).getByTestId('play-row')
check('a kind opens to its ideas, each with Did it', (await rows.count()) === counts[1] && (await rows.getByRole('button', { name: /^Did it/ }).count()) === counts[1])
await shot('02-play-group')
const next = page.getByTestId('play-next')
check('the next age is named, folded, as titles only', /Coming next: 4 to 6 months/.test(await next.locator('summary').innerText()) && /15 ideas, from 4 months/.test(await next.locator('summary').innerText()) && (await next.getByRole('button').count()) === 0)
const about = page.getByTestId('play-about')
check('where the ideas come from is in the fold, closed', (await about.getAttribute('open')) === null)
await about.locator('summary').click()
await settle(300)
check('the fold names CDC and links its page for the age', (await about.locator('a[href="https://www.cdc.gov/act-early/milestones/2-months.html"]').count()) === 1 && /does not mean CDC/.test(await about.innerText()))
await shot('03-play-about', { fullPage: true })

// ---- the first weeks and an older baby
const setBirth = async (days) => {
  await page.request.patch(`${BASE}/api/children/${child.slug}/`, { headers, data: { birth_date: daysAgo(days) } })
  await page.reload()
  await settle(1500)
}
await setBirth(12)
const first = (await page.getByTestId('play-stage').innerText()).trim()
const firstTummy = (await page.getByTestId('play-tummy').innerText()).replace(/\n/g, ' ')
const firstAbout = await page.getByTestId('play-about').locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
check('a newborn gets the first weeks, not a CDC list', /^BIRTH TO 2 MONTHS/i.test(first) && firstAbout.every((h) => !h.includes('cdc.gov')) && firstAbout.some((h) => h.includes('nhs.uk')), first)
check('and the short tummy spells the AAP gives for the first weeks', /2 or 3 short spells a day of 3 to 5 minutes/.test(firstTummy), firstTummy)
await shot('04-play-newborn')
await setBirth(215)
check('at 7 months the list is the 6-month one and tummy time has stepped aside', /^6 TO 9 MONTHS/i.test((await page.getByTestId('play-stage').innerText()).trim()) && (await page.getByTestId('play-tummy').count()) === 0)
await setBirth(80)

// ---- a narrow phone
await page.setViewportSize({ width: 320, height: 640 })
await page.getByRole('link', { name: 'Play', exact: true }).click()
await settle(900)
check('at 320 wide nothing overflows and the four kinds are named in full', (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) && (await page.getByTestId('play-week').locator('.play-tally-cell .xs').evaluateAll((labels) => labels.every((l) => l.scrollWidth <= l.clientWidth))))
await shot('05-play-320', { fullPage: true })
await page.setViewportSize({ width: 390, height: 664 })

// ---- the sleep plan's way in
await page.getByRole('link', { name: 'Child', exact: true }).click()
await settle(1000)
await page.getByTestId('sleep-plan-link').click()
await settle(900)
check('the sleep plan opens from the Child tab, with Back and the Child tab lit', new URL(page.url()).pathname === '/plans' && (await page.getByRole('button', { name: 'Back' }).count()) === 1 && /Child/.test(await page.locator('.tabbar .tab.active').innerText()))
await page.getByRole('button', { name: 'Back' }).click()
await settle(700)
check('Back returns to the Child tab', new URL(page.url()).pathname === '/child')

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed (${THEME})`)
if (problems.length) console.log('PROBLEMS:\n' + [...new Set(problems)].join('\n'))
await browser.close()
process.exit(failed.length || problems.length ? 1 : 0)
