import { describe, expect, it } from 'vitest'
import type { Pumping } from './api/types'
import { cleanPumps, comparePumps, DEFAULT_PUMPS, LEGACY_PUMPS, pumpCaution, pumpOf, pumpTag, startingPumps, withPumpTag } from './pumps'

const session = (id: number, pump: string | null, amount: number | null, minutes: number, hour: number): Pumping => {
  const start = new Date(2026, 9, 1 + (id % 5), hour, 0)
  const end = new Date(start.getTime() + minutes * 60_000)
  return { id, child: 1, start: start.toISOString(), end: end.toISOString(), duration: `00:${String(minutes).padStart(2, '0')}:00`, amount, notes: '', tags: pump ? ['caregiver:sara', pumpTag(pump)] : ['caregiver:sara'] }
}

describe('pump tags', () => {
  it('rides on the entry beside the caregiver tag, one pump at a time', () => {
    expect(pumpTag(' Spectra ')).toBe('pump:Spectra')
    expect(pumpOf(['caregiver:sara', 'pump:Eufy'])).toBe('Eufy')
    expect(pumpOf(['caregiver:sara'])).toBeNull()
    expect(pumpOf(['pump:'])).toBeNull()
    expect(withPumpTag(['caregiver:sara', 'pump:Eufy'], 'Medela')).toEqual(['caregiver:sara', 'pump:Medela'])
    expect(withPumpTag(['caregiver:sara', 'pump:Eufy'], null)).toEqual(['caregiver:sara'])
    expect(withPumpTag(undefined, 'Ameda')).toEqual(['pump:Ameda'])
  })
  it('keeps the settings list clean', () => {
    expect(DEFAULT_PUMPS).toEqual([])
    expect(LEGACY_PUMPS.map((p) => p.name)).toEqual(['Eufy', 'Spectra', 'Medela', 'Ameda'])
    expect(cleanPumps([{ name: ' Eufy ', minutes: 30.4 }, { name: 'eufy', minutes: 5 }, { name: '', minutes: 20 }, { name: 'Elvie', minutes: NaN }, { name: 'Willow', minutes: 999 }])).toEqual([
      { name: 'Eufy', minutes: 30 },
      { name: 'Elvie', minutes: 20 },
      { name: 'Willow', minutes: 180 },
    ])
  })
})

describe('comparePumps', () => {
  const entries = [
    session(1, 'Eufy', 120, 30, 6),
    session(2, 'Eufy', 110, 30, 7),
    session(3, 'Eufy', 100, 30, 14),
    session(4, 'Spectra', 100, 20, 12),
    session(5, 'Spectra', 90, 20, 15),
    session(6, 'Spectra', 95, 20, 18),
    session(7, null, 80, 20, 9),
    session(8, 'Medela', null, 20, 9), // no volume: not a result
  ]
  it('ranks by volume per session, keeps every session, and notices a different per-minute leader', () => {
    const c = comparePumps(entries)
    expect(c.pumps.map((p) => p.name)).toEqual(['Eufy', 'Spectra'])
    expect(c.pumps[0]).toMatchObject({ sessions: 3, total: 330, avgAmount: 110, avgMinutes: 30, bestAmount: 120 })
    expect(c.pumps[0].perMinute).toBeCloseTo(330 / 90, 5)
    expect(c.pumps[1].perMinute).toBeCloseTo(285 / 60, 5)
    expect(c.perMinuteLeader).toBe('Spectra') // 4.75 a minute against the Eufy's 3.67
    expect(c.untracked).toBe(1)
    expect(c.untrackedPoints.map((p) => p.amount)).toEqual([80])
    expect(c.pumps[0].morningShare).toBeCloseTo(2 / 3, 5)
    // the real data behind the average, oldest first, with the morning slot marked
    expect(c.pumps[0].points.map((p) => [p.amount, p.minutes, p.morning])).toEqual([
      [120, 30, true],
      [110, 30, true],
      [100, 30, false],
    ])
    expect(c.pumps[0].points[0].perMinute).toBe(4)
  })
  it('says when the numbers cannot carry a verdict yet', () => {
    expect(pumpCaution(comparePumps(entries))).toBeNull()
    expect(pumpCaution(comparePumps(entries.slice(0, 4)))).toBe('Fewer than 3 sessions on Spectra: too few to trust yet.')
    expect(pumpCaution(comparePumps(entries.slice(0, 2)))).toBe('Only the Eufy so far. Log a session on another pump to compare.')
    expect(pumpCaution(comparePumps([entries[6]]))).toBe('Pick the pump on each session to start comparing.')
    expect(pumpCaution(comparePumps([]))).toBe('No pumping with a volume in this range yet.')
  })
  it('never divides by a zero-length session', () => {
    const zero = { ...session(9, 'Eufy', 50, 1, 8), duration: '00:00:00' }
    expect(comparePumps([zero]).pumps[0].perMinute).toBe(50)
  })
})

describe('startingPumps', () => {
  const at = (iso: string, tags: string[] = ['caregiver:mom']) => ({ start: iso, tags })
  it('gives a household upgrading from a build without pump tags its old four back, Medela included', () => {
    // 2026-10-21: a household that pumped before 1.34 but never tagged a pump lost every pump.
    expect(startingPumps([at('2026-10-05T09:00:00'), at('2026-10-21T09:00:00')]).map((p) => p.name)).toEqual(['Eufy', 'Spectra', 'Medela', 'Ameda'])
  })
  it('keeps the four plus any other pump its sessions name', () => {
    expect(startingPumps([at('2026-10-22T09:00:00', ['caregiver:mom', pumpTag('Haakaa')])]).map((p) => p.name)).toEqual(['Eufy', 'Spectra', 'Medela', 'Ameda', 'Haakaa'])
  })
  it('a new household (nothing logged, or only untagged sessions since the empty default) starts empty', () => {
    expect(startingPumps([])).toEqual([])
    expect(startingPumps([at('2026-10-22T09:00:00')])).toEqual([])
  })
})
