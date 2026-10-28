import { describe, expect, it } from 'vitest'
import type { EventSets } from '../../lib/events'
import { averagedDays, barText, clock12, clockRange, diaperSplit, fullDayAverage, hourTick, keepToRange, LB_STEPS, lineDomain, niceTicks, ozRange, ozText, volumeRange, weightTick } from './format'
import { dayKey, dayOf, DEFAULT_VIEW, fetchDays, readView, writeView } from './view-state'

const day = (d: number) => new Date(2026, 9, d)

describe('clock12', () => {
  it('reads a bedtime band on the 12-hour clock', () => {
    expect(clock12('20:00')).toBe('8:00\u00a0PM')
    expect(clock12('07:30')).toBe('7:30\u00a0AM')
    expect(clock12('00:15')).toBe('12:15\u00a0AM')
    expect(clockRange(['20:00', '23:00'])).toBe('8–11\u00a0PM')
    expect(clockRange(['19:30', '21:00'])).toBe('7:30–9\u00a0PM')
    expect(clockRange(['11:00', '13:30'])).toBe('11\u00a0AM–1:30\u00a0PM')
  })
})

describe('ozText', () => {
  it('turns ounces into mL on a mL phone and leaves an oz phone alone', () => {
    expect(ozText('Around 2–3 oz every 3–4 hours', 'ml')).toBe('Around 60–90 mL every 3–4 hours')
    expect(ozText('capped near 32 oz.', 'ml')).toBe('capped near 950 mL.')
    expect(ozText('Around 2–3 oz every 3–4 hours', 'oz')).toBe('Around 2–3 oz every 3–4 hours')
    expect(ozText('1–2 teaspoons (5–20 mL)', 'ml')).toBe('1–2 teaspoons (5–20 mL)')
  })
})

describe('niceTicks', () => {
  it('puts every gridline on a round step that its label tells the truth about', () => {
    expect(niceTicks(3.3, 4, true)).toEqual({ top: 4, ticks: [0, 1, 2, 3, 4] })
    expect(niceTicks(9.9, 4, true).ticks).toEqual([0, 5, 10])
    expect(niceTicks(363, 4).ticks).toEqual([0, 100, 200, 300, 400])
    expect(niceTicks(102, 3).ticks).toEqual([0, 50, 100, 150])
    expect(niceTicks(4.1, 3).ticks).toEqual([0, 2, 4, 6])
  })
  it('keeps count axes on whole numbers even for tiny maxima', () => {
    expect(niceTicks(1, 4, true).ticks).toEqual([0, 1])
  })
})

describe('weightTick', () => {
  it('writes pounds as lb and oz, kg with one decimal', () => {
    expect(weightTick(8, 'lb')).toBe('8 lb')
    expect(weightTick(8.5, 'lb')).toBe('8 lb 8 oz')
    expect(weightTick(7.999, 'lb')).toBe('8 lb')
    expect(weightTick(3.72, 'kg')).toBe('3.7 kg')
  })
})

describe('hourTick', () => {
  it('calls both midnights 12a (the Week view used to end on "12p")', () => {
    expect(hourTick(0)).toBe('12a')
    expect(hourTick(24)).toBe('12a')
    expect(hourTick(12)).toBe('12p')
    expect(hourTick(22)).toBe('10p')
  })
})

describe('full-day averages', () => {
  const days = [day(4), day(5), day(6), day(7), day(8), day(9), day(10)]
  const now = new Date(2026, 9, 10, 14, 0)
  it('leaves today out while it is not over', () => {
    // Six full days of 9.5 h and today's 5 h so far: the average is 9.5 h, not 8.9 h.
    const sleep = [9.5, 9.5, 9.5, 9.5, 9.5, 9.5, 5]
    expect(fullDayAverage(sleep, days, now)).toBe(9.5)
    expect(averagedDays(sleep, days, now)).toEqual([0, 1, 2, 3, 4, 5])
  })
  it('falls back to today when nothing else was logged (a brand-new log)', () => {
    expect(fullDayAverage([0, 0, 0, 0, 0, 0, 3], days, now)).toBe(3)
    expect(fullDayAverage([0, 0, 0, 0, 0, 0, 0], days, now)).toBe(0)
  })
})

describe('diaperSplit', () => {
  it('counts a mixed diaper once, beside the wet-only and poo-only ones (and leaves dry ones out)', () => {
    const changes = [
      { wet: true, solid: false },
      { wet: true, solid: true },
      { wet: false, solid: true },
      { wet: false, solid: false },
    ]
    expect(diaperSplit(changes)).toEqual({ wet: 1, poo: 1, mixed: 1 })
  })
})

describe('keepToRange', () => {
  it('drops medicine, temperatures, solids and activities from before the range', () => {
    const ev = {
      sleep: [],
      feedings: [{ start: '2026-09-01T10:00:00' }, { start: '2026-10-09T10:00:00' }],
      changes: [],
      pumping: [],
      tummy: [],
      temperature: [{ time: '2026-09-01T10:00:00' }, { time: '2026-10-09T10:00:00' }],
      medication: [{ time: '2026-09-20T10:00:00' }],
      notes: [],
      activities: [{ start: '2026-10-08T10:00:00' }],
      milestones: [],
      contractions: [],
    } as unknown as EventSets
    const kept = keepToRange(ev, day(4).getTime())
    expect(kept.feedings).toHaveLength(1)
    expect(kept.temperature).toHaveLength(1)
    expect(kept.medication).toHaveLength(0)
    expect(kept.activities).toHaveLength(1)
  })
})

