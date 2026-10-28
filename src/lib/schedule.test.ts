import { describe, expect, it } from 'vitest'
import { ageStageLabel, buildSchedule, formatHHmm, parseHHmm, typicalNapLength } from './schedule'

const mins = (s: string) => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

describe('buildSchedule', () => {
  it('starts with wake and ends with bedtime', () => {
    const s = buildSchedule({ ageMonths: 6, wakeTime: '07:00' })
    expect(s[0].kind).toBe('wake')
    expect(s[0].start).toBe('07:00')
    expect(s[s.length - 1].kind).toBe('bedtime')
  })
  it('uses the age default nap count', () => {
    expect(buildSchedule({ ageMonths: 4, wakeTime: '07:00' }).filter((i) => i.kind === 'nap')).toHaveLength(3)
    expect(buildSchedule({ ageMonths: 15, wakeTime: '07:00' }).filter((i) => i.kind === 'nap')).toHaveLength(1)
  })
  it('respects nap count and length overrides', () => {
    const s = buildSchedule({ ageMonths: 6, wakeTime: '07:00', napsPerDay: 2, napLengthMinutes: 60 })
    const naps = s.filter((i) => i.kind === 'nap')
    expect(naps).toHaveLength(2)
    expect(mins(naps[0].end!) - mins(naps[0].start)).toBe(60)
  })
  it('lengthens wake windows through the day', () => {
    const s = buildSchedule({ ageMonths: 7, wakeTime: '07:00' })
    const naps = s.filter((i) => i.kind === 'nap')
    const w1 = mins(naps[0].start) - mins(s[0].start)
    const w2 = mins(naps[1].start) - mins(naps[0].end!)
    expect(w2).toBeGreaterThan(w1)
  })
  it('clamps bedtime to 18:00–21:00', () => {
    const late = buildSchedule({ ageMonths: 4, wakeTime: '10:00' })
    expect(mins(late[late.length - 1].start)).toBeLessThanOrEqual(21 * 60)
    const early = buildSchedule({ ageMonths: 15, wakeTime: '05:00', napLengthMinutes: 60 })
    expect(mins(early[early.length - 1].start)).toBeGreaterThanOrEqual(18 * 60)
  })
  it('adds feeds only when asked and only under 6 months', () => {
    expect(buildSchedule({ ageMonths: 3, wakeTime: '07:00' }).some((i) => i.kind === 'feed')).toBe(false)
    const withFeeds = buildSchedule({ ageMonths: 3, wakeTime: '07:00', includeFeeds: true })
    expect(withFeeds.filter((i) => i.kind === 'feed').length).toBeGreaterThanOrEqual(3)
    expect(buildSchedule({ ageMonths: 8, wakeTime: '07:00', includeFeeds: true }).some((i) => i.kind === 'feed')).toBe(false)
  })
  it('is sorted by time', () => {
    const s = buildSchedule({ ageMonths: 3, wakeTime: '06:30', includeFeeds: true })
    for (let i = 1; i < s.length; i++) expect(mins(s[i].start)).toBeGreaterThanOrEqual(mins(s[i - 1].start))
  })
  it('never schedules a nap past bedtime or before the wake-up on a late day', () => {
    // A newborn "woke" at 20:00: five naps no longer fit. Before the fix the list read Nap 4 01:34,
    // Nap 5 03:17, Wake up 20:00, Nap 1 20:45, Bedtime 21:00, Nap 2 22:18…
    const s = buildSchedule({ ageMonths: 0, wakeTime: '20:00', includeFeeds: true })
    expect(s[0].kind).toBe('wake')
    expect(s[s.length - 1].kind).toBe('bedtime')
    for (let i = 1; i < s.length; i++) expect(s[i].at).toBeGreaterThanOrEqual(s[i - 1].at)
    const bedtime = s.find((i) => i.kind === 'bedtime')!
    for (const nap of s.filter((i) => i.kind === 'nap')) expect(mins(nap.end!)).toBeLessThanOrEqual(mins(bedtime.start))
    expect(bedtime.at).toBeGreaterThanOrEqual(20 * 60)
  })
  it('drops the naps that would end after 21:00 instead of wrapping them past midnight', () => {
    const s = buildSchedule({ ageMonths: 0, wakeTime: '16:00' })
    const naps = s.filter((i) => i.kind === 'nap')
    expect(naps.length).toBeGreaterThan(0)
    expect(naps.length).toBeLessThan(5)
    for (const nap of naps) expect(mins(nap.end!)).toBeLessThanOrEqual(21 * 60)
  })
})

describe('helpers', () => {
  it('formats and parses HH:mm', () => {
    const base = new Date('2026-09-01T12:00:00')
    const d = parseHHmm('07:05', base)
    expect(d.getHours()).toBe(7)
    expect(d.getMinutes()).toBe(5)
    expect(formatHHmm(d)).toBe('07:05')
  })
  it('labels stages', () => {
    expect(ageStageLabel(-1)).toBe('Expecting')
    expect(ageStageLabel(1)).toMatch(/Newborn/)
    expect(ageStageLabel(14)).toMatch(/Toddler/)
  })
  it('nap length shrinks then grows with consolidation', () => {
    expect(typicalNapLength(1)).toBeLessThan(typicalNapLength(14))
  })
})
