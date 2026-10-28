export interface FeedingNorm {
  minMonths: number
  maxMonths: number
  /** Applies only inside the first weeks; null otherwise. */
  dayRange: [number, number] | null
  feedsPerDay: [number, number]
  ozPerFeed: [number, number] | null
  ozPerDay: [number, number] | null
  nursingMinutesPerSide: [number, number] | null
  /** Longest daytime gap before offering a feed, hours. */
  maxGapHoursDay: number | null
  notes: string
  sources: string[]
}

/** AAP HealthyChildren + CDC guidance on amounts and frequency. Volumes are for expressed milk/formula. */
export const FEEDING_NORMS: FeedingNorm[] = [
  { minMonths: 0, maxMonths: 0.25, dayRange: [0, 2], feedsPerDay: [8, 12], ozPerFeed: [0.2, 0.7], ozPerDay: null, nursingMinutesPerSide: [10, 20], maxGapHoursDay: 3, notes: 'Colostrum days: 1–2 teaspoons (5–20 mL) per feed is normal. Feed on cue, at least every 2–3 hours, and wake a sleepy newborn to feed.', sources: ['hc-breastfeeding-often', 'cdc-breastfeeding-often'] },
  { minMonths: 0, maxMonths: 0.5, dayRange: [3, 14], feedsPerDay: [8, 12], ozPerFeed: [1, 3], ozPerDay: [16, 24], nursingMinutesPerSide: [10, 20], maxGapHoursDay: 3, notes: 'Milk comes in around day 3–5. Bottle-fed newborns take 1–2 oz per feed, rising to 2–3 oz by two weeks.', sources: ['hc-feeding-amount', 'hc-breastfeeding-often'] },
  { minMonths: 0.5, maxMonths: 1, dayRange: null, feedsPerDay: [8, 12], ozPerFeed: [2, 3], ozPerDay: [18, 26], nursingMinutesPerSide: [10, 20], maxGapHoursDay: 3, notes: 'Around 2–3 oz every 3–4 hours by bottle; breastfed babies feed 8–12 times a day.', sources: ['hc-feeding-amount'] },
  { minMonths: 1, maxMonths: 2, dayRange: null, feedsPerDay: [7, 9], ozPerFeed: [3, 4], ozPerDay: [22, 30], nursingMinutesPerSide: [10, 15], maxGapHoursDay: 4, notes: 'About 4 oz every 4 hours by bottle. A rough rule: 2.5 oz per pound of body weight per day, capped near 32 oz.', sources: ['hc-feeding-amount'] },
  { minMonths: 2, maxMonths: 4, dayRange: null, feedsPerDay: [6, 8], ozPerFeed: [4, 6], ozPerDay: [24, 32], nursingMinutesPerSide: [8, 15], maxGapHoursDay: 4, notes: 'Feeds consolidate; growth spurts (around 6 weeks and 3 months) bring a few hungrier days.', sources: ['hc-feeding-amount'] },
  { minMonths: 4, maxMonths: 6, dayRange: null, feedsPerDay: [5, 7], ozPerFeed: [6, 8], ozPerDay: [24, 32], nursingMinutesPerSide: [5, 15], maxGapHoursDay: 4, notes: 'Up to 6–8 oz per feed, no more than about 32 oz a day. Solids are not needed before 6 months unless your pediatrician advises otherwise.', sources: ['hc-feeding-amount', 'cdc-solids'] },
  { minMonths: 6, maxMonths: 9, dayRange: null, feedsPerDay: [4, 6], ozPerFeed: [6, 8], ozPerDay: [24, 32], nursingMinutesPerSide: [5, 12], maxGapHoursDay: 5, notes: 'Milk stays the main nutrition; solids 1–2 times a day at first, then 2–3.', sources: ['hc-feeding-amount', 'cdc-solids'] },
  { minMonths: 9, maxMonths: 12, dayRange: null, feedsPerDay: [3, 5], ozPerFeed: [6, 8], ozPerDay: [20, 30], nursingMinutesPerSide: [5, 10], maxGapHoursDay: 5, notes: 'Three meals plus snacks emerging; milk intake eases toward 20–24 oz.', sources: ['hc-feeding-amount', 'cdc-solids'] },
  { minMonths: 12, maxMonths: 24, dayRange: null, feedsPerDay: [2, 4], ozPerFeed: [4, 8], ozPerDay: [16, 24], nursingMinutesPerSide: null, maxGapHoursDay: null, notes: 'Whole milk can replace formula after 12 months: 16–24 oz a day, with meals doing the heavy lifting.', sources: ['cdc-solids'] },
]

export function feedingNormFor(ageMonths: number, dayOfLife?: number): FeedingNorm {
  if (dayOfLife !== undefined && dayOfLife >= 0) {
    const byDay = FEEDING_NORMS.find((n) => n.dayRange && dayOfLife >= n.dayRange[0] && dayOfLife <= n.dayRange[1])
    if (byDay) return byDay
  }
  const m = Math.max(0, ageMonths)
  // Day 15 is 0.49 months: below the first month row, so it is the newborn band, never the toddler one.
  const general = FEEDING_NORMS.filter((n) => !n.dayRange)
  return general.find((n) => m >= n.minMonths && m < n.maxMonths) ?? (m < general[0].minMonths ? general[0] : general[general.length - 1])
}

export type FeedStatus = 'low' | 'typical' | 'high'

