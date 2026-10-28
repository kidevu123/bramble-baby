import { convertLength, convertTemp, convertVolume, convertWeight, roundTo, type UnitPrefs } from './units'

/**
 * Baby Buddy stores bare numbers. Bramble therefore records, once per child and for good, which units
 * those numbers are in (`ChildSettings.storageUnits`, the "storage units"). Every phone reads and writes
 * in its own display units (`prefs.units`) and this module converts at the boundary, so changing a
 * display unit converts everything automatically and nothing stored is ever relabelled or rewritten.
 */
export type UnitKind = 'weight' | 'height' | 'head' | 'feeding' | 'pumping' | 'temperature'

const FIELD: Record<UnitKind, string> = {
  weight: 'weight',
  height: 'height',
  head: 'head_circumference',
  feeding: 'amount',
  pumping: 'amount',
  temperature: 'temperature',
}

/**
 * Stored values keep 6 decimals so a typed number survives display → storage → display unchanged
 * (7.5 lb → 3.401943 kg → 7.5 lb). Displayed values are rounded to what the unit sensibly expresses
 * (whole mL, hundredths of an oz, grams, tenths of a cm or °), so edit fields never show float noise.
 * Edit sheets leave an untouched number out of the PATCH so this rounding never drifts stored data.
 */
const STORAGE_PRECISION = 6

export function displayPrecision(kind: UnitKind, units: UnitPrefs): number {
  switch (kind) {
    case 'weight':
      return units.weight === 'kg' ? 3 : 2
    case 'height':
    case 'head':
      return 1
    case 'feeding':
    case 'pumping':
      return units.volume === 'ml' ? 0 : 2
    case 'temperature':
      return 1
  }
}

export function convertValue(kind: UnitKind, value: number, from: UnitPrefs, to: UnitPrefs, precision = displayPrecision(kind, to)): number {
  switch (kind) {
    case 'weight':
      return roundTo(convertWeight(value, from.weight, to.weight), precision)
    case 'height':
    case 'head':
      return roundTo(convertLength(value, from.length, to.length), precision)
    case 'feeding':
    case 'pumping':
      return roundTo(convertVolume(value, from.volume, to.volume), precision)
    case 'temperature':
      return roundTo(convertTemp(value, from.temp, to.temp), precision)
  }
}

export const sameUnits = (a: UnitPrefs, b: UnitPrefs): boolean => a.volume === b.volume && a.temp === b.temp && a.weight === b.weight && a.length === b.length

function convertField<T extends object>(kind: UnitKind, obj: T, from: UnitPrefs, to: UnitPrefs, precision: number): T {
  const field = FIELD[kind]
  const value = (obj as Record<string, unknown>)[field]
  if (typeof value !== 'number' || sameUnits(from, to)) return obj
  return { ...obj, [field]: convertValue(kind, value, from, to, precision) }
}

/** A row as Baby Buddy returned it → the same row in this phone's display units. */
export function entryToDisplay<T extends object>(kind: UnitKind, entry: T, storage: UnitPrefs, display: UnitPrefs): T {
  return convertField(kind, entry, storage, display, displayPrecision(kind, display))
}

/** A create/update body typed in display units → what to send Baby Buddy. */
export function bodyToStorage<T extends object>(kind: UnitKind, body: T, storage: UnitPrefs, display: UnitPrefs): T {
  return convertField(kind, body, display, storage, STORAGE_PRECISION)
}

export const listToDisplay = <T extends object>(kind: UnitKind, rows: T[], storage: UnitPrefs, display: UnitPrefs): T[] =>
  sameUnits(storage, display) ? rows : rows.map((r) => entryToDisplay(kind, r, storage, display))
