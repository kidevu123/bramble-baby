import { describe, expect, it } from 'vitest'
import type { Child } from './api/types'
import type { EventSets, TimelineItem } from './events'
import { ageMonthsOn, bandStatus, dayExtras, dayLog, dayGlance, growthChange, growthPercentile, growthPercentileLabel, rangeOverview } from './reports'
import { ageBasis } from './preterm'
import { DEFAULT_UNITS } from './units'

const now = new Date('2026-10-08T15:00:00')
const child = { id: 1, first_name: 'Oscar', birth_date: '2026-09-18' } as Child
const iso = (d: string) => new Date(d).toISOString()
const empty: EventSets = { sleep: [], feedings: [], changes: [], pumping: [], tummy: [], temperature: [], medication: [], notes: [], activities: [], milestones: [], contractions: [] }

function sampleDay(day: string): Partial<EventSets> {
  return {
    sleep: [
      { id: 1, child: 1, start: iso(`${day}T01:00:00`), end: iso(`${day}T04:00:00`), nap: false, duration: '03:00:00', notes: '', tags: [] },
      { id: 2, child: 1, start: iso(`${day}T10:00:00`), end: iso(`${day}T11:30:00`), nap: true, duration: '01:30:00', notes: '', tags: [] },
    ] as EventSets['sleep'],
    feedings: [
      { id: 1, child: 1, start: iso(`${day}T06:00:00`), end: iso(`${day}T06:00:00`), type: 'breast milk', method: 'bottle', amount: 2, duration: '00:00:00', notes: '', tags: [] },
      { id: 2, child: 1, start: iso(`${day}T09:00:00`), end: iso(`${day}T09:18:00`), type: 'breast milk', method: 'both breasts', amount: null, duration: '00:18:00', notes: '', tags: [] },
    ] as EventSets['feedings'],
    changes: [
      { id: 1, child: 1, time: iso(`${day}T07:00:00`), wet: true, solid: false, color: '', amount: null, notes: '', tags: [] },
      { id: 2, child: 1, time: iso(`${day}T12:00:00`), wet: true, solid: true, color: 'yellow', amount: null, notes: '', tags: [] },
    ] as EventSets['changes'],
    pumping: [{ id: 1, child: 1, start: iso(`${day}T08:00:00`), end: iso(`${day}T08:20:00`), amount: 3, duration: '00:20:00', notes: '', tags: [] }] as EventSets['pumping'],
  }
}

function merge(days: string[]): EventSets {
  const out: EventSets = { ...empty, sleep: [], feedings: [], changes: [], pumping: [] }
  days.forEach((d, i) => {
    const s = sampleDay(d)
    const bump = <T extends { id: number }>(list: T[]) => list.map((x) => ({ ...x, id: x.id + i * 10 }))
    out.sleep.push(...bump(s.sleep!))
    out.feedings.push(...bump(s.feedings!))
    out.changes.push(...bump(s.changes!))
    out.pumping.push(...bump(s.pumping!))
  })
  return out
}

describe('bandStatus', () => {
  it('reads a value against a band with grace', () => {
    expect(bandStatus(15, [14, 17])).toBe('typical')
    expect(bandStatus(13.7, [14, 17], 0.5)).toBe('typical')
    expect(bandStatus(12, [14, 17], 0.5)).toBe('low')
    expect(bandStatus(18, [14, 17])).toBe('high')
  })
})

