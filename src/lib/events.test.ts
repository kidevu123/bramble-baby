import { describe, expect, it } from 'vitest'
import { buildGrowthItems, buildTimeline, describeDiaper, describeFeeding, summarizeDay, type EventSets } from './events'
import { DEFAULT_UNITS } from './units'
import type { DiaperChange, Feeding, Sleep, Weight } from './api/types'

import { EMPTY_EVENTS } from './events'
const empty: EventSets = EMPTY_EVENTS

const feeding = (over: Partial<Feeding>): Feeding => ({
  id: 1,
  child: 1,
  start: '2026-09-01T10:00:00',
  end: '2026-09-01T10:15:00',
  duration: '00:15:00',
  type: 'breast milk',
  method: 'bottle',
  amount: 4,
  notes: null,
  tags: [],
  ...over,
})

describe('describeFeeding', () => {
  it('describes a bottle with volume in the chosen unit', () => {
    expect(describeFeeding(feeding({}), DEFAULT_UNITS)).toBe('Bottle · breast milk · 4 oz')
    expect(describeFeeding(feeding({ amount: 120 }), { ...DEFAULT_UNITS, volume: 'ml' })).toBe('Bottle · breast milk · 120 mL')
  })
  it('describes nursing with sides and duration', () => {
    expect(describeFeeding(feeding({ method: 'both breasts', amount: null }), DEFAULT_UNITS)).toBe('Nursed · L+R · 15m')
  })
  it('uses notes for solids', () => {
    expect(describeFeeding(feeding({ type: 'solid food', method: 'parent fed', notes: 'avocado, banana', amount: null }), DEFAULT_UNITS)).toBe('avocado, banana')
  })
})

describe('describeDiaper', () => {
  const d = (over: Partial<DiaperChange>): DiaperChange => ({ id: 1, child: 1, time: '2026-09-01T09:00:00', wet: true, solid: false, color: '', amount: null, notes: null, tags: [], ...over })
  it('names the type', () => {
    expect(describeDiaper(d({}))).toBe('Pee')
    expect(describeDiaper(d({ wet: true, solid: true }))).toBe('Mixed')
    expect(describeDiaper(d({ wet: false, solid: false }))).toBe('Dry')
  })
  it('adds size and color', () => expect(describeDiaper(d({ solid: true, amount: 3, color: 'brown' }))).toBe('Mixed · large · brown'))
})

describe('summarizeDay', () => {
  it('splits sleep across midnight', () => {
    const sleep: Sleep = { id: 1, child: 1, start: '2026-08-31T22:00:00', end: '2026-09-01T06:00:00', duration: '08:00:00', nap: false, notes: null, tags: [] }
    const s = summarizeDay({ ...empty, sleep: [sleep] }, new Date('2026-09-01T12:00:00'))
    expect(s.sleepSeconds).toBe(6 * 3600)
  })
})

describe('buildTimeline', () => {
  it('names who logged a companion activity, like every Baby Buddy entry', () => {
    const items = buildTimeline({ ...empty, activities: [{ id: 5, child: 1, type: 'bath', start: '2026-09-01T18:00:00', end: null, notes: '', tags: ['caregiver:sara'] }, { id: 6, child: 1, type: 'story', start: '2026-09-01T19:00:00', end: null, notes: '' }] }, DEFAULT_UNITS)
    expect(items.find((i) => i.key === 'activity-5')?.by).toBe('sara')
    expect(items.find((i) => i.key === 'activity-6')?.by).toBeNull()
  })
  it('sorts newest first', () => {
    const items = buildTimeline({ ...empty, feedings: [feeding({ id: 1, start: '2026-09-01T08:00:00' }), feeding({ id: 2, start: '2026-09-01T11:00:00' })] }, DEFAULT_UNITS)
    expect(items.map((i) => i.key)).toEqual(['feeding-2', 'feeding-1'])
  })
  it('titles a premade bottle finished or not, so the mark is never cut off with the detail', () => {
    const items = buildTimeline({ ...empty, feedings: [feeding({ id: 1, notes: 'Premade bottle 1 · finished' }), feeding({ id: 2, amount: 2, notes: 'Premade bottle 2 · not finished, about half left' }), feeding({ id: 3, notes: 'warmed' })] }, DEFAULT_UNITS)
    const title = (key: string) => items.find((i) => i.key === key)?.title
    expect([title('feeding-1'), title('feeding-2'), title('feeding-3')]).toEqual(['Bottle · finished', 'Bottle · not finished', 'Bottle'])
    expect(items.find((i) => i.key === 'feeding-2')?.detail).toBe('Bottle · breast milk · 2 oz')
  })
})

describe('buildGrowthItems', () => {
  const weight = (over: Partial<Weight>): Weight => ({ id: 1, child: 1, weight: 5.9, date: '2026-10-06', notes: null, tags: [], ...over })
  it('places a Hatch weighing at the clock in its note, as local wall time on its date', () => {
    const [item] = buildGrowthItems({ weights: [weight({ notes: 'Hatch Grow scale · 8:38 AM' })], heights: [], heads: [] }, DEFAULT_UNITS)
    expect(item.at).toEqual(new Date(2026, 9, 6, 8, 38, 0, 0))
    expect(item.title).toBe('Weight')
    expect(item.detail).toBe('5 lb 14 oz')
  })
  it('keeps an entry without a time at noon', () => {
    const [item] = buildGrowthItems({ weights: [weight({})], heights: [], heads: [] }, DEFAULT_UNITS)
    expect(item.at).toEqual(new Date(2026, 9, 6, 12, 0, 0, 0))
  })
  it('sorts entries on one day by their clock inside the timeline', () => {
    const growth = { weights: [weight({ id: 1, notes: '8:38 AM' }), weight({ id: 2, notes: 'Hatch Grow scale · 7:10 PM' }), weight({ id: 3 })], heights: [], heads: [] }
    const items = buildTimeline({ ...empty, growth }, DEFAULT_UNITS)
    expect(items.map((i) => i.key)).toEqual(['growth-weight-2', 'growth-weight-3', 'growth-weight-1'])
  })
})
