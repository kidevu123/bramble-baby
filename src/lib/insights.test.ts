import { describe, expect, it } from 'vitest'
import { MINIPLANS, generateInsights, miniplansFor } from './insights'
import type { EventSets } from './events'
import type { DiaperChange, Feeding, Sleep } from './api/types'

const empty: EventSets = { sleep: [], feedings: [], changes: [], pumping: [], tummy: [], temperature: [], medication: [], notes: [], activities: [], milestones: [], contractions: [] }
const now = new Date('2026-09-01T18:00:00')

const sleep = (id: number, start: string, end: string, nap: boolean): Sleep => {
  const secs = (new Date(end).getTime() - new Date(start).getTime()) / 1000
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return { id, child: 1, start, end, duration: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`, nap, notes: null, tags: [] }
}
const days = ['2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01']

describe('generateInsights', () => {
  it('returns expecting content before birth', () => {
    const out = generateInsights({ ageMonths: -1, events: empty, now, expecting: true, childName: 'Baby' })
    expect(out.every((i) => i.category === 'expecting')).toBe(true)
    expect(out.map((i) => i.title).join(' ')).toMatch(/5-1-1/)
  })
  it('returns between 4 and 8 insights', () => {
    const out = generateInsights({ ageMonths: 5, events: empty, now, expecting: false, childName: 'Oscar' })
    expect(out.length).toBeGreaterThanOrEqual(4)
    expect(out.length).toBeLessThanOrEqual(8)
  })
  it('includes the age-appropriate developmental milestone', () => {
    const out = generateInsights({ ageMonths: 6, events: empty, now, expecting: false, childName: 'Oscar' })
    expect(out.some((i) => i.badge === 'milestone' && /solids/i.test(i.title))).toBe(true)
    const toddler = generateInsights({ ageMonths: 22, events: empty, now, expecting: false, childName: 'Oscar' })
    expect(toddler.some((i) => /Two-word/.test(i.title))).toBe(true)
  })
  it('flags early first naps on 4+ of 7 days and ranks it first', () => {
    const sleeps = days.map((d, i) => sleep(i, `${d}T08:00:00`, `${d}T08:45:00`, true))
    const out = generateInsights({ ageMonths: 7, events: { ...empty, sleep: sleeps }, now, expecting: false, childName: 'Oscar' })
    expect(out[0].id).toBe('pattern-early-first-nap')
    expect(out[0].body).toMatch(/before 6 AM/)
  })
  it('does not flag early naps with only 3 days', () => {
    const sleeps = days.slice(0, 3).map((d, i) => sleep(i, `${d}T08:00:00`, `${d}T08:45:00`, true))
    const out = generateInsights({ ageMonths: 7, events: { ...empty, sleep: sleeps }, now, expecting: false, childName: 'Oscar' })
    expect(out.some((i) => i.id === 'pattern-early-first-nap')).toBe(false)
  })
  it('flags a last nap ending within 2h of bedtime', () => {
    const sleeps: Sleep[] = []
    days.forEach((d, i) => {
      sleeps.push(sleep(i * 2, `${d}T16:30:00`, `${d}T17:30:00`, true))
      sleeps.push(sleep(i * 2 + 1, `${d}T19:00:00`, `${d}T23:00:00`, false))
    })
    const out = generateInsights({ ageMonths: 8, events: { ...empty, sleep: sleeps }, now, expecting: false, childName: 'Oscar' })
    expect(out.some((i) => i.id === 'pattern-late-last-nap')).toBe(true)
  })
  it('flags bedtime drifting later', () => {
    const sleeps = days.map((d, i) => sleep(i, `${d}T19:${String(i * 10).padStart(2, '0')}:00`, `${d}T23:00:00`, false))
    const out = generateInsights({ ageMonths: 8, events: { ...empty, sleep: sleeps }, now, expecting: false, childName: 'Oscar' })
    expect(out.some((i) => i.id === 'pattern-bedtime-drift')).toBe(true)
  })
  it('flags nap totals dropping', () => {
    const sleeps = days.map((d, i) => (i < 4 ? sleep(i, `${d}T12:00:00`, `${d}T14:00:00`, true) : sleep(i, `${d}T12:00:00`, `${d}T12:30:00`, true)))
    const out = generateInsights({ ageMonths: 10, events: { ...empty, sleep: sleeps }, now, expecting: false, childName: 'Oscar' })
    expect(out.some((i) => i.id === 'pattern-nap-drop')).toBe(true)
  })
  it('flags short nights against the age norm', () => {
    const sleeps = days.map((d, i) => sleep(i, `${d}T22:00:00`, `${d}T23:59:00`, false))
    const out = generateInsights({ ageMonths: 8, events: { ...empty, sleep: sleeps }, now, expecting: false, childName: 'Oscar' })
    expect(out.some((i) => i.id === 'pattern-short-nights')).toBe(true)
  })
  it('flags few wet diapers in the evening for infants', () => {
    const changes: DiaperChange[] = [1, 2].map((i) => ({ id: i, child: 1, time: `2026-09-01T0${i + 6}:00:00`, wet: true, solid: false, color: '', amount: null, notes: null, tags: [] }))
    const out = generateInsights({ ageMonths: 3, events: { ...empty, changes }, now, expecting: false, childName: 'Oscar' })
    expect(out.some((i) => i.id === 'pattern-few-wet-diapers')).toBe(true)
    const morning = generateInsights({ ageMonths: 3, events: { ...empty, changes }, now: new Date('2026-09-01T09:00:00'), expecting: false, childName: 'Oscar' })
    expect(morning.some((i) => i.id === 'pattern-few-wet-diapers')).toBe(false)
  })
  it('flags long daytime feeding gaps under 6 months', () => {
    const feed = (id: number, start: string): Feeding => ({ id, child: 1, start, end: start, duration: '00:00:00', type: 'breast milk', method: 'bottle', amount: 3, notes: null, tags: [] })
    const feedings = [feed(1, '2026-09-01T07:00:00'), feed(2, '2026-09-01T12:00:00'), feed(3, '2026-09-01T17:00:00')]
    const out = generateInsights({ ageMonths: 3, events: { ...empty, feedings }, now, expecting: false, childName: 'Oscar' })
    expect(out.some((i) => i.id === 'pattern-feeding-gaps')).toBe(true)
    const older = generateInsights({ ageMonths: 9, events: { ...empty, feedings }, now, expecting: false, childName: 'Oscar' })
    expect(older.some((i) => i.id === 'pattern-feeding-gaps')).toBe(false)
  })
  it('has unique ids', () => {
    const out = generateInsights({ ageMonths: 7, events: empty, now, expecting: false, childName: 'Oscar' })
    expect(new Set(out.map((i) => i.id)).size).toBe(out.length)
  })
})

describe('sleep patterns', () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString()
  const now = new Date(2026, 9, 9, 15, 0)
  it('reads a bedtime after midnight as late, not as the earliest evening', () => {
    // 00:30 (the evening of Oct 2), then 8 PM on Oct 3–6: bedtime moved earlier
    const s: Sleep[] = [sleep(1, at(3, 0, 30), at(3, 6), false), ...[3, 4, 5, 6].map((d) => sleep(d + 1, at(d, 20), at(d + 1, 6), false))]
    expect(generateInsights({ ageMonths: 2, events: { ...empty, sleep: s }, now, expecting: false, childName: 'Ada' }).find((i) => i.id === 'pattern-bedtime-drift')).toBeUndefined()
    // 8 PM on Oct 3–5, then past midnight on the evenings of Oct 6 and 7: drifting later by hours
    const later: Sleep[] = [...[3, 4, 5].map((d) => sleep(d, at(d, 20), at(d + 1, 6), false)), sleep(6, at(7, 0, 30), at(7, 7), false), sleep(7, at(8, 0, 45), at(8, 7), false)]
    const drift = generateInsights({ ageMonths: 2, events: { ...empty, sleep: later }, now, expecting: false, childName: 'Ada' }).find((i) => i.id === 'pattern-bedtime-drift')
    expect(drift?.body).toMatch(/moved about \d+ minutes later/)
  })
  it('leaves today out of the nap-drop pattern', () => {
    const morning = new Date(2026, 9, 9, 10, 0)
    const s: Sleep[] = [3, 4, 5, 6, 7, 8].map((d) => sleep(d, at(d, 13), at(d, 15), true))
    s.push(sleep(9, at(9, 9), at(9, 9, 10), true))
    expect(generateInsights({ ageMonths: 5, events: { ...empty, sleep: s }, now: morning, expecting: false, childName: 'Ada' }).find((i) => i.id === 'pattern-nap-drop')).toBeUndefined()
  })
})

describe('miniplans', () => {
  it('ships at least 8 guides', () => expect(MINIPLANS.length).toBeGreaterThanOrEqual(8))
  it('filters by age', () => {
    expect(miniplansFor(1).some((m) => m.id === 'transport-response')).toBe(true)
    expect(miniplansFor(1).some((m) => m.id === 'weaning-night-feeds')).toBe(false)
    expect(miniplansFor(9).some((m) => m.id === 'weaning-night-feeds')).toBe(true)
  })
  it('treats expecting as newborn content', () => expect(miniplansFor(-1).length).toBeGreaterThan(0))
})
