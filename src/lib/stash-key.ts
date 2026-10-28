/**
 * The Stash tab's key: what each symbol on a bag row means, listing only the ones the list is showing right now
 * (no sun or moon when Sun or moon is off in Settings, no snowflake with nothing frozen).
 */
import type { MilkBag, MilkLocation } from './api/companion'
import { milkDaypart, type LabelPrefs } from './labels'
import { isNightBottle } from './milk'
import { parseDate } from './time'

export type StashKeyItem = MilkLocation | 'bottle' | 'day' | 'night'

export const STASH_KEY_ORDER: StashKeyItem[] = ['room', 'fridge', 'freezer', 'bottle', 'day', 'night']

export const STASH_KEY_LABEL: Record<StashKeyItem, string> = {
  room: 'Room temp',
  fridge: 'Fridge',
  freezer: 'Freezer',
  bottle: 'Premade bottle',
  day: 'Day milk',
  night: 'Night milk',
}

/** The symbols the listed bags use, in the key's order. */
export function stashKeyItems(bags: MilkBag[], labels: Pick<LabelPrefs, 'dayNight' | 'nightFrom' | 'nightTo'>): StashKeyItem[] {
  const seen = new Set<StashKeyItem>()
  for (const bag of bags) {
    if (isNightBottle(bag)) {
      seen.add('bottle')
      continue
    }
    seen.add(bag.location)
    const part = milkDaypart(parseDate(bag.pumped_at), labels)
    if (part) seen.add(part)
  }
  return STASH_KEY_ORDER.filter((k) => seen.has(k))
}
