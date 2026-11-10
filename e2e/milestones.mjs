/**
 * Child tab › What to expect: the guide by age (week by week for three months, then by month), with CDC's checklist
 * for the age beside it. The Child tab's card is the one way in and opens on the child's own period; the strip and
 * the arrows browse the others; each period's lines and its sources; the checklist leads with what is seen and the
 * line to act on, a tap marks an item through the ordinary milestone sheet, an entry logged under an old name
 * counts, the hearing follow-up after a NICU stay; the Home sheet's chips come from the same list; Reports ›
 * Milestones keeps what was logged and says where the checklist is.
 *   node e2e/milestones.mjs <out-dir> <base-url> [light|dark]
 * Start from a fresh mock stack (the script creates the child).
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] ?? './e2e/out/milestones'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const SCHEME = process.argv[4] === 'dark' ? 'dark' : 'light'
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing to run against ${BASE}: this probe writes entries. Use the isolated stack from the README.`)
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
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d }

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, colorScheme: SCHEME })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`console: ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('response', (r) => { if (r.status() >= 400 && !/\/api\/profile|\/login\//.test(r.url())) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`) })
const settle = (ms = 600) => page.waitForTimeout(ms)
let n = 0
const shot = async (name, fullPage = true) => { n += 1; await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}-${SCHEME}.png`, fullPage }) }
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const sheet = () => page.locator('dialog[open]').last()
const card = () => page.getByTestId('milestone-checklist')

// ---- sign in; a child of ten weeks (the 2-month list is due, the 4-month list is next)
await page.goto(BASE + '/signin')
await page.getByLabel('Username').fill('admin')
await page.getByLabel('Password').fill('admin')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
await settle(1200)
const token = await page.evaluate(() => localStorage.getItem('bramble.token'))
const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }
// A run after another theme's: start from no child.
for (const c of (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results ?? []) await page.request.delete(`${BASE}/api/children/${c.slug}/`, { headers })
await page.goto(BASE + '/')
await settle(1200)
const birth = daysAgo(70)
await page.getByLabel('First name').fill('Leo')
await page.getByLabel('Birth date or due date').fill(ymd(birth))
await page.getByRole('button', { name: 'Start tracking' }).click()
await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
await settle(1200)
const child = (await (await page.request.get(BASE + '/api/children/', { headers })).json()).results[0]
for (const m of await (await page.request.get(`${BASE}/bramble/milestones?child=${child.id}`, { headers })).json()) await page.request.delete(`${BASE}/bramble/milestones/${m.id}`, { headers })
// Born at term, two weeks in the NICU (Settings › Born early with the weeks left empty).
await page.request.put(`${BASE}/bramble/settings/${child.id}`, { headers, data: { bornAtDays: null, nicu: { since: ymd(birth), home: ymd(daysAgo(56)) } } })
// Logged long ago under the name the sheet used to offer.
await page.request.post(`${BASE}/bramble/milestones`, { headers, data: { child: child.id, title: 'First smile', date: ymd(daysAgo(20)), category: 'social', notes: '' } })

const openTab = async () => {
  await page.goto(BASE + '/child')
  await settle(900)
  await page.getByTestId('guide-link').click()
  await page.waitForURL(/\/guide$/)
  await settle(900)
}
const head = () => page.getByTestId('guide-head')
// ---- the Child tab's card names the week and opens the guide on it
await page.goto(BASE + '/child')
await settle(900)
let t = squash(await page.getByTestId('guide-link').innerText())
check('the Child tab says what to expect this week', /What to expect · 10 weeks old Reaching and batting/.test(t), t)
await openTab()
t = squash(await head().innerText())
check('the guide opens on the child\u2019s own week', /^Now \w{3} \d+ \u2013 \w{3} \d+ 10 weeks old Reaching and batting/i.test(t), t)
check('the strip marks that week', (await page.locator('.guide-chip.active').innerText()) === '10 wk' && (await page.locator('.guide-chip.is-now').count()) === 1 && (await page.locator('.guide-chip').count()) === 30)
t = squash(await page.getByTestId('guide-notice').innerText())
check('what you may notice, for ten weeks', /Swipes at things hanging just out of reach/.test(t) && /hold and shake a rattle/.test(t), t)
check('what helps, and when to call', /What helps/i.test(await page.getByTestId('guide-helps').innerText()) && /100\.4/.test(await page.getByTestId('guide-call').innerText()))
check('the sources are folded, and named', !(await page.getByTestId('guide-about').evaluate((d) => d.open)) && (await page.getByTestId('guide-about').locator('a').count()) >= 3 && /healthychildren\.org/.test(await page.getByTestId('guide-about').locator('a').first().getAttribute('href')))
check('the tab bar keeps Child lit', (await page.locator('.tabbar .tab.active').innerText()).trim() === 'Child')
await shot('guide-now')
// another week: its own lines, no Now, the list that is coming, and the way back
await page.locator('.guide-chip', { hasText: /^5 wk$/ }).click()
await settle(400)
t = squash(await head().innerText())
check('week 5 reads as week 5', /5 weeks old The fussy weeks/.test(t) && !/^Now/i.test(t), t)
check('…with the crying peak and the first smile', /peak at about 6 weeks/.test(await page.getByTestId('guide-notice').innerText()) && /around the sixth week/.test(await page.getByTestId('guide-notice').innerText()))
check('…and the 2-month list as what is coming', (await page.getByTestId('ms-period-due').count()) === 0 && /Coming up by 2 months 1 of 11 seen/.test(squash(await page.getByTestId('ms-period-next').locator('summary').innerText())) && (await page.getByTestId('ms-period-next').evaluate((d) => d.open)))
await shot('guide-week-5')
await page.locator('.guide-pager').getByRole('button', { name: '6 weeks old' }).click()
await settle(300)
check('the arrows step a week', /6 weeks old Crying is at its peak/.test(squash(await head().innerText())))
await page.locator('.guide-chip', { hasText: /^6 mo$/ }).click()
await settle(300)
check('months after the weeks', /6 months old Six months/.test(squash(await head().innerText())) && /Solid foods can start at about 6 months/.test(await page.getByTestId('guide-care').innerText()) && /6-month check-up/.test(await page.getByTestId('guide-visit').innerText()))
check('…with the 6-month list', /By 6 months 0 of 12 seen/.test(squash(await page.getByTestId('ms-period-due').locator('summary').innerText())))
await page.getByRole('button', { name: 'Back to 10 weeks old' }).click()
await settle(300)
check('back to now', /^Now/i.test(squash(await head().innerText())))
check('the page fits the screen', await noOverflow())

t = squash(await card().innerText())
check('the 2-month list leads at ten weeks', /^By 2 months/.test(t), t.slice(0, 80))
check('an entry logged as "First smile" marks its item', /Seen 1 of 11 on the 2-month list/.test(squash(await page.getByTestId('ms-seen').innerText())), await page.getByTestId('ms-seen').innerText())
check('the next list and its day', /Next list 4 months from \w{3} \d+/.test(squash(await page.getByTestId('ms-next').innerText())), await page.getByTestId('ms-next').innerText())
check('the line says what to do, in CDC’s words', /10 on the 2-month list are not marked.*tell the doctor at the next visit.*not to wait/.test(squash(await page.getByTestId('ms-line').innerText())), await page.getByTestId('ms-line').innerText())
check('the eleven items, in four groups', (await card().locator('.ms-row').count()) === 11 && squash((await card().locator('.ms-domain').allInnerTexts()).join(' ')).toUpperCase() === 'SOCIAL LANGUAGE THINKING MOVEMENT', String(await card().locator('.ms-row').count()))
check('one is seen, with its date', (await card().locator('.ms-row.is-seen').count()) === 1 && /Smiles when you talk or smile/.test(await card().locator('.ms-row.is-seen').innerText()))
check('no screening line at 2 months', (await page.getByTestId('ms-screening').count()) === 0)
check('a NICU stay of two weeks brings the hearing test by 9 months', /Hearing test by 9 months.*NICU stay of 5 days or more/.test(squash(await page.getByTestId('ms-hearing').innerText())), await page.getByTestId('ms-hearing').innerText())
check('the explanation is folded', !(await page.getByTestId('ms-about').evaluate((d) => d.open)) && /3 in 4 children/.test(await page.getByTestId('ms-about').textContent()))
await shot('due-list')

// ---- a tap marks an item through the milestone sheet
await card().getByRole('button', { name: /Looks at your face/ }).click()
await settle(500)
t = squash(await sheet().innerText())
check('the sheet opens on the item', /Add milestone/.test(t) && (await sheet().getByLabel('Milestone').inputValue()) === 'Looks at your face', t.slice(0, 120))
check('…with its category', (await sheet().getByRole('radio', { name: 'Social' }).getAttribute('aria-checked')) === 'true')
check('…and where CDC puts it', /On CDC’s 2-month list: most children do this by 2 months/.test(squash(await sheet().getByTestId('milestone-listed').innerText())))
await shot('mark-sheet', false)
await sheet().getByRole('button', { name: 'Save', exact: true }).click()
await settle(1200)
check('saved: two seen', (await sheet().count()) === 0 && /Seen 2 of 11/.test(squash(await page.getByTestId('ms-seen').innerText())), await page.getByTestId('ms-seen').innerText())
check('the row is checked', (await card().getByRole('button', { name: /Looks at your face/ }).getAttribute('aria-pressed')) === 'true')
// a seen row opens its entry
await card().getByRole('button', { name: /Looks at your face/ }).click()
await settle(500)
check('a seen item opens its entry to edit', /Edit milestone/.test(await sheet().innerText()) && (await sheet().getByRole('button', { name: 'Delete' }).count()) === 1)
await sheet().getByRole('button', { name: 'Close' }).click()
await settle(400)

// ---- the next list, folded
const upcoming = page.getByTestId('ms-upcoming')
check('the 4-month list is folded under it', !(await upcoming.evaluate((d) => d.open)) && /Coming up by 4 months 0 of 13 seen/.test(squash(await upcoming.locator('summary').innerText())), await upcoming.locator('summary').innerText())
await upcoming.locator('summary').click()
await settle(300)
check('…and opens to its thirteen items', (await upcoming.locator('.ms-row').count()) === 13)

// ---- the hearing follow-up is marked like any milestone
await page.getByTestId('ms-hearing').click()
await settle(500)
check('the hearing row opens the sheet on its title', (await sheet().getByLabel('Milestone').inputValue()) === 'Hearing follow-up done')
await sheet().getByRole('button', { name: 'Save', exact: true }).click()
await settle(1200)
check('done, with the day', /Hearing follow-up done · \w{3} \d+/.test(squash(await page.getByTestId('ms-hearing').innerText())), await page.getByTestId('ms-hearing').innerText())
await shot('marked')
// ---- Reports › Milestones keeps what was logged, and points to the Child tab
await page.goto(BASE + '/reports')
await settle(900)
await page.getByRole('tab', { name: 'Summary' }).click()
await settle(400)
await page.getByRole('button', { name: 'Milestones', exact: true }).click()
await settle(700)
check('Reports lists the three logged, and no second checklist', (await page.locator('.plain-row-btn').count()) === 3 && (await page.getByTestId('milestone-checklist').count()) === 0 && /on the Child tab/.test(await page.getByTestId('milestones-pointer').innerText()))
await page.locator('.plain-row-btn').first().click()
await settle(500)
check('a logged row opens its entry', /Edit milestone/.test(await sheet().innerText()))
await sheet().getByRole('button', { name: 'Close' }).click()
await settle(300)

// ---- the Home sheet offers the same list, less what is marked
await page.goto(BASE + '/')
await settle(900)
await page.locator('.tile-milestones .tile-main').click()
await settle(600)
const chips = await sheet().locator('.milestone-chip').allInnerTexts()
check('the sheet’s chips are the 2-month list', /On the 2-month list/.test(await sheet().innerText()) && chips.includes('Calms down when spoken to or picked up') && chips.includes('Looks at a toy for several seconds'), chips.join(' | '))
check('…without what is already marked', !chips.includes('Looks at your face') && !chips.includes('Smiles when you talk or smile'))
check('…and the keepsakes after it', chips.includes('First tooth') && chips.includes('Crawls'))
await sheet().locator('.milestone-chip', { hasText: 'Reacts to loud sounds' }).click()
check('a chip sets the title and the category', (await sheet().getByLabel('Milestone').inputValue()) === 'Reacts to loud sounds' && (await sheet().getByRole('radio', { name: 'Language' }).getAttribute('aria-checked')) === 'true')
await shot('home-sheet', false)
await sheet().getByRole('button', { name: 'Close' }).click()
await settle(300)

// ---- three weeks old: nothing is due yet
await page.request.patch(`${BASE}/api/children/${child.slug}/`, { headers, data: { birth_date: ymd(daysAgo(21)) } })
await page.request.put(`${BASE}/bramble/settings/${child.id}`, { headers, data: { nicu: null } })
await openTab()
t = squash(await card().innerText())
check('three weeks: the guide is on week 3', /3 weeks old A growth spurt/.test(squash(await head().innerText())))
check('before 2 months the first list is what is coming', /^Coming up by 2 months/.test(t) && /Most babies by \w{3} \d+/.test(squash(await page.getByTestId('ms-next').innerText())), t.slice(0, 100))
check('…with no verdict', /Most babies do these by 2 months\. Mark each one as you see it\./.test(squash(await page.getByTestId('ms-line').innerText())) && !/not marked/.test(t))
check('…and no hearing row without a NICU stay', (await page.getByTestId('ms-hearing').count()) === 0)
await shot('coming-up')

// ---- ten months: the 9-month list names its screening; earlier lists are folded
await page.request.patch(`${BASE}/api/children/${child.slug}/`, { headers, data: { birth_date: ymd(daysAgo(305)) } })
await openTab()
check('ten months: the guide is on 10 months', /10 months old Pulling up, pointing/.test(squash(await head().innerText())))
check('the 9-month list names its screening', /^By 9 months/.test(squash(await card().innerText())) && /9-month visit is due for a developmental screening/.test(squash(await page.getByTestId('ms-screening').innerText())), await page.getByTestId('ms-screening').count() ? await page.getByTestId('ms-screening').innerText() : 'no line')
check('the earlier lists are folded, newest first', (await page.locator('[data-testid^="ms-earlier-"]').count()) === 3 && /The 2-month list 2 of 11 seen/.test(squash(await page.getByTestId('ms-earlier-2').locator('summary').innerText())), squash(await page.getByTestId('ms-earlier-2').locator('summary').innerText()))
await ctx.setViewportSize?.({ width: 320, height: 640 })
await page.setViewportSize({ width: 320, height: 640 })
await settle(400)
check('fits at 320', await noOverflow())
await shot('nine-months-320')

await browser.close()
for (const p of problems) console.log(`problem: ${p}`)
console.log(`${fails} failures, ${problems.length} problems (${SCHEME}); screenshots in ${OUT}`)
process.exit(fails || problems.length ? 1 : 0)
