import { describe, expect, it } from 'vitest'
import type { MilkBag } from './api/companion'
import { stashKeyItems } from './stash-key'

const bag = (over: Partial<MilkBag>): MilkBag => ({
  id: 1, child: 6, code: 'ABCDEF', pumped_at: '2026-10-20T14:00:00', volume_ml: 60, location: 'fridge', thawed: false,
  expires_at: '2026-10-24T14:00:00', status: 'stored', pumping_id: null, feeding_id: null, notes: '', created: '', created_by: null, used_at: null, used_by: null, uses: [],
  ...over, remaining_ml: over.remaining_ml ?? over.volume_ml ?? 60,
})
const labels = { dayNight: true, nightFrom: 21, nightTo: 6 }

describe('the Stash key', () => {
  it('lists only the symbols the list shows, places first, in a fixed order', () => {
    const bags = [bag({ location: 'freezer', pumped_at: '2026-10-20T23:30:00' }), bag({ location: 'fridge' })]
    expect(stashKeyItems(bags, labels)).toEqual(['fridge', 'freezer', 'day', 'night'])
    expect(stashKeyItems([bag({ location: 'room' })], labels)).toEqual(['room', 'day'])
    expect(stashKeyItems([], labels)).toEqual([])
  })
  it('no sun or moon when Sun or moon is off, and a premade bottle is a bottle without one', () => {
    expect(stashKeyItems([bag({ location: 'freezer', pumped_at: '2026-10-20T23:30:00' })], { ...labels, dayNight: false })).toEqual(['freezer'])
    expect(stashKeyItems([bag({ kind: 'bottle', spot: 2 } as Partial<MilkBag>)], labels)).toEqual(['bottle'])
  })
})
