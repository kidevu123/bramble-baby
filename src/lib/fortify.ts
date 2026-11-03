/**
 * Fortified breast milk: how much formula to stir into a measure of milk for the strength the doctor asked for.
 *
 * The arithmetic is a mixture: the milk's calories plus the powder's, over the milk's volume plus what the powder
 * takes up. With 20 kcal/oz milk and a standard 20 kcal/oz powder (about 5.1 kcal and 0.77 mL a gram, Pediatric
 * Nutrition Practice Group of the Academy of Nutrition and Dietetics, caloric values table 2019), every row of a
 * children's hospital's home chart (22, 24, 26 and 28 kcal/oz, ½ teaspoon to 3½ tablespoons) comes out within
 * 0.6 kcal/oz of the strength it is listed under (`fortify.test.ts`), so this is the same recipe worked out for
 * any amount rather than read off a table.
 *
 * What is assumed and said so in the app:
 * - Breast milk is counted at 20 kcal/oz, as the hospital charts do. Real milk varies (studies of mothers' milk find
 *   averages of 18–20 and single samples from about 12 to 30), so the strength is a target, not a measurement;
 *   the weight checks are what show whether it is enough.
 * - Spoons are level and unpacked; teaspoons differ by brand (about 2.1 g of Similac, 2.4 g of Enfamil, 2.5 g of Bobbie),
 *   which is why the powder is a setting, and a spoon weight is taken only from the maker's published figure.
 * - Liquid concentrate (40 kcal/oz) is the other way to fortify: sterile until opened, nothing to clump or level.
 *   CDC advises liquid rather than powdered formula for babies under 2 months, born early or with weak immunity,
 *   because powder is not sterile. Which one to use is the care team's call.
 * - Fortified milk goes in the fridge at once and is thrown away 24 hours after mixing; leftovers in a bottle
 *   after a feed are thrown away.
 */
import { convertVolume, ML_PER_OZ } from './units'

/** What a plain feed is counted at: breast milk (as the hospital charts count it) and standard formula. */
export const MILK_KCAL_PER_OZ = 20
export const FORMULA_KCAL_PER_OZ = 20
/** Standard liquid concentrate before water is added. */
export const CONCENTRATE_KCAL_PER_OZ = 40
/** Fortified milk keeps a day in the fridge from when it is mixed. */
export const FORTIFIED_KEEP_HOURS = 24
/** The strengths a home recipe is written for; past 30 kcal/oz the care team mixes something else. */
export const STRENGTHS = [22, 24, 26, 27, 28, 30] as const
export const MIN_STRENGTH = 21
export const MAX_STRENGTH = 30
/** Off by more than this from the target, a measured spoonful is too coarse for the batch. */
export const MEASURE_TOLERANCE = 0.6

export interface Powder {
  id: string
  name: string
  kcalPerG: number
  gPerScoop: number
  /** A level, unpacked tablespoon; a teaspoon is a third of it. */
  gPerTbsp: number
  /** How much volume a gram of powder takes up once dissolved. */
  mlPerG: number
}

/** Standard 20 kcal/oz powders (PNPG table, 2019; Bobbie from its own guide). The can's label wins when it says otherwise. */
export const POWDERS: Powder[] = [
  { id: 'standard', name: 'Standard formula', kcalPerG: 5.1, gPerScoop: 8.7, gPerTbsp: 6.6, mlPerG: 0.77 },
  { id: 'similac', name: 'Similac', kcalPerG: 5.12, gPerScoop: 8.7, gPerTbsp: 6.25, mlPerG: 0.77 },
  { id: 'enfamil', name: 'Enfamil', kcalPerG: 5.1, gPerScoop: 8.8, gPerTbsp: 7.1, mlPerG: 0.77 },
  { id: 'gerber', name: 'Gerber Good Start', kcalPerG: 5.12, gPerScoop: 8.7, gPerTbsp: 6.5, mlPerG: 0.76 },
  // Bobbie's own figures for its organic infant formula: 8.6 g and 44.2 kcal a level, unpacked scoop, 0.78 mL a gram, and
  // from its healthcare-professional spec sheet **2.49 g a level teaspoon, 7.48 g a tablespoon**. One scoop to 2 fl oz of water
  // is 20 kcal/oz. Until 1.53.3 the spoon weight was derived from Bobbie's loose "a scoop is about 1½ tablespoons" (1.9 g a
  // teaspoon), which wrote ½ teaspoon where ⅓ was right; a spoon weight comes only from the maker's published figure.
  { id: 'bobbie', name: 'Bobbie', kcalPerG: 5.14, gPerScoop: 8.6, gPerTbsp: 7.47, mlPerG: 0.78 },
]

