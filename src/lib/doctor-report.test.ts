import { describe, expect, it } from 'vitest'
import type { Child } from './api/types'
import { buildDoctorReport, reportText } from './doctor-report'
import type { EventSets } from './events'
import { DEFAULT_UNITS } from './units'

const now = new Date('2026-10-09T15:00:00')
const child = { id: 1, first_name: 'Ada', birth_date: '2026-09-18' } as Child
const iso = (d: string) => new Date(d).toISOString()
const empty: EventSets = { sleep: [], feedings: [], changes: [], pumping: [], tummy: [], temperature: [], medication: [], notes: [], activities: [], milestones: [], contractions: [] }
const events: EventSets = {
  ...empty,
  feedings: [
    { id: 1, child: 1, start: iso('2026-10-09T06:00:00'), end: iso('2026-10-09T06:00:00'), type: 'breast milk', method: 'bottle', amount: 2, duration: '00:00:00', notes: '', tags: [] },
    { id: 2, child: 1, start: iso('2026-10-09T09:00:00'), end: iso('2026-10-09T09:20:00'), type: 'breast milk', method: 'both breasts', amount: null, duration: '00:20:00', notes: '', tags: [] },
    { id: 3, child: 1, start: iso('2026-10-08T07:00:00'), end: iso('2026-10-08T07:00:00'), type: 'formula', method: 'bottle', amount: 3, duration: '00:00:00', notes: '', tags: [] },
    { id: 4, child: 1, start: iso('2026-10-08T12:00:00'), end: iso('2026-10-08T12:00:00'), type: 'solid food', method: 'parent fed', amount: null, duration: '00:00:00', notes: '', tags: [] },
  ] as EventSets['feedings'],
  changes: [
    { id: 1, child: 1, time: iso('2026-10-09T07:00:00'), wet: true, solid: false, color: '', amount: null, notes: '', tags: [] },
    { id: 2, child: 1, time: iso('2026-10-09T12:00:00'), wet: true, solid: true, color: 'yellow', amount: null, notes: '', tags: [] },
    { id: 3, child: 1, time: iso('2026-10-08T12:00:00'), wet: true, solid: false, color: '', amount: null, notes: '', tags: [] },
  ] as EventSets['changes'],
  sleep: [{ id: 1, child: 1, start: iso('2026-10-09T01:00:00'), end: iso('2026-10-09T04:00:00'), nap: false, duration: '03:00:00', notes: '', tags: [] }] as EventSets['sleep'],
  pumping: [{ id: 1, child: 1, start: iso('2026-10-09T08:00:00'), end: iso('2026-10-09T08:20:00'), amount: 3, duration: '00:20:00', notes: '', tags: [] }] as EventSets['pumping'],
  temperature: [{ id: 1, child: 1, temperature: 99.1, time: iso('2026-10-08T13:00:00'), notes: '', tags: [] }, { id: 2, child: 1, temperature: 101.5, time: iso('2026-09-20T13:00:00'), notes: '', tags: [] }],
  medication: [{ id: 1, child: 1, name: 'Vitamin D', dosage: 1, dosage_unit: 'drop', time: iso('2026-10-09T08:30:00'), next_dose_interval: null, next_dose_time: null, notes: '', tags: [] }] as EventSets['medication'],
}
const growth = {
  weights: [
    { id: 1, child: 1, date: '2026-10-01', weight: 5.0, notes: '9:00 AM', tags: [] },
    { id: 2, child: 1, date: '2026-10-09', weight: 5.35, notes: '9:00 AM', tags: [] },
  ],
  heights: [{ id: 3, child: 1, date: '2026-10-01', height: 18.3, notes: '', tags: [] }],
  heads: [],
} as never

