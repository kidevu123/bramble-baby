/**
 * Did she finish the bottle? Asked on the simple screen as "how much is left in it", since that is what the person
 * holding the bottle can see. The answer rides in the feeding's note as one ` · ` segment ("finished" /
 * "not finished, about half left"), so it survives Baby Buddy's own UI and an edit, and the timeline reads it back.
 */

/** What is left in a premade bottle after the feed: the grandparent looks at the bottle, not at the baby. */
export type BottleLeft = 'none' | 'little' | 'half' | 'most'

/** Share of the bottle she drank for each answer. */
export const DRANK_SHARE: Record<BottleLeft, number> = { none: 1, little: 0.75, half: 0.5, most: 0.25 }

export const LEFT_WORDS: Record<Exclude<BottleLeft, 'none'>, string> = { little: 'a little left', half: 'about half left', most: 'most of it left' }

/** Millilitres she drank from a bottle that held `ml`, whole millilitres. */
export function drankMl(ml: number, left: BottleLeft): number {
  return Math.round(ml * DRANK_SHARE[left])
}

/** The feeding's note: "Premade bottle 2 · finished" or "Premade bottle 2 · not finished, about half left". */
export function bottleNote(spot: number | null | undefined, left: BottleLeft): string {
  const finish = left === 'none' ? 'finished' : `not finished, ${LEFT_WORDS[left]}`
  return `Premade bottle${spot ? ` ${spot}` : ''} · ${finish}`
}

/** Whether a bottle's note says she finished it: the mark the timeline shows. null when nobody said. */
export function bottleFinish(notes: string | null | undefined): 'finished' | 'not finished' | null {
  const segments = (notes ?? '').split(' · ').map((s) => s.trim().toLowerCase())
  if (segments.some((s) => s.startsWith('not finished'))) return 'not finished'
  if (segments.includes('finished')) return 'finished'
  return null
}
