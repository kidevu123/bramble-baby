import { describe, expect, it } from 'vitest'
import type { Pumping } from './api/types'
import { supplyTrend, supplyVerdict, supplyWindowLine } from './supply'

const now = new Date('2026-10-09T15:00:00')
const iso = (d: string) => new Date(d).toISOString()
let id = 0
const pump = (day: string, ml: number, hour = 8): Pumping => ({ id: ++id, child: 1, start: iso(`${day}T${String(hour).padStart(2, '0')}:00:00`), end: iso(`${day}T${String(hour).padStart(2, '0')}:20:00`), amount: ml, duration: '00:20:00', notes: '', tags: [] })
const day = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() - offset); return d.toISOString().slice(0, 10) }
// This week (offsets 1–7) and the week before (8–14).
const week = (mlPerSession: number, sessions: number, offsets: number[]) => offsets.flatMap((o) => Array.from({ length: sessions }, (_, i) => pump(day(o), mlPerSession, 6 + i * 2)))
const thisWeek = [1, 2, 3, 4, 5, 6, 7]
const lastWeek = [8, 9, 10, 11, 12, 13, 14]

describe('supplyTrend', () => {
  it('averages each full week over its logged days and compares them', () => {
    const t = supplyTrend([...week(60, 6, thisWeek), ...week(80, 6, lastWeek), pump(day(0), 500)], 'ml', now)
    expect(t.recent).toEqual({ mlPerDay: 360, sessionsPerDay: 6, days: 7, span: 7 })
    expect(t.prior).toEqual({ mlPerDay: 480, sessionsPerDay: 6, days: 7, span: 7 })
    expect(t.changePct).toBeCloseTo(-0.25, 5)
    expect(t.state).toBe('down') // today's 500 mL is not in either window
  })
  it('treats a day with nothing logged as missing, not zero', () => {
    const t = supplyTrend([...week(60, 6, [1, 2, 3, 4]), ...week(60, 6, lastWeek)], 'ml', now)
    expect(t.recent.days).toBe(4)
    expect(t.recent.mlPerDay).toBe(360)
    expect(t.state).toBe('steady')
  })
  it('needs three logged days in each week', () => {
    const t = supplyTrend([...week(60, 6, [1, 2]), ...week(60, 6, lastWeek)], 'ml', now)
    expect(t.recent.mlPerDay).toBeNull()
    expect(t.changePct).toBeNull()
    expect(t.state).toBe('unknown')
  })
  it('reads amounts in the phone’s unit', () => {
    const t = supplyTrend([...week(2, 6, thisWeek), ...week(2, 6, lastWeek)], 'oz', now)
    expect(t.recent.mlPerDay).toBeCloseTo(354.9, 1)
  })
})

describe('supply words', () => {
  it('describes a window', () => {
    expect(supplyWindowLine({ mlPerDay: 360, sessionsPerDay: 6, days: 7, span: 7 }, 'ml')).toBe('360 mL a day · 6 sessions a day')
    expect(supplyWindowLine({ mlPerDay: 360, sessionsPerDay: 5.5, days: 5, span: 7 }, 'ml')).toBe('360 mL a day · 5.5 sessions a day · 5\u00a0of\u00a07\u00a0days\u00a0logged')
    expect(supplyWindowLine({ mlPerDay: null, sessionsPerDay: null, days: 2, span: 7 }, 'ml')).toBe('2\u00a0of\u00a07\u00a0days\u00a0logged, need 3')
    expect(supplyWindowLine({ mlPerDay: null, sessionsPerDay: null, days: 0, span: 7 }, 'ml')).toBe('nothing logged')
  })
  it('judges the two weeks and names the sessions when they explain a drop', () => {
    expect(supplyVerdict(supplyTrend([...week(60, 6, thisWeek), ...week(80, 6, lastWeek)], 'ml', now), 'ml')).toBe('Down 25% on the week before: 360 mL a day from 480 mL. About as many sessions a day (6), so each one gives less.')
    expect(supplyVerdict(supplyTrend([...week(80, 4, thisWeek), ...week(80, 6, lastWeek)], 'ml', now), 'ml')).toBe('Down 33% on the week before: 320 mL a day from 480 mL. Fewer sessions a day (4 from 6) explain most of it.')
    expect(supplyVerdict(supplyTrend([...week(80, 7, thisWeek), ...week(80, 6, lastWeek)], 'ml', now), 'ml')).toBe('Up 17% on the week before: 560 mL a day from 480 mL. More sessions a day (7 from 6).')
    expect(supplyVerdict(supplyTrend([...week(95, 6, thisWeek), ...week(80, 6, lastWeek)], 'ml', now), 'ml')).toBe('Up 19% on the week before: 570 mL a day from 480 mL. About as many sessions a day (6), each giving more.')
    expect(supplyVerdict(supplyTrend([...week(82, 6, thisWeek), ...week(80, 6, lastWeek)], 'ml', now), 'ml')).toBe('Holding steady: about 492 mL a day both weeks.')
    expect(supplyVerdict(supplyTrend(week(80, 6, lastWeek), 'ml', now), 'ml')).toBe('Not enough logged days this week to compare yet (3 needed in each).')
    expect(supplyVerdict(supplyTrend([], 'ml', now), 'ml')).toBe('Not enough logged days this week and the week before to compare yet (3 needed in each).')

    // the week before logged sessions at 0 mL: no percentage, and never "Not enough logged days  to compare"
    expect(supplyVerdict(supplyTrend([...week(60, 6, thisWeek), ...week(0, 6, lastWeek)], 'ml', now), 'ml')).toBe('Up on the week before: 360 mL a day, from no amounts logged.')
    expect(supplyVerdict(supplyTrend([...week(0, 6, thisWeek), ...week(0, 6, lastWeek)], 'ml', now), 'ml')).toBe('No amounts logged in either week, only sessions at 0.')
  })
})
