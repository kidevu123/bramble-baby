import { describe, expect, it } from 'vitest'
import type { Weight } from './api/types'
import { ageBasis } from './preterm'
import { formatGrams, formatPerDay, gainRate, checkDetail, checkRate, checkTally, gainVerdict, stepCompares, weightChecks, stepNoiseNote, weekBesideGoal, weightGain } from './weight-gain'

const w = (id: number, date: string, lb: number, clock = '9:00 AM'): Weight => ({ id, child: 1, date, weight: lb, notes: clock, tags: [] })
const birth = '2026-09-18'
// 5.0 lb eight days ago, 5.3 lb yesterday, 5.35 lb today: +23 g since yesterday, +159 g over 8 days (20 g/day).
const weights = [w(1, '2026-10-01', 5.0), w(2, '2026-10-08', 5.3), w(3, '2026-10-09', 5.35)]

describe('weightGain', () => {
  it('measures the last step and the week in grams a day, whatever the phone shows', () => {
    const g = weightGain(weights, 'lb', birth, null)
    expect(Math.round(g.latest!.grams)).toBe(2427)
    expect(g.sinceLast).toMatchObject({ days: 1 })
    expect(Math.round(g.sinceLast!.grams)).toBe(23)
    expect(g.week).toMatchObject({ days: 8 })
    expect(Math.round(g.week!.grams)).toBe(159)
    expect(g.week!.perDay).toBeCloseTo(19.8, 1)
    expect(g.typicalPerDay).toEqual([21, 29])
    expect(g.goal).toBeNull()
  })
  it('reads kilograms the same way', () => {
    const g = weightGain([{ ...w(1, '2026-10-01', 2.3) }, { ...w(2, '2026-10-08', 2.44) }], 'kg', birth, 20)
    expect(Math.round(g.sinceLast!.grams)).toBe(140)
    expect(g.sinceLast!.days).toBe(7)
    expect(g.week!.perDay).toBe(20)
    expect(g.goal).toBe(20)
  })
  it('ignores a second weighing on the same day for the step, and needs 5–10 days for a week', () => {
    const g = weightGain([w(1, '2026-10-09', 5.3, '8:00 AM'), w(2, '2026-10-09', 5.35, '7:00 PM'), w(3, '2026-10-06', 5.2)], 'lb', birth, null)
    expect(g.sinceLast!.since.getDate()).toBe(6)
    expect(g.sinceLast!.days).toBe(3)
    expect(g.week).toBeNull()
    expect(weightGain([w(1, '2026-10-09', 5.3)], 'lb', birth, null).sinceLast).toBeNull()
    expect(weightGain([], 'lb', birth, null).latest).toBeNull()
  })
  it('can look back to how it stood on an earlier day', () => {
    const g = weightGain(weights, 'lb', birth, null, new Date('2026-10-08T23:59:59'))
    expect(Math.round(g.latest!.grams)).toBe(2404)
    expect(g.sinceLast!.days).toBe(7)
  })
  it('has no daily rate to hold a newborn to', () => {
    expect(weightGain([w(1, '2026-09-20', 5.0), w(2, '2026-09-22', 4.9)], 'lb', birth, null).typicalPerDay).toBeNull()
  })
})

describe('the step since the last weighing', () => {
  it('says which two weighings it compares, with their clocks', () => {
    // The owner's Hatch on Oct 11–12: 5 lb 6.5 oz at 10:36 AM, then 5 lb 5.75 oz at 6:13 PM: −21 g.
    const g = weightGain([w(1, '2026-10-11', 5 + 6.5 / 16, '10:36 AM'), w(2, '2026-10-12', 5 + 5.75 / 16, 'Hatch Grow scale · 6:13 PM')], 'lb', birth, 20)
    expect(Math.round(g.sinceLast!.grams)).toBe(-21)
    expect(stepCompares(g)).toBe('6:13 PM vs 10:36 AM yesterday')
    const older = weightGain([w(1, '2026-10-09', 5.3, '9:03 AM'), w(2, '2026-10-12', 5.35, '6:13 PM')], 'lb', birth, null)
    expect(stepCompares(older)).toBe('6:13 PM vs 9:03 AM Oct 9')
  })
  it('uses the dates alone when a weighing has no clock', () => {
    const g = weightGain([w(1, '2026-10-11', 5.3, ''), w(2, '2026-10-12', 5.35, '6:13 PM')], 'lb', birth, null)
    expect(stepCompares(g)).toBe('Oct 12 vs Oct 11')
  })
  it('points from one day’s swing to the week', () => {
    expect(stepNoiseNote(weightGain(weights, 'lb', birth, null))).toBe('One day can swing ±30 g with feeds, diapers and the time of day; the 8-day figure is the trend.')
    expect(stepNoiseNote({ week: null })).toBe('One day can swing ±30 g with feeds, diapers and the time of day; a week of weighings shows the trend.')
  })
})

