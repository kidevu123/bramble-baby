import { describe, expect, it } from 'vitest'
import type { MilkBag, MilkUse } from './api/companion'
import { DEFAULT_LABEL_PREFS, labelLines } from './labels'
import { isColostrum, nicuCandidates, nicuDefaultPick, nicuTrips } from './nicu-stash'

const birth = '2026-10-01'
const bag = (id: number, over: Partial<MilkBag> = {}): MilkBag =>
  ({ id, child: 1, code: `C${id}`, pumped_at: '2026-10-10T10:00:00', volume_ml: 30, remaining_ml: 30, location: 'fridge', thawed: false, expires_at: '2026-10-14T10:00:00', status: 'stored', pumping_id: null, feeding_id: null, notes: '', created: '', created_by: null, used_at: null, used_by: null, thawed_at: null, uses: [], kind: 'bag', spot: null, ...over }) as MilkBag
const nicuUse = (at: string, ml: number): MilkUse => ({ id: 1, bag: 1, feeding_id: null, amount_ml: ml, kind: 'nicu', at, by_user: null })

describe('colostrum', () => {
  it('is milk pumped on days 1 to 5 after the birth (day 1 is the birth day)', () => {
    expect(isColostrum('2026-10-01T23:00:00', birth)).toBe(true)
    expect(isColostrum('2026-10-05T08:00:00', birth)).toBe(true)
    expect(isColostrum('2026-10-06T08:00:00', birth)).toBe(false)
    expect(isColostrum('2026-09-30T08:00:00', birth)).toBe(false)
    expect(isColostrum('2026-10-02T08:00:00', null)).toBe(false)
  })
  it('is said on the sticker', () => {
    const input = { childName: 'Leo', pumpedAt: new Date('2026-10-02T08:00:00'), amount: 2, unit: 'ml' as const, birthDate: birth }
    expect(labelLines(input, DEFAULT_LABEL_PREFS).map((l) => l.text)).toContain('Colostrum')
    expect(labelLines({ ...input, pumpedAt: new Date('2026-10-12T08:00:00') }, DEFAULT_LABEL_PREFS).map((l) => l.text)).not.toContain('Colostrum')
  })
})

describe('taken to the NICU', () => {
  const now = new Date('2026-10-12T12:00:00')
  it('counts the bags and milk taken in over the last seven days and the latest trip', () => {
    const bags = [
      bag(1, { status: 'used', uses: [nicuUse('2026-10-11T15:00:00', 30)] }),
      bag(2, { status: 'used', uses: [nicuUse('2026-10-12T09:00:00', 45)] }),
      bag(3, { status: 'used', uses: [nicuUse('2026-10-02T09:00:00', 20)] }),
      bag(4, { status: 'used', uses: [{ ...nicuUse('2026-10-12T09:00:00', 30), kind: 'bottle' }] }),
    ]
    const t = nicuTrips(bags, now)
    expect(t).toMatchObject({ weekBags: 2, weekMl: 75 })
    expect(t.last?.toISOString()).toBe(new Date('2026-10-12T09:00:00').toISOString())
    expect(nicuTrips([], now).last).toBeNull()
  })
  it('offers what is still at home, colostrum first then the oldest, and picks the fridge and counter to start', () => {
    const bags = [
      bag(1, { pumped_at: '2026-10-09T10:00:00' }),
      bag(2, { pumped_at: '2026-10-03T10:00:00', location: 'freezer', expires_at: '2027-04-01T10:00:00' }),
      bag(3, { pumped_at: '2026-10-08T10:00:00', location: 'room', expires_at: '2026-10-12T14:00:00' }),
      bag(4, { expires_at: '2026-10-11T10:00:00' }), // expired
      bag(5, { status: 'used' }),
      bag(6, { kind: 'bottle', spot: 1 }),
    ]
    const c = nicuCandidates(bags, birth, now)
    expect(c.map((b) => b.id)).toEqual([2, 3, 1])
    expect([...nicuDefaultPick(c)].sort()).toEqual([1, 3])
  })
})
