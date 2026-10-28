/**
 * Calories by bottle: per feed, per day, and per kilogram a day, the figure a pediatrician raises when a baby needs
 * to grow faster.
 *
 * A bottle's strength rides on the feeding as a `kcal:<n>` tag (like `pump:` and `caregiver:`; Baby Buddy has no
 * field for it): written for every fortified bottle the app saves, so a later change of recipe never rewrites the
 * past. Without a tag, breast milk and standard formula count at 20 kcal/oz and fortified milk at the household's
 * strength. Nursing has no volume, so its calories are unknown: a day with nursing is "bottles only", never judged.
 *
 * Targets (said in the app, set by the doctor): healthy term babies under 6 months take about 100–120 kcal/kg a day
 * (Merck Manual), and catch-up growth is planned around 120–150 (NASPGHAN estimates about 150 for under-ones).
 * There is no verdict against those bands; only against the doctor's own number, when it is set.
 */
import type { Feeding } from './api/types'
import { FORMULA_KCAL_PER_OZ, MILK_KCAL_PER_OZ, validStrength, type FortifySettings } from './fortify'
import { convertVolume, ML_PER_OZ, type VolumeUnit } from './units'

const PREFIX = 'kcal:'

/** Under 6 months, a healthy term baby's usual range (kcal/kg/day). Shown, never judged against. */
export const TYPICAL_KCAL_PER_KG: [number, number] = [100, 120]
/** A daily average this far under the doctor's goal reads as under it. */
export const GOAL_SLACK = 0.05

export const kcalTag = (kcal: number) => `${PREFIX}${Math.round(kcal * 10) / 10}`

/** The strength a feed was mixed at, from its tags. */
export function kcalOf(tags: string[] | null | undefined): number | null {
  const tag = (tags ?? []).find((t) => t.startsWith(PREFIX))
  const n = tag ? Number(tag.slice(PREFIX.length)) : NaN
  return Number.isFinite(n) && n > 0 && n <= 60 ? n : null
}

/** The feed's tags with its strength set (or cleared), every other tag kept. */
export function withKcalTag(tags: string[] | null | undefined, kcal: number | null): string[] {
  const rest = (tags ?? []).filter((t) => !t.startsWith(PREFIX))
  return kcal ? [...rest, kcalTag(kcal)] : rest
}

export interface FeedStrength {
  kcalPerOz: number
  /** Fortified with no strength on it and none set for the household: counted at 20, said so. */
  unknown: boolean
}

/** What a bottle is counted at, kcal/oz; null for nursing and solids (no volume). */
export function feedStrength(f: Pick<Feeding, 'type' | 'method' | 'tags'>, fortify?: FortifySettings | null): FeedStrength | null {
  if (f.method !== 'bottle' || f.type === 'solid food') return null
  const tagged = kcalOf(f.tags)
  if (tagged) return { kcalPerOz: tagged, unknown: false }
  if (f.type === 'formula') return { kcalPerOz: FORMULA_KCAL_PER_OZ, unknown: false }
  if (f.type === 'fortified breast milk') return fortify && validStrength(fortify.kcalPerOz) ? { kcalPerOz: fortify.kcalPerOz, unknown: false } : { kcalPerOz: MILK_KCAL_PER_OZ, unknown: true }
  return { kcalPerOz: MILK_KCAL_PER_OZ, unknown: false }
}

/** Calories in `ml` at `kcalPerOz`. */
export const kcalIn = (ml: number, kcalPerOz: number) => (ml * kcalPerOz) / ML_PER_OZ

/** A bottle's calories, its amount read in `unit` (the phone's display unit); null without an amount. */
export function feedKcal(f: Pick<Feeding, 'type' | 'method' | 'tags' | 'amount'>, unit: VolumeUnit, fortify?: FortifySettings | null): number | null {
  const s = feedStrength(f, fortify)
  if (!s || !f.amount || f.amount <= 0) return null
  return kcalIn(convertVolume(f.amount, unit, 'ml'), s.kcalPerOz)
}

export interface DayCalories {
  kcal: number
  bottles: number
  /** Any nursing that day: its calories are not in `kcal`. */
  nursing: boolean
  /** A fortified bottle counted at 20 because its strength is unknown. */
  unknown: boolean
}

export function dayCalories(feeds: Pick<Feeding, 'type' | 'method' | 'tags' | 'amount'>[], unit: VolumeUnit, fortify?: FortifySettings | null): DayCalories {
  let kcal = 0
  let bottles = 0
  let nursing = false
  let unknown = false
  for (const f of feeds) {
    if (f.type === 'solid food') continue
    if (f.method !== 'bottle') {
      nursing = true
      continue
    }
    const k = feedKcal(f, unit, fortify)
    if (k === null) continue
    kcal += k
    bottles += 1
    if (feedStrength(f, fortify)?.unknown) unknown = true
  }
  return { kcal, bottles, nursing, unknown }
}

/** The weight that applies to a day: the latest weighing on or before its end, else the first one after it. */
export function weightForDay(weights: { kg: number; at: Date }[], dayEnd: Date): number | null {
  if (!weights.length) return null
  const sorted = [...weights].sort((a, b) => a.at.getTime() - b.at.getTime())
  const before = sorted.filter((w) => w.at.getTime() <= dayEnd.getTime())
  return (before.length ? before[before.length - 1] : sorted[0]).kg
}

export type GoalStatus = 'under' | 'met'

/** The average against the doctor's goal; null when there is no goal or nursing makes the total unknown. */
export function judgeCalories(perKg: number, goal: number | null | undefined, nursing: boolean): GoalStatus | null {
  if (!goal || nursing || perKg <= 0) return null
  return perKg < goal * (1 - GOAL_SLACK) ? 'under' : 'met'
}

/** The bottle volume a day that reaches `goal` kcal/kg at `kcalPerOz` for a baby of `kg` (mL). */
export const mlForGoal = (goal: number, kg: number, kcalPerOz: number) => (goal * kg * ML_PER_OZ) / kcalPerOz