export type FortifyWith = 'powder' | 'concentrate'

/** The household's fortification (Settings › Calories & fortifying), shared by every phone. */
export interface FortifySettings {
  /** The strength the doctor asked for, kcal per ounce. */
  kcalPerOz: number
  with: FortifyWith
  /** A `POWDERS` id, or 'custom' with `custom` from the can's label. */
  powder: string
  custom?: { kcalPerScoop: number; gPerScoop: number } | null
  /** The day it started (yyyy-MM-dd). */
  since?: string | null
}

export function powderOf(f: Pick<FortifySettings, 'powder' | 'custom'>): Powder {
  if (f.powder === 'custom' && f.custom && f.custom.gPerScoop > 0 && f.custom.kcalPerScoop > 0) {
    const base = POWDERS[0]
    return { ...base, id: 'custom', name: 'From the can', kcalPerG: f.custom.kcalPerScoop / f.custom.gPerScoop, gPerScoop: f.custom.gPerScoop }
  }
  return POWDERS.find((p) => p.id === f.powder) ?? POWDERS[0]
}

export const validStrength = (kcal: unknown): kcal is number => typeof kcal === 'number' && Number.isFinite(kcal) && kcal >= MIN_STRENGTH && kcal <= MAX_STRENGTH

const perMl = (kcalPerOz: number) => kcalPerOz / ML_PER_OZ

/** Grams of powder for `milkMl` of milk to reach `target` kcal/oz. */
export function powderGrams(milkMl: number, target: number, powder: Powder, milkKcal = MILK_KCAL_PER_OZ): number {
  const t = perMl(target)
  const b = perMl(milkKcal)
  if (milkMl <= 0 || t <= b) return 0
  return (milkMl * (t - b)) / (powder.kcalPerG - t * powder.mlPerG)
}

/** What `grams` of powder in `milkMl` of milk really makes, kcal/oz, and how much there is. */
export function mixWithPowder(milkMl: number, grams: number, powder: Powder, milkKcal = MILK_KCAL_PER_OZ): { kcalPerOz: number; ml: number } {
  const ml = milkMl + grams * powder.mlPerG
  return { kcalPerOz: ml > 0 ? ((milkMl * perMl(milkKcal) + grams * powder.kcalPerG) / ml) * ML_PER_OZ : 0, ml }
}

/** Millilitres of liquid concentrate for `milkMl` of milk to reach `target` kcal/oz. */
export function concentrateMl(milkMl: number, target: number, milkKcal = MILK_KCAL_PER_OZ, concentrate = CONCENTRATE_KCAL_PER_OZ): number {
  if (milkMl <= 0 || target <= milkKcal || target >= concentrate) return 0
  return (milkMl * (target - milkKcal)) / (concentrate - target)
}

const FRACTIONS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞']
/** The finest spoon in a measuring set. */
export const SPOON_STEPS_PER_TSP = 8

/** "1 tablespoon + 1½ teaspoons": eighth teaspoons as a measuring set has them (⅛, ¼, ½, 1). */
export function spoonText(eighths: number): string {
  const tbsp = Math.floor(eighths / 24)
  const rest = eighths % 24
  const whole = Math.floor(rest / 8)
  const frac = FRACTIONS[rest % 8]
  const parts: string[] = []
  if (tbsp) parts.push(`${tbsp} tablespoon${tbsp === 1 ? '' : 's'}`)
  if (whole || frac) {
    const n = `${whole || ''}${frac}`
    parts.push(`${n} teaspoon${whole > 1 || (whole === 1 && frac) ? 's' : ''}`)
  }
  return parts.join(' + ')
}