/** Prorates the day's expected count by hours elapsed; only flags low once most of the day has passed. */
export function compareFeeds(count: number, totalOz: number | null, ageMonths: number, dayOfLife: number, hoursElapsedToday = 24): { status: FeedStatus; text: string; norm: FeedingNorm } {
  const norm = feedingNormFor(ageMonths, dayOfLife)
  const frac = Math.min(1, Math.max(0.05, hoursElapsedToday / 24))
  const [lo, hi] = norm.feedsPerDay
  const expectedLo = lo * frac
  let status: FeedStatus = 'typical'
  if (frac >= 0.6 && count < expectedLo * 0.75) status = 'low'
  else if (count > hi * frac + 2) status = 'high'
  const parts = [`${count} feed${count === 1 ? '' : 's'} so far · typical ${lo}–${hi} a day`]
  if (totalOz && norm.ozPerDay) parts.push(`${Math.round(totalOz * 10) / 10} oz of ${norm.ozPerDay[0]}–${norm.ozPerDay[1]} oz`)
  return { status, text: parts.join(' · '), norm }
}

/**
 * How much milk a day the baby's weight suggests. Rough, and stated as rough:
 * - AAP HealthyChildren: about 2½ oz a day per pound of body weight (≈163 mL/kg), and on average no more than
 *   about 32 oz (960 mL) in 24 hours.
 * - Hospital and NICU feeding plans treat 150 mL/kg a day as full feeds for a baby past the first week, and
 *   rarely go past 180 mL/kg without a dietitian.
 * So the band is 150–180 mL/kg a day with the AAP figure inside it, capped at 960 mL. It applies from two weeks
 * (before that intake is still climbing day by day while birth weight is regained) to six months (solids then
 * take part of the day). Exclusively breastfed babies level off around 750–800 mL a day from one to six months
 * (Kent 2006) whatever they weigh, so past the first months a heavy breastfed baby can sit under the band and be
 * fine; the doctor's growth check is what settles it.
 */
export const ML_PER_KG_DAY: [number, number] = [150, 180]
export const AAP_OZ_PER_LB_DAY = 2.5
export const MAX_ML_DAY = 960
export const BY_WEIGHT_FROM_DAY = 14
export const BY_WEIGHT_UNTIL_MONTHS = 6

export type ByWeight =
  | { applies: true; mlPerDay: [number, number]; aapMl: number; capped: boolean; sources: string[] }
  | { applies: false; reason: 'newborn' | 'solids'; sources: string[] }

export function feedingByWeight(weightKg: number, ageMonths: number, dayOfLife: number): ByWeight {
  const sources = ['hc-feeding-amount', 'kent-2006']
  if (dayOfLife < BY_WEIGHT_FROM_DAY) return { applies: false, reason: 'newborn', sources }
  if (ageMonths >= BY_WEIGHT_UNTIL_MONTHS) return { applies: false, reason: 'solids', sources }
  const lo = Math.min(MAX_ML_DAY, weightKg * ML_PER_KG_DAY[0])
  const hi = Math.min(MAX_ML_DAY, weightKg * ML_PER_KG_DAY[1])
  const aapMl = Math.min(MAX_ML_DAY, (weightKg / 0.45359237) * AAP_OZ_PER_LB_DAY * 29.5735)
  return { applies: true, mlPerDay: [lo, hi], aapMl, capped: weightKg * ML_PER_KG_DAY[1] > MAX_ML_DAY, sources }
}

/** Where a day's average sits against the band: under it by more than a tenth is low, over it by more than a tenth high. */
export function judgeByWeight(avgMl: number, band: [number, number]): 'low' | 'typical' | 'high' {
  if (avgMl < band[0] * 0.9) return 'low'
  if (avgMl > band[1] * 1.1) return 'high'
  return 'typical'
}

export const ALLERGENS = ['peanut', 'egg', 'cow’s milk', 'tree nuts', 'wheat', 'soy', 'fish', 'shellfish', 'sesame']

export const SOLIDS_GUIDANCE: { minMonths: number; title: string; body: string; sources: string[] }[] = [
  { minMonths: 0, title: 'Wait for readiness, around 6 months', body: 'Start solids when baby can sit with minimal support, has good head control, opens the mouth for a spoon, and moves food to the back of the tongue instead of pushing it out. Most babies get there at about 6 months; not before 4.', sources: ['cdc-solids'] },
  { minMonths: 4, title: 'Introduce allergens early, one at a time', body: 'Once a few first foods are tolerated, offer peanut (thinned peanut butter or puffs), egg, and other common allergens between 4–6 months, one new allergen at a time, in the morning, and keep offering them regularly. Early introduction lowers allergy risk. Ask your pediatrician first if baby has severe eczema or an egg allergy.', sources: ['aap-allergy-2019', 'niaid-peanut-2017'] },
  { minMonths: 6, title: 'Iron matters most from 6 months', body: 'Iron stores from birth run low around 6 months. Lead with iron-rich foods: pureed meats, iron-fortified cereal, beans, lentils, tofu. Pair with vitamin C foods (fruit, tomato) to boost absorption.', sources: ['aap-iron', 'cdc-solids'] },
  { minMonths: 6, title: 'Textures, not just purees', body: 'Move from smooth to lumpy to soft finger foods over the first months; babies who get textures by 9 months tend to eat a wider variety later. Cut round foods (grapes, hot dogs) lengthwise; avoid whole nuts, popcorn, and hard chunks.', sources: ['cdc-solids'] },
  { minMonths: 6, title: 'What to skip in year one', body: 'No honey (botulism risk), no cow’s milk as a drink, no added salt or sugar, and no juice. Small sips of water from an open cup are fine from 6 months.', sources: ['cdc-solids'] },
  { minMonths: 9, title: 'Let them lead', body: 'By 9–12 months most babies can self-feed soft pieces and drink from a cup. Offer three meals plus one or two snacks and let appetite decide amounts.', sources: ['cdc-solids'] },
]