describe('gain words', () => {
  it('writes grams first with the ounce beside it on a pounds phone', () => {
    expect(formatGrams(22.7, 'lb')).toBe('+23 g (0.8 oz)')
    expect(formatGrams(-34, 'lb')).toBe('−34 g (1.2 oz)')
    expect(formatGrams(0.3, 'lb')).toBe('0 g')
    expect(formatGrams(140, 'kg')).toBe('+140 g')
    expect(formatPerDay(19.8, 'lb')).toBe('+20 g/day (0.7 oz)')
    expect(formatPerDay(20, 'kg')).toBe('+20 g/day')
    // under a twentieth of an ounce the ounce part is left out, never "(0 oz)"
    expect(formatGrams(1, 'lb')).toBe('+1 g')
    expect(formatGrams(-1.2, 'lb')).toBe('−1 g')
    expect(formatGrams(3, 'lb')).toBe('+3 g (0.1 oz)')
    expect(formatPerDay(1.2, 'lb')).toBe('+1 g/day')
  })
  it('judges the week against the doctor’s goal, or the typical band without one', () => {
    expect(gainVerdict(weightGain(weights, 'lb', birth, 20), 'lb')).toBe("On the doctor's 20 g/day: +20 g/day (0.7 oz) over the last 8 days.")
    expect(gainVerdict(weightGain(weights, 'lb', birth, 30), 'lb')).toBe("Below the doctor's 30 g/day: +20 g/day (0.7 oz) over the last 8 days, 10 g/day short.")
    expect(gainVerdict(weightGain(weights, 'lb', birth, null), 'lb')).toBe('+20 g/day (0.7 oz) over the last 8 days, below the typical 21–29 g/day for this age.')
    expect(gainVerdict(weightGain(weights.slice(1), 'lb', birth, null), 'lb')).toBe('+23 g/day (0.8 oz) since yesterday, within the typical 21–29 g/day for this age.')
    expect(gainVerdict(weightGain(weights.slice(2), 'lb', birth, null), 'lb')).toBeNull()
    expect(gainRate(weightGain(weights, 'lb', birth, null))!.over).toBe('over the last 8 days')
  })
})

describe('checks: each weighing against the one before it', () => {
  // Grams as kilograms so the arithmetic reads plainly.
  const g = (id: number, date: string, grams: number, clock: string): Weight => ({ id, child: 1, date, weight: grams / 1000, notes: clock, tags: [] })
  it('starts each target from the last check, so a slow start is not carried forward', () => {
    // 200 g behind any line from the first weighing, then +25, +10, +30 g a day.
    const rows = [g(1, '2026-10-01', 2500, '9:00 AM'), g(2, '2026-10-10', 2500, '9:00 AM'), g(3, '2026-10-11', 2525, '9:00 AM'), g(4, '2026-10-12', 2535, '9:00 AM'), g(5, '2026-10-13', 2565, '9:00 AM')]
    const checks = weightChecks(rows, 'kg', 20, new Date('2026-10-10T00:00:00'))
    expect(checks.map((c) => c.met)).toEqual([true, false, true])
    expect(checks[0].needed).toBeCloseTo(20, 6)
    expect(checks[0].targetY).toBeCloseTo(2.52, 6)
    expect(checks[1].fromY).toBeCloseTo(2.525, 6)
    expect(checkDetail(checks[0])).toBe('needed +20 g · met')
    expect(checkDetail(checks[1])).toBe('needed +20 g · 10 g short')
    expect(checkTally(checks)).toEqual({ met: 2, of: 3, missedInRow: 0 })
  })
  it('takes the latest weighing of a day and counts the hours between timed checks', () => {
    const rows = [g(1, '2026-10-18', 2620, '1:44 PM'), g(2, '2026-10-19', 2600, '6:00 AM'), g(3, '2026-10-19', 2684, '9:59 AM')]
    const [c] = weightChecks(rows, 'kg', 20)
    expect(c.days).toBeCloseTo(20.25 / 24, 3)
    expect(Math.round(c.needed)).toBe(17)
    expect(c.met).toBe(true)
    // Without a clock on either, whole days.
    const [d] = weightChecks([{ ...rows[0], notes: '' }, rows[2]], 'kg', 20)
    expect(d.days).toBe(1)
  })
  it('counts misses in a row from the newest back', () => {
    const rows = [2500, 2530, 2531, 2532, 2533].map((v, i) => g(i + 1, `2026-10-1${i}`, v, '9:00 AM'))
    expect(checkTally(weightChecks(rows, 'kg', 20))).toEqual({ met: 1, of: 4, missedInRow: 3 })
  })
  it('holds checks to the doctor’s goal, else the low end of typical, and nothing for a newborn', () => {
    expect(checkRate(weightGain(weights, 'lb', birth, 20))).toEqual({ gramsPerDay: 20, label: '20 g/day', kind: 'goal' })
    expect(checkRate(weightGain(weights, 'lb', birth, null))).toEqual({ gramsPerDay: 21, label: 'typical 21 g/day', kind: 'typical' })
    expect(checkRate(weightGain([w(1, '2026-09-20', 5.0)], 'lb', birth, null))).toBeNull()
  })
})