export interface PowderStep {
  with: 'powder'
  /** "1 teaspoon + ⅛ teaspoon" as level, unpacked spoons, to the nearest ⅛ teaspoon. */
  spoons: string
  /** "1 scoop" when whole scoops come within a few percent of it, else null. */
  scoops: string | null
  grams: number
  /** The exact amount for a kitchen scale, to 0.1 g (Bobbie, for one, advises weighing powder on a gram scale). */
  scaleGrams: number
  /** "Bobbie", or "powder" for the standard figures and a can typed in. */
  powderName: string
  /** What the spoons really make. */
  kcalPerOz: number
  ml: number
  /** The batch is too small for a spoon to reach the strength (more than `MEASURE_TOLERANCE` off). */
  tooSmall: boolean
}

export interface ConcentrateStep {
  with: 'concentrate'
  /** Millilitres of concentrate, rounded to the mL. */
  addMl: number
  kcalPerOz: number
  ml: number
  tooSmall: boolean
}

export type Recipe = PowderStep | ConcentrateStep

/** The recipe for one measure of milk, in the household's way of fortifying. */
export function recipeFor(milkMl: number, f: FortifySettings, milkKcal = MILK_KCAL_PER_OZ): Recipe {
  if (f.with === 'concentrate') {
    const addMl = Math.max(0, Math.round(concentrateMl(milkMl, f.kcalPerOz, milkKcal)))
    const ml = milkMl + addMl
    const kcalPerOz = ml > 0 ? (milkMl * milkKcal + addMl * CONCENTRATE_KCAL_PER_OZ) / ml : 0
    return { with: 'concentrate', addMl, kcalPerOz, ml, tooSmall: addMl < 1 || Math.abs(kcalPerOz - f.kcalPerOz) > MEASURE_TOLERANCE }
  }
  const powder = powderOf(f)
  const exact = powderGrams(milkMl, f.kcalPerOz, powder, milkKcal)
  const step = powder.gPerTbsp / 3 / SPOON_STEPS_PER_TSP
  const steps = Math.round(exact / step)
  const grams = steps * step
  const mixed = mixWithPowder(milkMl, grams, powder, milkKcal)
  const wholeScoops = Math.round(exact / powder.gPerScoop)
  const scoops = wholeScoops >= 1 && Math.abs(wholeScoops * powder.gPerScoop - exact) <= exact * 0.05 ? `${wholeScoops} scoop${wholeScoops === 1 ? '' : 's'}` : null
  return {
    with: 'powder',
    spoons: steps ? spoonText(steps) : 'less than ⅛ teaspoon',
    scoops,
    grams,
    scaleGrams: Math.round(exact * 10) / 10,
    powderName: f.powder === 'standard' || f.powder === 'custom' ? 'powder' : powder.name,
    kcalPerOz: mixed.kcalPerOz,
    ml: mixed.ml,
    tooSmall: steps === 0 || Math.abs(mixed.kcalPerOz - f.kcalPerOz) > MEASURE_TOLERANCE,
  }
}

/** The smallest whole-ounce batch whose measured recipe lands within the tolerance (null past 32 oz). */
export function smallestBatchOz(f: FortifySettings): number | null {
  for (let oz = 1; oz <= 32; oz++) if (!recipeFor(convertVolume(oz, 'oz', 'ml'), f).tooSmall) return oz
  return null
}

/**
 * One line of what to add: "½ teaspoon of Bobbie, or 0.9 g on a scale" / "15 mL of liquid concentrate". The spoons and
 * the grams are two ways to measure, not the same amount: the grams are exact, the spoons the nearest level ⅛ teaspoon
 * (⅜ teaspoon of Bobbie weighs about 0.93 g), so they are never written as if one were the other.
 */
export function recipeText(r: Recipe): string {
  if (r.with === 'concentrate') return `${r.addMl} mL of liquid concentrate`
  return `${r.spoons} of ${r.powderName}${r.scoops ? ` (${r.scoops})` : ''}, or ${gramsText(r.scaleGrams)} on a scale`
}

/** How far the rounded spoons of these recipes land from their strength at worst, kcal/oz (the scale is exact). */
export function spoonDrift(recipes: Recipe[], target: number): number {
  return recipes.reduce((m, r) => (r.with === 'powder' && !r.tooSmall ? Math.max(m, Math.abs(r.kcalPerOz - target)) : m), 0)
}

/** "0.9 g", "12 g". */
export const gramsText = (g: number) => `${g < 10 ? Math.round(g * 10) / 10 : Math.round(g)} g`

/** "24 kcal/oz", whole when it is whole. */
export const strengthText = (kcal: number) => `${Math.round(kcal * 10) / 10} kcal/oz`
