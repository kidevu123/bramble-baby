/**
 * The Stash for a baby fed in the NICU (Settings › Born early, while the stay lasts): the milk is pumped at home and
 * taken in, so the question is not "how long does the stash last" but "what goes in next, and what went in".
 *
 * - Colostrum: milk pumped in the first days after the birth. NICUs give it first, often as drops for mouth care
 *   before full feeds, so it is marked on the bag and on the sticker. Counted from the real birth (Mom's body).
 * - Taken to the NICU: bags leave the home stash whole (`POST /milk/nicu`, a `nicu` use); the hospital keeps
 *   track of them from there.
 */
import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns'
import type { MilkBag } from './api/companion'
import { isNightBottle } from './milk'
import { parseDate } from './time'

/** Colostrum: the milk of the first days, before it turns into transitional milk (about day 5). */
export const COLOSTRUM_DAYS = 5

/** Pumped on day 1 to COLOSTRUM_DAYS after the birth (day 1 is the birth day). */
export function isColostrum(pumpedAt: Date | string, birth: string | null | undefined): boolean {
  if (!birth) return false
  const day = differenceInCalendarDays(startOfDay(parseDate(pumpedAt)), startOfDay(parseDate(birth))) + 1
  return day >= 1 && day <= COLOSTRUM_DAYS
}

/** When the bag went to the NICU, or null when it did not. */
export function takenToNicuAt(bag: MilkBag): Date | null {
  const use = (bag.uses ?? []).find((u) => u.kind === 'nicu')
  return use ? parseDate(use.at) : null
}

export interface NicuTrips {
  /** Bags taken in over the last seven days, and their milk (mL as labelled, which is what went in). */
  weekBags: number
  weekMl: number
  /** The latest trip, or null before the first. */
  last: Date | null
}

export function nicuTrips(bags: MilkBag[], now: Date = new Date()): NicuTrips {
  const since = addDays(startOfDay(now), -6).getTime()
  let weekBags = 0
  let weekMl = 0
  let last: Date | null = null
  for (const b of bags) {
    const at = takenToNicuAt(b)
    if (!at) continue
    if (!last || at > last) last = at
    if (at.getTime() >= since) {
      weekBags += 1
      weekMl += b.uses.filter((u) => u.kind === 'nicu').reduce((s, u) => s + u.amount_ml, 0)
    }
  }
  return { weekBags, weekMl, last }
}

/** What can go in: bags still at home, not premade bottles, not past their window; colostrum first, then the
 *  oldest pumped. */
export function nicuCandidates(bags: MilkBag[], birth: string | null | undefined, now: Date = new Date()): MilkBag[] {
  return bags
    .filter((b) => b.status === 'stored' && !isNightBottle(b) && parseDate(b.expires_at).getTime() > now.getTime())
    .sort((a, b) => Number(isColostrum(b.pumped_at, birth)) - Number(isColostrum(a.pumped_at, birth)) || a.pumped_at.localeCompare(b.pumped_at))
}

/** Picked to start with: what is in the fridge or on the counter (pumped since the last trip); the freezer stays
 *  unless chosen. */
export function nicuDefaultPick(candidates: MilkBag[]): Set<number> {
  return new Set(candidates.filter((b) => b.location !== 'freezer').map((b) => b.id))
}