describe('the gain since the goal was given', () => {
  // Grams as kilograms: the doctor said 20 g/day on Friday Oct 9; before that, tube feeds in the NICU.
  const g = (id: number, date: string, grams: number, clock: string): Weight => ({ id, child: 1, date, weight: grams / 1000, notes: clock, tags: [] })
  const nicu = [g(1, '2026-09-22', 2500, '9:00 AM'), g(2, '2026-10-01', 2350, '9:00 AM'), g(3, '2026-10-05', 2339, '9:00 AM')]
  const since = [g(4, '2026-10-09', 2403, '1:00 AM'), g(5, '2026-10-09', 2410, '9:03 AM'), g(6, '2026-10-10', 2438, '8:40 PM'), g(7, '2026-10-11', 2452, '10:36 AM'), g(8, '2026-10-12', 2431, '6:13 PM')]

  it('counts only the weighings from that day, as a line through all of them', () => {
    const r = weightGain([...nicu, ...since], 'kg', birth, 20, undefined, '2026-10-09')
    expect(r.sinceGoal).toMatchObject({ weighings: 5, early: true })
    expect(Math.round(r.sinceGoal!.grams)).toBe(28)
    expect(r.sinceGoal!.days).toBeCloseTo(3.7, 1)
    // The fitted rate sits between first-to-last (7.6 g/day) and what one heavy Sunday would suggest.
    expect(r.sinceGoal!.perDay).toBeGreaterThan(5)
    expect(r.sinceGoal!.perDay).toBeLessThan(15)
    expect(weekBesideGoal(r)).toBe(false)
  })
  it('says it is too early to judge for the first week, and judges after it', () => {
    const early = weightGain([...nicu, ...since], 'kg', birth, 20, undefined, '2026-10-09')
    expect(gainVerdict(early, 'kg')).toMatch(/since Oct 9 \(5 weighings over 3\.5 days\)\. Too early to judge against the doctor's 20 g\/day: .* settles from Oct 16\.$/)
    const later = weightGain([...nicu, ...since, g(9, '2026-10-16', 2580, '9:00 AM')], 'kg', birth, 20, undefined, '2026-10-09')
    expect(later.sinceGoal!.early).toBe(false)
    expect(gainVerdict(later, 'kg')).toMatch(/^On the doctor's 20 g\/day: \+2\d g\/day since Oct 9/)
    const slow = weightGain([...nicu, ...since, g(9, '2026-10-16', 2470, '9:00 AM')], 'kg', birth, 20, undefined, '2026-10-09')
    expect(gainVerdict(slow, 'kg')).toMatch(/^Below the doctor's 20 g\/day: .* g\/day short\.$/)
  })
  it('falls back to the week without a day, a goal, or two weighings a day apart', () => {
    expect(weightGain([...nicu, ...since], 'kg', birth, 20).sinceGoal).toBeNull()
    expect(weightGain([...nicu, ...since], 'kg', birth, null, undefined, '2026-10-09').sinceGoal).toBeNull()
    const waiting = weightGain([...nicu, ...since], 'kg', birth, 20, undefined, '2026-10-12')
    expect(waiting.sinceGoal).toBeNull()
    expect(gainVerdict(waiting, 'kg')).toBe("The doctor's 20 g/day counts from Oct 12; it is measured once two weighings a day apart are in since then.")
    expect(weekBesideGoal(waiting)).toBe(true)
    expect(weightGain([...nicu, ...since], 'kg', birth, 20, undefined, 'soon').sinceGoal).toBeNull()
    expect(gainVerdict(weightGain([...nicu, ...since], 'kg', birth, 20), 'kg')).toMatch(/over the last 7 days/)
  })
  it('keeps the week beside it once the goal is older than the week', () => {
    const r = weightGain([...nicu, ...since], 'kg', birth, 20, undefined, '2026-09-22')
    expect(weekBesideGoal(r)).toBe(true)
  })
})

describe('born early', () => {
  it('has no age-typical band while held, keeps the doctor’s goal, and says why', () => {
    const held = ageBasis({ birth_date: birth }, { bornAtDays: 196, nicu: { since: birth, home: null } })
    const g = weightGain(weights, 'lb', held, null)
    expect(g.typicalPerDay).toBeNull()
    expect(g.held).toBe('nicu')
    expect(gainVerdict(g, 'lb')).toMatch(/Not compared with age norms while in the NICU\.$/)
    expect(checkRate(g)).toBeNull()
    expect(checkRate(weightGain(weights, 'lb', held, 20))?.gramsPerDay).toBe(20)
  })
})