describe('Reports view state', () => {
  const store = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }
  it('comes back as it was left, per child', () => {
    const s = store()
    writeView(3, { view: 'summary', cat: 'pump', span: 30, day: null }, s)
    expect(readView(3, s)).toEqual({ view: 'summary', cat: 'pump', span: 30, day: null })
    expect(readView(4, s)).toEqual(DEFAULT_VIEW)
  })
  it('ignores garbage', () => {
    const s = store()
    s.setItem('bramble.reports.3', '{"view":"chart","cat":"x","span":12,"day":"yesterday"}')
    expect(readView(3, s)).toEqual(DEFAULT_VIEW)
    s.setItem('bramble.reports.3', 'not json')
    expect(readView(3, s)).toEqual(DEFAULT_VIEW)
  })
  it('keeps "today" as today and a paged day as that date', () => {
    const now = new Date(2026, 9, 10, 9)
    expect(dayKey(day(10), now)).toBeNull()
    expect(dayKey(day(6), now)).toBe('2026-10-06')
    expect(dayOf({ ...DEFAULT_VIEW, day: '2026-10-06' }, now)).toEqual(day(6))
    expect(dayOf({ ...DEFAULT_VIEW, day: null }, new Date(2026, 9, 11, 9))).toEqual(day(11))
    expect(dayOf({ ...DEFAULT_VIEW, day: '2026-12-01' }, now)).toEqual(day(10))
  })
  it('fetches in fortnight steps so paging back a few days reuses one fetch', () => {
    expect(fetchDays(7, 0)).toBe(9)
    expect(fetchDays(7, 1)).toBe(fetchDays(7, 14))
    expect(fetchDays(7, 15)).toBe(fetchDays(7, 28))
    expect(fetchDays(30, 0)).toBe(32)
  })
})

describe('science text in the phone units (cases kept from the removed science/display helpers)', () => {
  it('converts small and large ounce bands and leaves an oz phone alone', () => {
    expect(clockRange(['19:00', '00:30'])).toBe('7\u00a0PM–12:30\u00a0AM')
    expect(ozRange([2, 3], 'ml')).toBe('60–90 mL')
    expect(ozRange([2, 3], 'oz')).toBe('2–3 oz')
    expect(ozRange([0.2, 0.7], 'ml')).toBe('5–20 mL')
    expect(ozText('Bottle-fed newborns take 1–2 oz per feed, rising to 2–3 oz by two weeks.', 'ml')).toBe('Bottle-fed newborns take 30–60 mL per feed, rising to 60–90 mL by two weeks.')
    expect(ozText('Up to 6–8 oz per feed, no more than about 32 oz a day.', 'oz')).toBe('Up to 6–8 oz per feed, no more than about 32 oz a day.')
  })
})

describe('lineDomain', () => {
  it('fits a pounds axis to the weights in ounce steps, so 5 lb 11 oz and 5 lb 15 oz sit apart', () => {
    // Ada's month: 5 lb 11 oz on Sep 22, a dip, 5 lb 15 oz on Oct 20; a 20 g/day guide from the first weighing.
    const d = lineDomain([5.6875, 5.5, 5.9375, 5.6875, 6.92], 0.5, LB_STEPS)
    expect(d.min).toBeLessThan(5.5)
    expect(d.max).toBeGreaterThan(6.92)
    expect(d.max - d.min).toBeLessThan(2)
    expect(d.ticks.map((t) => weightTick(t, 'lb'))).toEqual(['5 lb 8 oz', '6 lb', '6 lb 8 oz', '7 lb'])
  })
  it('never narrower than the minimum span: a flat week does not turn an ounce into a cliff', () => {
    const d = lineDomain([5.9, 5.9375], 0.5, LB_STEPS)
    expect(d.max - d.min).toBeGreaterThanOrEqual(0.5)
    expect(d.ticks.length).toBeGreaterThanOrEqual(2)
  })
  it('uses round steps without a step list', () => {
    expect(lineDomain([2.4, 2.7], 0.25).ticks).toEqual([2.3, 2.4, 2.5, 2.6, 2.7, 2.8].filter((t) => t >= lineDomain([2.4, 2.7], 0.25).min && t <= lineDomain([2.4, 2.7], 0.25).max))
    expect(lineDomain([0.2, 0.4], 1).min).toBe(0)
  })
})

describe('lineDomain with all zeros (sweep 2026-10-21)', () => {
  it('still has a span, so nothing divides by zero', () => {
    const d = lineDomain([0], 0)
    expect(d.max - d.min).toBeGreaterThan(0)
    expect(d.ticks.length).toBeGreaterThan(0)
  })
})

describe('a daily band', () => {
  it('rounds to 5 mL, or half an ounce on an ounce phone', () => {
    expect(volumeRange(395, 473, 'ml')).toBe('395–475 mL')
    expect(volumeRange(395, 475, 'oz')).toBe('13.5–16 oz')
  })
})

describe('a tapped bar', () => {
  const day = new Date(2026, 9, 22)
  it('says its total and its day', () => {
    expect(barText({ label: 'T', date: day, parts: [{ value: 9, color: 'x' }] }, (v) => `${v} feeds`)).toEqual({ value: '9 feeds', when: 'Thu, Oct 22', change: null })
  })
  it('lists the named parts of a stacked bar that have any, and falls back to the axis label without a date', () => {
    const d = { label: '22', parts: [{ value: 2, color: 'y', name: 'Wet' }, { value: 0, color: 'o', name: 'Wet and poo' }, { value: 1, color: 'b', name: 'Poo' }] }
    expect(barText(d, (v) => String(v))).toEqual({ value: '3', when: '22', change: 'Wet 2 · Poo 1' })
    expect(barText(d, (v) => `${v} diapers`, (v) => String(v)).change).toBe('Wet 2 · Poo 1')
  })
})