describe('buildDoctorReport', () => {
  const r = buildDoctorReport(events, growth, child, DEFAULT_UNITS, 'female', 20, 7, now)
  it('heads with the child and the range', () => {
    expect(r.child).toEqual({ name: 'Ada', birthDate: 'Sep 18, 2026', age: '3 wk', sex: 'female' })
    expect(r.range.days).toBe(7)
    expect(r.days).toHaveLength(7)
    expect(r.days[6].date.getDate()).toBe(9)
  })
  it('leads with growth: value, date, percentile, change in both units, gain per day against the goal', () => {
    expect(r.growth.map((g) => g.key)).toEqual(['weight', 'height'])
    expect(r.growth[0]).toMatchObject({ value: '5 lb 6 oz', date: 'Oct 9, 2026', change: '+5.6 oz (159 g) since Oct 1' })
    expect(r.growth[0].percentile).toMatch(/percentile/)
    expect(r.growth[1].change).toBeNull()
    expect(r.gain).toEqual({ sinceLast: '+159 g (5.6 oz) since Oct 1', week: '+159 g (5.6 oz) over the last 8 days', sinceGoal: null, perDay: '+20 g/day (0.7 oz)', verdict: "On the doctor's 20 g/day: +20 g/day (0.7 oz) over the last 8 days.", goal: 20 })
  })
  it('counts the gain from the day the goal was given, when it is recorded', () => {
    const since = buildDoctorReport(events, growth, child, DEFAULT_UNITS, 'female', 20, 7, now, '2026-10-01')
    expect(since.gain).toMatchObject({ sinceGoal: '+159 g (5.6 oz) since the goal was given on Oct 1 (2 weighings over 8 days)', perDay: '+20 g/day (0.7 oz)' })
    expect(since.gain!.verdict).toMatch(/^On the doctor's 20 g\/day: \+20 g\/day \(0\.7 oz\) since Oct 1/)
    expect(reportText(since)).toContain('Gain: +159 g (5.6 oz) since the goal was given on Oct 1')
  })
  it('averages over the whole days that carry each kind, with the age-typical band', () => {
    // A day later, Oct 8 and Oct 9 are both whole days.
    const next = buildDoctorReport(events, growth, child, DEFAULT_UNITS, 'female', 20, 7, new Date('2026-10-10T15:00:00'))
    expect(next.range.wholeDays).toBe(6)
    const by = Object.fromEntries(next.averages.map((a) => [a.key, a]))
    expect(by.feeds).toMatchObject({ value: '1.5', loggedDays: 2 }) // Oct 9: 2 milk feeds (solids do not count); Oct 8: 1
    expect(by.feeds.typical).toMatch(/\d+–\d+/)
    expect(by.bottle).toMatchObject({ value: '2.5 oz', loggedDays: 2 })
    // A day's nursing minutes carry no band: the science's band is minutes a side per feed.
    expect(by.nursing).toMatchObject({ value: '20 min', loggedDays: 1, typical: null })
    expect(by.wet).toMatchObject({ value: '1.5', loggedDays: 2 })
    // Oct 8 had a diaper and no dirty one: a day of zero dirty, not a day left out.
    expect(by.dirty).toMatchObject({ value: '0.5', loggedDays: 2 })
    expect(by.sleep).toMatchObject({ value: '3h', loggedDays: 1 })
    expect(by.pumped).toMatchObject({ value: '3 oz', loggedDays: 1, typical: null })
    expect(by.naps).toBeUndefined()
  })
  it('leaves today, still in progress, out of the averages but keeps it in the table', () => {
    const by = Object.fromEntries(r.averages.map((a) => [a.key, a]))
    expect(r.range.wholeDays).toBe(6)
    expect(by.feeds).toMatchObject({ value: '1', loggedDays: 1 }) // Oct 8 only; Oct 9's two so far are not a day
    expect(by.wet).toMatchObject({ value: '1', loggedDays: 1 })
    expect(by.dirty).toMatchObject({ value: '0', loggedDays: 1 })
    expect(by.sleep).toBeDefined()
    expect(r.days[6]).toMatchObject({ feeds: 2, wet: 2, dirty: 1 })
    // 8 feeds a day on Oct 3–8 and 2 by 7 AM on Oct 9: 8 a day, not 7.1
    const feedings = [] as EventSets['feedings']
    let id = 1
    const feed = (d: number, h: number) => ({ id: id++, child: 1, start: iso(`2026-10-0${d}T${String(h).padStart(2, '0')}:00:00`), end: iso(`2026-10-0${d}T${String(h).padStart(2, '0')}:00:00`), type: 'breast milk', method: 'bottle', amount: 3, duration: '00:00:00', notes: '', tags: [] }) as EventSets['feedings'][number]
    for (let d = 3; d <= 8; d++) for (let k = 0; k < 8; k++) feedings.push(feed(d, 1 + k * 3))
    feedings.push(feed(9, 1), feed(9, 4))
    const morning = buildDoctorReport({ ...empty, feedings }, undefined, child, DEFAULT_UNITS, null, null, 7, new Date('2026-10-09T07:00:00'))
    expect(morning.averages.find((a) => a.key === 'feeds')).toMatchObject({ value: '8', loggedDays: 6 })
  })
  it('averages dirty diapers over every day with a diaper and naps over every day with sleep', () => {
    // Oct 3–9: six wet diapers a day, one dirty on Oct 3 only; a nap on Oct 3 only, night sleep every day.
    const changes = [] as EventSets['changes']
    const sleep = [] as EventSets['sleep']
    let id = 1
    for (let d = 3; d <= 9; d++) {
      for (let k = 0; k < 6; k++) changes.push({ id: id++, child: 1, time: iso(`2026-10-0${d}T${String(6 + k * 2).padStart(2, '0')}:00:00`), wet: true, solid: d === 3 && k === 0, color: '', amount: null, notes: '', tags: [] } as EventSets['changes'][number])
      sleep.push({ id: id++, child: 1, start: iso(`2026-10-0${d}T00:30:00`), end: iso(`2026-10-0${d}T05:30:00`), nap: false, duration: '05:00:00', notes: '', tags: [] } as EventSets['sleep'][number])
    }
    sleep.push({ id: id++, child: 1, start: iso('2026-10-03T13:00:00'), end: iso('2026-10-03T14:00:00'), nap: true, duration: '01:00:00', notes: '', tags: [] } as EventSets['sleep'][number])
    const rep = buildDoctorReport({ ...empty, changes, sleep }, undefined, child, DEFAULT_UNITS, null, null, 7, new Date('2026-10-10T08:00:00'))
    const by = Object.fromEntries(rep.averages.map((a) => [a.key, a]))
    expect(by.dirty).toMatchObject({ value: '0', loggedDays: 6 }) // Oct 4–9 (Oct 3 is outside the 6 whole days): no dirty one
    expect(by.naps).toBeUndefined() // no nap in those days
    expect(by.wet).toMatchObject({ value: '6', loggedDays: 6 })
    const rep8 = buildDoctorReport({ ...empty, changes, sleep }, undefined, child, DEFAULT_UNITS, null, null, 8, new Date('2026-10-10T08:00:00'))
    const by8 = Object.fromEntries(rep8.averages.map((a) => [a.key, a]))
    expect(by8.dirty).toMatchObject({ value: '0.1', loggedDays: 7 }) // 1 dirty over Oct 3–9
    expect(by8.naps).toMatchObject({ value: '0.1', loggedDays: 7 })
  })
  it('lists only the health entries inside the range', () => {
    expect(r.temperatures).toHaveLength(1)
    expect(r.temperatures[0]).toMatchObject({ value: '99.1°F', level: 'normal' })
    expect(r.medicines).toEqual([{ at: new Date('2026-10-09T08:30:00'), name: 'Vitamin D', dose: '1 drop' }])
  })
  it('renders as plain text for sharing', () => {
    const text = reportText(r)
    expect(text).toContain('Ada · born Sep 18, 2026 · 3 wk · girl')
    expect(text).toContain('Weight: 5 lb 6 oz on Oct 9, 2026')
    expect(text).toContain('Per day: +20 g/day (0.7 oz) (goal 20 g/day)')
    expect(text).toContain('Feeds a day: 1 (typical')
    expect(text).toContain('Oct 9 · 2 · 2 oz · 2/1 · 3h · 3 oz')
    expect(text).toContain('Oct 3 · 0 · – · 0/0 · – · –')
    expect(text).toContain('Vitamin D 1 drop')
  })
  it('counts the calories by bottle, per kg by the weighing that applied, against the doctor goal', () => {
    const fed = { ...events, feedings: [...events.feedings, { id: 5, child: 1, start: iso('2026-10-08T15:00:00'), end: iso('2026-10-08T15:00:00'), type: 'fortified breast milk', method: 'bottle', amount: 2, duration: '00:00:00', notes: '', tags: ['kcal:24'] }] as EventSets['feedings'] }
    const rep = buildDoctorReport(fed, growth, child, DEFAULT_UNITS, 'female', 20, 7, now, null, child.birth_date, { goal: 120, fortify: null })
    const oct8 = rep.days.find((d) => d.date.getDate() === 8)!
    // 3 oz of formula at 20 and 2 oz fortified to 24: 108 kcal, over 5 lb (2.27 kg) from Oct 1
    expect(oct8.kcal).toBeCloseTo(108, 5)
    expect(oct8.kcalPerKg).toBeCloseTo(108 / 2.268, 0)
    const avg = rep.averages.find((a) => a.key === 'kcalkg')!
    expect(avg.label).toBe('kcal per kg a day (goal 120)')
    expect(avg.value).toBe('48')
    expect(rep.averages.find((a) => a.key === 'kcal')?.value).toBe('108 kcal')
  })
  it('copes with no growth and an expecting child', () => {
    const bare = buildDoctorReport(empty, undefined, child, DEFAULT_UNITS, null, null, 14, now)
    expect(bare.growth).toEqual([])
    expect(bare.gain).toBeNull()
    expect(bare.averages.map((a) => a.key)).toEqual(['feeds', 'wet', 'dirty', 'sleep'])
    expect(buildDoctorReport(empty, undefined, { ...child, birth_date: '2026-12-01' } as Child, DEFAULT_UNITS, null, null, 7, now).averages).toEqual([])
  })
})
