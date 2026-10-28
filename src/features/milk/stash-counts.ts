import type { MilkBag } from '../../lib/api/companion'
import { bagState } from '../../lib/milk'

interface Count {
  count: number
  ml: number
}

/**
 * The Stash tab's three count cards, made to add up: usable fridge milk (with what is out on the counter),
 * usable frozen milk, and expired milk counted once, in its own card. "Expiring soon" is a part of the first
 * two, not an extra.
 */
export function stashCounts(bags: MilkBag[], now: Date = new Date()): { cold: Count; room: Count; frozen: Count; expired: Count; soon: Count } {
  const zero = (): Count => ({ count: 0, ml: 0 })
  const out = { cold: zero(), room: zero(), frozen: zero(), expired: zero(), soon: zero() }
  const add = (c: Count, b: MilkBag) => {
    c.count += 1
    c.ml += b.remaining_ml
  }
  for (const b of bags) {
    if (b.status !== 'stored') continue
    const state = bagState(b, now)
    if (state === 'expired') {
      add(out.expired, b)
      continue
    }
    if (state === 'soon') add(out.soon, b)
    if (b.location === 'freezer') add(out.frozen, b)
    else {
      add(out.cold, b)
      if (b.location === 'room') add(out.room, b)
    }
  }
  return out
}
