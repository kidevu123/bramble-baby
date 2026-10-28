import { describe, expect, it } from 'vitest'
import type { Pumping } from './api/types'
import { nicuPumping } from './nicu-pumping'

const pump = (start: string, amount: number): Pumping => ({ id: 1, child: 1, start, end: start, duration: '00:15:00', amount, notes: null, tags: [] })
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(new Date(`${from}T00:00:00`).getTime() + i * 86_400_000))
/** `n` sessions a day of `ml` each on the given dates, the first at 2 AM when `night`. */
const sessions = (dates: string[], n: number, ml: number, night = true) =>
  dates.flatMap((d) => Array.from({ length: n }, (_, i) => pump(`${d}T${String(night ? 2 + i * 3 : 7 + i * 2).padStart(2, '0')}:00:00`, ml)))

describe('nicuPumping', () => {
  it('counts full days only and never calls the first two weeks low', () => {
    const p = sessions(['2026-07-03', '2026-07-04', '2026-07-05'], 6, 5)
    const r = nicuPumping(p, days('2026-07-01', 6), new Date('2026-07-06T09:00:00'), '2026-07-01', 'ml')!
    expect(r.days).toBe(3)
    expect(r.deliveryDay).toBe(5)
    expect(r.sessionsPerDay).toBe(6)
    expect(r.mlPerDay).toBe(30)
    expect(r.volumeDetail).toBe('day 5 · aim 500 mL a day by day 7')
    expect(r.volumeTone).toBeNull()
    expect(r.sessionsDetail).toBe('aim 8 a day · 3 of 3 days with one at night')
    expect(r.sessionsTone).toBeNull()
  })
  it('flags fewer than five sessions a day from day 5, and meets at eight', () => {
    const few = nicuPumping(sessions(['2026-07-05'], 4, 20, false), days('2026-07-01', 6), new Date('2026-07-06T09:00:00'), '2026-07-01', 'ml')!
    expect(few.sessionsTone).toBe('missed')
    expect(few.sessionsDetail).toContain('0 of 1 day with one at night')
    const eight = nicuPumping(sessions(['2026-07-05'], 8, 20), days('2026-07-01', 6), new Date('2026-07-06T09:00:00'), '2026-07-01', 'ml')!
    expect(eight.sessionsTone).toBe('met')
  })
  it('judges the volume after two weeks: full, between, borderline, low, in the phone unit', () => {
    const at = new Date('2026-08-02T09:00:00')
    const range = days('2026-07-26', 8)
    const run = (ml: number, unit: 'ml' | 'oz' = 'ml') => nicuPumping(sessions(['2026-08-01'], 8, unit === 'oz' ? ml / 29.5735 : ml), range, at, '2026-07-01', unit)!
    expect(run(100).volumeTone).toBe('met')
    expect(run(80).volumeDetail).toBe('over 500 mL · full supply is 750 mL')
    expect(run(50).volumeTone).toBeNull()
    expect(run(50).volumeDetail).toBe('borderline (350–500 mL) · full supply is 750 mL')
    expect(run(30).volumeTone).toBe('missed')
    expect(run(30).volumeDetail).toBe('low: under 350 mL · worth asking the NICU’s lactation consultant'.replace('’', "'"))
    expect(run(100, 'oz').volumeDetail).toBe('full supply is 25 oz or more')
  })
  it('leaves out days before the birth and answers null with nothing logged', () => {
    expect(nicuPumping([], days('2026-07-01', 3), new Date('2026-07-04T09:00:00'), '2026-07-01', 'ml')).toBeNull()
    const r = nicuPumping([...sessions(['2026-06-30'], 3, 5), ...sessions(['2026-07-02'], 2, 5)], days('2026-06-29', 5), new Date('2026-07-04T09:00:00'), '2026-07-01', 'ml')!
    expect(r.days).toBe(1)
  })
})
