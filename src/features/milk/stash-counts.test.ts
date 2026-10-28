import { describe, expect, it } from 'vitest'
import type { MilkBag, MilkLocation } from '../../lib/api/companion'
import { stashCounts } from './stash-counts'

const now = new Date('2026-10-10T12:00:00Z')
let id = 0
const bag = (ml: number, location: MilkLocation, hoursLeft: number, status: MilkBag['status'] = 'stored') =>
  ({ id: ++id, remaining_ml: ml, volume_ml: ml, location, status, expires_at: new Date(now.getTime() + hoursLeft * 3600_000).toISOString() }) as MilkBag

describe('stashCounts', () => {
  it('counts expired milk once, in its own card, and room-temperature milk with the fridge', () => {
    const c = stashCounts([bag(120, 'fridge', 72), bag(90, 'fridge', -5), bag(45, 'room', 3), bag(150, 'freezer', 24 * 90), bag(60, 'fridge', 72, 'used')], now)
    expect(c.cold).toEqual({ count: 2, ml: 165 })
    expect(c.room).toEqual({ count: 1, ml: 45 })
    expect(c.frozen).toEqual({ count: 1, ml: 150 })
    expect(c.expired).toEqual({ count: 1, ml: 90 })
    // Every stored bag is in exactly one of fridge, frozen or expired.
    expect(c.cold.count + c.frozen.count + c.expired.count).toBe(4)
  })
})
