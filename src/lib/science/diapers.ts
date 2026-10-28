export interface DiaperNorm {
  dayMin: number
  dayMax: number
  wetPerDay: [number, number]
  dirtyPerDay: [number, number]
  stoolColor: string
  notes: string
  sources: string[]
}

/** Output expectations by day of life; a simple, reliable sign that feeding is going well. */
export const DIAPER_NORMS: DiaperNorm[] = [
  { dayMin: 0, dayMax: 1, wetPerDay: [1, 2], dirtyPerDay: [1, 2], stoolColor: 'Black, sticky (meconium)', notes: 'Roughly one wet diaper per day of life for the first days. Meconium is normal.', sources: ['hc-diapers'] },
  { dayMin: 2, dayMax: 2, wetPerDay: [2, 3], dirtyPerDay: [1, 3], stoolColor: 'Dark green-black, turning greenish', notes: 'Output rises with each day as milk comes in.', sources: ['hc-diapers'] },
  { dayMin: 3, dayMax: 3, wetPerDay: [3, 4], dirtyPerDay: [2, 3], stoolColor: 'Green to yellow-green (transitional)', notes: 'Uric acid crystals (brick-dust orange) can appear in urine and are fine at this stage.', sources: ['hc-diapers'] },
  { dayMin: 4, dayMax: 4, wetPerDay: [4, 6], dirtyPerDay: [3, 4], stoolColor: 'Yellow, seedy (breastfed) or tan/yellow (formula)', notes: 'By day 4–5 stools should be yellow; still dark stool on day 5 is worth a call.', sources: ['hc-diapers'] },
  { dayMin: 5, dayMax: 42, wetPerDay: [6, 8], dirtyPerDay: [3, 5], stoolColor: 'Mustard yellow, loose (breastfed); tan/yellow-brown, firmer (formula)', notes: 'From about day 5, six or more heavy wet diapers a day means baby is getting enough milk. Breastfed babies often stool after most feeds.', sources: ['hc-diapers'] },
  { dayMin: 43, dayMax: 182, wetPerDay: [5, 8], dirtyPerDay: [0, 4], stoolColor: 'Yellow to brown', notes: 'After 6 weeks a breastfed baby may go several days between stools, and that is normal if soft. Formula-fed babies usually stool daily.', sources: ['hc-diapers'] },
  { dayMin: 183, dayMax: 365, wetPerDay: [5, 7], dirtyPerDay: [1, 2], stoolColor: 'Brown, firmer once solids start', notes: 'Solids change color and smell. Hard pellets or white, red, or black stools deserve a call.', sources: ['hc-diapers'] },
  { dayMin: 366, dayMax: 100000, wetPerDay: [4, 7], dirtyPerDay: [1, 2], stoolColor: 'Brown', notes: 'Toddler output varies with diet and fluids.', sources: ['hc-diapers'] },
]

export function diaperNormFor(dayOfLife: number): DiaperNorm {
  const d = Math.max(0, Math.floor(dayOfLife))
  return DIAPER_NORMS.find((n) => d >= n.dayMin && d <= n.dayMax) ?? DIAPER_NORMS[DIAPER_NORMS.length - 1]
}

export type DiaperStatus = 'low' | 'typical' | 'high'

export function compareDiapers(wet: number, dirty: number, dayOfLife: number, hoursElapsedToday: number): { status: DiaperStatus; text: string; norm: DiaperNorm } {
  const norm = diaperNormFor(dayOfLife)
  const frac = Math.min(1, Math.max(0.05, hoursElapsedToday / 24))
  const expectedWetLo = norm.wetPerDay[0] * frac
  let status: DiaperStatus = 'typical'
  if (frac >= 0.6 && wet < expectedWetLo * 0.7) status = 'low'
  const text =
    status === 'low'
      ? `${wet} wet so far · fewer than the typical ${norm.wetPerDay[0]}–${norm.wetPerDay[1]} a day. Offer a feed and mention it to your pediatrician if it continues.`
      : `${wet} wet, ${dirty} dirty so far · typical ${norm.wetPerDay[0]}–${norm.wetPerDay[1]} wet a day`
  return { status, text, norm }
}