describe('dayGlance', () => {
  const events = merge(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'])
  it('gives four tiles for a past day with the day total, the week usual and a status', () => {
    const tiles = dayGlance(events, child, DEFAULT_UNITS, new Date('2026-10-07T00:00:00'), now)
    expect(tiles.map((t) => t.key)).toEqual(['sleep', 'feeds', 'diapers', 'pumping'])
    const [sleep, feeds, diapers, pumping] = tiles
    expect(sleep.value).toBe('4h 30m')
    expect(sleep.usual).toBe('4h 30m') // the two days before it, both logged
    expect(sleep.status).toBe('low') // a 3-week-old typically sleeps 14–17h
    expect(feeds.value).toBe('2')
    expect(feeds.detail).toBe('2 oz by bottle')
    expect(diapers.detail).toBe('2 wet · 1 poo')
    expect(pumping.value).toBe('3 oz')
    expect(pumping.status).toBe('none')
  })
  it('judges today by the last 24 h of sleep and the hours elapsed', () => {
    const [sleep, feeds] = dayGlance(events, child, DEFAULT_UNITS, now, now)
    expect(sleep.label).toBe('Sleep, last 24 h')
    expect(sleep.value).toBe('4h 30m')
    expect(feeds.status).toBe('low') // 2 feeds by 3 PM, typical 8–12 a day
  })
  it('says dash and none with nothing logged', () => {
    const [sleep, feeds, , pumping] = dayGlance(empty, child, DEFAULT_UNITS, new Date('2026-10-01T00:00:00'), now)
    expect(sleep.value).toBe('—')
    expect(sleep.usual).toBeNull()
    expect(feeds.status).toBe('low') // a whole past day with no feeds is below typical
    expect(pumping.detail).toBe('none logged')
  })
  it('is empty while expecting', () => {
    expect(dayGlance(empty, { ...child, birth_date: '2026-12-01' }, DEFAULT_UNITS, now, now)).toEqual([])
    expect(rangeOverview(empty, { ...child, birth_date: '2026-12-01' }, DEFAULT_UNITS, [now], now)).toEqual([])
  })
  it('judges a past day against the age the child had that day', () => {
    // Born Sep 18; Sep 19 is day 1, when 1–2 wet diapers are typical (today, day 20, it would be 6–8).
    const day = new Date('2026-09-19T00:00:00')
    const ev = { ...empty, changes: [1, 2].map((i) => ({ id: i, child: 1, time: new Date(2026, 8, 19, 6 * i).toISOString(), wet: true, solid: false, color: '', amount: null, notes: '', tags: [] })) } as EventSets
    const diapers = dayGlance(ev, child, DEFAULT_UNITS, day, now)[2]
    expect(diapers.status).toBe('typical')
    expect(diapers.typical).toContain('1–2 wet')
  })
})

describe('dayGlance with the report day start', () => {
  const feed = (id: number, at: string) => ({ id, child: 1, start: iso(at), end: iso(at), duration: '00:00:00', type: 'breast milk', method: 'bottle', amount: 3, notes: '', tags: [] }) as EventSets['feedings'][number]
  const events: EventSets = { ...empty, feedings: [feed(1, '2026-10-08T02:00:00'), feed(2, '2026-10-07T10:00:00')], changes: [{ id: 1, child: 1, time: iso('2026-10-08T07:30:00'), wet: true, solid: false, color: '', amount: null, notes: '', tags: [] }] as EventSets['changes'] }
  it('counts the same 8 AM–8 AM day the strip draws', () => {
    const oct7 = new Date('2026-10-07T00:00:00')
    const at8 = dayGlance(events, child, DEFAULT_UNITS, oct7, now, 8)
    expect(at8.find((g) => g.key === 'feeds')?.value).toBe('2') // 10 AM Oct 7 and 2 AM Oct 8 both sit in Oct 7's 8 AM–8 AM
    expect(at8.find((g) => g.key === 'diapers')?.value).toBe('1')
    const midnight = dayGlance(events, child, DEFAULT_UNITS, oct7, now)
    expect(midnight.find((g) => g.key === 'feeds')?.value).toBe('1') // midnight to midnight by default
    expect(midnight.find((g) => g.key === 'diapers')?.value).toBe('—')
  })
  it('treats the window holding now as today', () => {
    const early = new Date('2026-10-08T06:00:00')
    // At 6 AM on Oct 8 with days from 8 AM, Oct 7's window is the one in progress
    expect(dayGlance(events, child, DEFAULT_UNITS, new Date('2026-10-07T00:00:00'), early, 8)[0].label).toBe('Sleep, last 24 h')
    expect(dayGlance(events, child, DEFAULT_UNITS, new Date('2026-10-07T00:00:00'), early)[0].label).toBe('Sleep')
  })
  it('lists the extras of the same window', () => {
    const temp: EventSets = { ...empty, temperature: [{ id: 1, child: 1, temperature: 99.1, time: iso('2026-10-08T03:00:00'), notes: '', tags: [] }] }
    expect(dayExtras(temp, undefined, child, DEFAULT_UNITS, null, new Date('2026-10-07T00:00:00'), now, 8).map((e) => e.key)).toEqual(['temperature'])
    expect(dayExtras(temp, undefined, child, DEFAULT_UNITS, null, new Date('2026-10-07T00:00:00'), now)).toEqual([])
  })
})

describe('growthPercentile', () => {
  it('takes the age from the entry’s own date, whatever its clock, so every screen agrees', () => {
    const morning = { id: 1, child: 1, date: '2026-10-08', height: 20.5, notes: '6:00 AM', tags: [] }
    const evening = { ...morning, notes: '11:00 PM' }
    const p = growthPercentile(morning, '2026-09-18', 'male', DEFAULT_UNITS)
    expect(p).toBe(growthPercentile(evening, '2026-09-18', 'male', DEFAULT_UNITS))
    expect(ageMonthsOn('2026-10-08', '2026-09-18')).toBeCloseTo(20 / 30.4375, 6)
    expect(growthPercentileLabel(morning, '2026-09-18', 'male', DEFAULT_UNITS)).toMatch(/^\d+(st|nd|rd|th) pct$/)
    expect(growthPercentile(morning, '2026-09-18', null, DEFAULT_UNITS)).toBeNaN()
    expect(growthPercentileLabel(morning, '2026-09-18', null, DEFAULT_UNITS)).toBe('')
    // the weight converts from the phone's unit
    const lb = growthPercentile({ id: 2, child: 1, date: '2026-10-08', weight: 7.9, notes: '', tags: [] }, '2026-09-18', 'female', DEFAULT_UNITS)
    const kg = growthPercentile({ id: 2, child: 1, date: '2026-10-08', weight: 7.9 * 0.45359237, notes: '', tags: [] }, '2026-09-18', 'female', { ...DEFAULT_UNITS, weight: 'kg' })
    expect(lb).toBeCloseTo(kg, 5)
  })
})

describe('rangeOverview', () => {
  const days = ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']
  const events = merge(days.slice(2))
  it('averages over the days that have data and keeps one point per day for the sparkline', () => {
    const rows = rangeOverview(events, child, DEFAULT_UNITS, days.map((d) => new Date(`${d}T00:00:00`)), now)
    expect(rows.map((r) => r.key)).toEqual(['sleep', 'feeds', 'diapers', 'pumping'])
    expect(rows[0].series).toHaveLength(7)
    expect(rows[0].series.slice(0, 2)).toEqual([0, 0])
    expect(rows[0].average).toBe('4h 30m')
    expect(rows[0].status).toBe('low')
    expect(rows[1].average).toBe('2')
    expect(rows[1].unit).toBe('feeds a day · 2 oz by bottle')
    expect(rows[3].unit).toBe('a day · 15 oz in all')
    expect(rows[3].note).toBe('5 of 7 days with a session.')
  })
  it('says so when a category has nothing', () => {
    const rows = rangeOverview(empty, child, DEFAULT_UNITS, days.map((d) => new Date(`${d}T00:00:00`)), now)
    expect(rows.every((r) => r.average === '—')).toBe(true)
    expect(rows[0].note).toBe('No sleep logged in this range.')
  })
})

describe('dayExtras', () => {
  const growthRaw = {
    weights: [
      { id: 1, child: 1, date: '2026-10-01', weight: 7.4, notes: '8:30 AM', tags: [] },
      { id: 2, child: 1, date: '2026-10-07', weight: 7.9, notes: '8:40 AM', tags: [] },
    ],
    heights: [{ id: 3, child: 1, date: '2026-10-01', height: 20.5, notes: '', tags: [] }],
    heads: [],
  }
  const growth = growthRaw as never
  it('reads growth change in the small unit and names the date', () => {
    expect(growthChange(7.9, 7.4, 'lb', new Date('2026-10-01T08:30:00'))).toBe('+8 oz (227 g) since Oct 1')
    expect(growthChange(3.6, 3.3, 'kg', new Date('2026-10-01T08:30:00'))).toBe('+300 g (10.6 oz) since Oct 1')
    // Two weighings on the same day name the time, and below the small unit's resolution is no change.
    expect(growthChange(7.9, 7.4, 'lb', new Date('2026-10-08T08:38:00'), new Date('2026-10-08T20:00:00'))).toBe('+8 oz (227 g) since 8:38 AM')
    expect(growthChange(7.001, 7, 'lb', new Date('2026-10-01T08:30:00'))).toBe('no change since Oct 1')
    expect(growthChange(7.0, 7.0, 'lb', new Date('2026-10-01T08:30:00'))).toBe('no change since Oct 1')
    expect(growthChange(6.5, 7.9, 'lb', new Date('2026-10-01T08:30:00'))).toBe('−1.4 lb (635 g) since Oct 1')
    // a gram on a kilograms phone has no ounce to show: never "(0 oz)"
    expect(growthChange(4.0006, 4.0, 'kg', new Date('2026-10-01T08:30:00'))).toBe('+1 g since Oct 1')
  })
  it('shows only what was measured on the day, with the change since the measurement before', () => {
    const oct7 = dayExtras(empty, growth, child, DEFAULT_UNITS, null, new Date('2026-10-07T12:00:00'), now)
    expect(oct7.map((r) => r.key)).toEqual(['weight'])
    expect(oct7[0].value).toBe('7 lb 14 oz')
    expect(oct7[0].detail).toBe('Oct 7 · +8 oz (227 g) since Oct 1')
    const oct1 = dayExtras(empty, growth, child, DEFAULT_UNITS, null, new Date('2026-10-01T12:00:00'), now)
    expect(oct1.map((r) => r.key)).toEqual(['weight', 'height'])
    expect(oct1[1].detail).toBe('Oct 1')
    // A day with no measurement has no growth rows: not the last height from days before (2026-10-12).
    expect(dayExtras(empty, growth, child, DEFAULT_UNITS, null, now, now)).toEqual([])
    expect(dayExtras(empty, growth, child, DEFAULT_UNITS, null, new Date('2026-10-03T12:00:00'), now)).toEqual([])
  })
  it('follows the day being looked at, not today', () => {
    const later = { ...growthRaw, weights: [...growthRaw.weights, { id: 4, child: 1, date: '2026-10-08', weight: 8.0, notes: '9:00 AM', tags: [] }] } as never
    expect(dayExtras(empty, later, child, DEFAULT_UNITS, null, now, now)[0].detail).toBe('Oct 8 · +1.6 oz (45 g) since Oct 7')
    expect(dayExtras(empty, later, child, DEFAULT_UNITS, null, new Date('2026-10-07T12:00:00'), now)[0].detail).toBe('Oct 7 · +8 oz (227 g) since Oct 1')
    expect(dayExtras(empty, later, child, DEFAULT_UNITS, null, new Date('2026-09-25T12:00:00'), now)).toEqual([])
  })
  it('adds a WHO percentile when the sex is set', () => {
    const rows = dayExtras(empty, growth, child, DEFAULT_UNITS, 'male', new Date('2026-10-07T12:00:00'), now)
    expect(rows[0].detail).toMatch(/pct$/)
  })
  it('adds the day’s temperature, medicine, tummy time, solids and activities only when logged', () => {
    const events: EventSets = {
      ...empty,
      temperature: [{ id: 1, child: 1, temperature: 99.1, time: iso('2026-10-08T13:00:00'), notes: '', tags: [] }],
      medication: [{ id: 1, child: 1, name: 'Tylenol', dosage: 2.5, dosage_unit: 'ml', time: iso('2026-10-08T13:10:00'), next_dose_interval: null, next_dose_time: null, notes: '', tags: [] }] as EventSets['medication'],
      tummy: [{ id: 1, child: 1, start: iso('2026-10-08T10:00:00'), end: iso('2026-10-08T10:12:00'), duration: '00:12:00', milestone: '', tags: [] }],
      feedings: [{ id: 9, child: 1, start: iso('2026-10-08T12:00:00'), end: iso('2026-10-08T12:00:00'), type: 'solid food', method: 'parent fed', amount: null, duration: '00:00:00', notes: 'Foods: banana, avocado', tags: [] }] as EventSets['feedings'],
    }
    const rows = dayExtras(events, undefined, child, DEFAULT_UNITS, null, now, now)
    expect(rows.map((r) => r.key)).toEqual(['temperature', 'medicine', 'tummy', 'solids'])
    expect(rows[0].value).toBe('99.1°F')
    expect(rows[0].detail).toBe('1:00 PM · normal')
    expect(rows[1].value).toBe('1 dose')
    expect(rows[1].detail).toBe('Tylenol')
    expect(rows[2].value).toBe('12 min')
    expect(dayExtras(events, undefined, child, DEFAULT_UNITS, null, new Date('2026-10-07T00:00:00'), now)).toEqual([])
  })
})

describe('the day’s breakdown', () => {
  const item = (key: string, kind: TimelineItem['kind'], at: string): TimelineItem => ({ key, kind, at: new Date(at), end: null, title: kind, detail: '', raw: {} as never })
  const items = [
    item('f2', 'bottle', '2026-10-11T06:10:00'),
    item('d1', 'diaper', '2026-10-11T02:00:00'),
    item('f1', 'nursing', '2026-10-11T01:20:00'),
    item('p1', 'pumping', '2026-10-11T09:00:00'),
    item('f3', 'feeding', '2026-10-11T08:00:00'),
    item('m1', 'medicine', '2026-10-11T12:00:00'),
    item('w1', 'growth', '2026-10-11T09:00:00'), // shown in the rows above, not listed again
    item('x', 'bottle', '2026-10-10T23:50:00'), // the day before
    item('y', 'diaper', '2026-10-12T00:10:00'), // the day after
  ]
  it('groups the day oldest first, feeds and diapers before the rest, and leaves out empty groups', () => {
    const groups = dayLog(items, new Date('2026-10-11T00:00:00'))
    expect(groups.map((g) => g.key)).toEqual(['feeds', 'diapers', 'pumping', 'other'])
    expect(groups[0].items.map((i) => i.key)).toEqual(['f1', 'f2', 'f3'])
    expect(groups[3].title).toBe('Everything else')
    expect(groups[3].items.map((i) => i.key)).toEqual(['m1'])
  })
  it('names the longest gap between feeds, to spot one that was never logged', () => {
    const feeds = dayLog(items, new Date('2026-10-11T00:00:00'))[0]
    expect(feeds.longestGap?.seconds).toBe(4 * 3600 + 50 * 60)
    expect(feeds.longestGap?.from).toEqual(new Date('2026-10-11T01:20:00'))
    expect(dayLog(items, new Date('2026-10-11T00:00:00'))[1].longestGap).toBeNull() // one diaper: no gap
  })
  it('uses the same window as the tiles when the day starts at 7', () => {
    // 7 AM to 7 AM: the 8:00 feed, the pump, the medicine and the 12:10 AM diaper of the night after.
    expect(dayLog(items, new Date('2026-10-11T00:00:00'), 7).map((g) => [g.key, g.items.length])).toEqual([['feeds', 1], ['diapers', 1], ['pumping', 1], ['other', 1]])
  })
})

describe('born early (Settings › Born early)', () => {
  const events = merge(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'])
  // Born Sep 18 at 28 weeks: due Dec 11. In the NICU from the birth.
  const nicu = ageBasis(child, { bornAtDays: 196, nicu: { since: '2026-09-18', home: null } })
  it('shows the numbers but no verdict by age while held', () => {
    const tiles = dayGlance(events, child, DEFAULT_UNITS, new Date('2026-10-07T00:00:00'), now, 0, nicu)
    expect(tiles.map((t) => t.value)).toEqual(['4h 30m', '2', '2', '3 oz'])
    expect(tiles.every((t) => t.status === 'none' && t.typical === null)).toBe(true)
    const rows = rangeOverview(events, child, DEFAULT_UNITS, [new Date('2026-10-06T00:00:00'), new Date('2026-10-07T00:00:00')], now, nicu)
    expect(rows.every((r) => r.status === 'none')).toBe(true)
    expect(rows[1].note).toBe('2 feeds a day. Not compared with age norms while in the NICU.')
  })
  it('gives no WHO percentile before the due date and counts it from the due date after', () => {
    const w = { id: 1, child: 1, date: '2026-10-07', weight: 9, notes: null, tags: [] }
    expect(growthPercentile(w, nicu, 'male', DEFAULT_UNITS)).toBeNaN()
    const after = { ...w, date: '2027-01-11' } // a month after the due date, 4 months after the birth
    expect(growthPercentile(after, nicu, 'male', DEFAULT_UNITS)).toBe(growthPercentile({ ...after }, '2026-12-11', 'male', DEFAULT_UNITS))
    expect(growthPercentile(after, nicu, 'male', DEFAULT_UNITS)).toBeGreaterThan(growthPercentile(after, '2026-09-18', 'male', DEFAULT_UNITS))
  })
})
