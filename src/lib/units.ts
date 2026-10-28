export type VolumeUnit = 'ml' | 'oz'
export type TempUnit = 'c' | 'f'
export type WeightUnit = 'kg' | 'lb'
export type LengthUnit = 'cm' | 'in'

export interface UnitPrefs {
  volume: VolumeUnit
  temp: TempUnit
  weight: WeightUnit
  length: LengthUnit
}

export const DEFAULT_UNITS: UnitPrefs = { volume: 'oz', temp: 'f', weight: 'lb', length: 'in' }

const ML_PER_OZ = 29.5735
const KG_PER_LB = 0.45359237
const CM_PER_IN = 2.54

/**
 * Baby Buddy stores raw floats with no unit. Bramble stores every number in the household's chosen unit
 * (shared through the companion's child settings) and labels it; switching a unit in Settings offers to
 * convert the stored rows (see unit-migration.ts) so old entries never get relabelled by mistake.
 */
/** How a volume unit is written in the UI ("mL", not "ml"). */
export const volumeLabel = (unit: VolumeUnit): string => (unit === 'ml' ? 'mL' : 'oz')

export function formatVolume(amount: number | null | undefined, unit: VolumeUnit): string {
  if (amount === null || amount === undefined) return ''
  const n = unit === 'oz' ? roundTo(amount, 2) : Math.round(amount)
  return `${n} ${volumeLabel(unit)}`
}

export function convertVolume(amount: number, from: VolumeUnit, to: VolumeUnit): number {
  if (from === to) return amount
  return from === 'ml' ? amount / ML_PER_OZ : amount * ML_PER_OZ
}

export function formatTemp(value: number, unit: TempUnit): string {
  return `${roundTo(value, 1)}°${unit.toUpperCase()}`
}

export function convertTemp(value: number, from: TempUnit, to: TempUnit): number {
  if (from === to) return value
  return from === 'f' ? ((value - 32) * 5) / 9 : (value * 9) / 5 + 32
}

export function formatWeight(value: number, unit: WeightUnit): string {
  if (unit === 'lb') {
    const lb = Math.floor(value)
    const oz = Math.round((value - lb) * 16)
    return oz === 16 ? `${lb + 1} lb` : oz ? `${lb} lb ${oz} oz` : `${lb} lb`
  }
  return `${roundTo(value, 2)} kg`
}

/**
 * A pounds weight as the two numbers a hospital writes, "5 lb 15.5 oz": whole pounds and ounces to the
 * quarter ounce (a stored weight comes back rounded to 0.01 lb, about 0.16 oz, so finer would only show noise).
 */
export function splitPounds(value: number): { lb: string; oz: string } {
  let lb = Math.floor(value)
  let oz = Math.round((value - lb) * 16 * 4) / 4
  if (oz >= 16) {
    lb += 1
    oz = 0
  }
  return { lb: String(lb), oz: String(oz) }
}

/** Pounds and ounces typed in two fields as decimal pounds; null while neither has a number, or ounces are 16+. */
export function joinPounds(lb: string, oz: string): number | null {
  const l = lb.trim() === '' ? 0 : Number(lb)
  const o = oz.trim() === '' ? 0 : Number(oz)
  if ((lb.trim() === '' && oz.trim() === '') || !Number.isFinite(l) || !Number.isFinite(o) || l < 0 || o < 0 || o >= 16) return null
  return l + o / 16
}

export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value
  return from === 'kg' ? value / KG_PER_LB : value * KG_PER_LB
}

export function formatLength(value: number, unit: LengthUnit): string {
  return unit === 'in' ? `${roundTo(value, 1)} in` : `${roundTo(value, 1)} cm`
}

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  if (from === to) return value
  return from === 'cm' ? value / CM_PER_IN : value * CM_PER_IN
}

export function roundTo(n: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}
