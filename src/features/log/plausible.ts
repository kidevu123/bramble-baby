import type { TempUnit, VolumeUnit } from '../../lib/units'

/**
 * Soft checks for numbers that are almost certainly a slip (99999 mL, 9.86 °F for 98.6). The sheets show the
 * line above Save and never block it: an unusual value can be real, and the parent decides.
 */
const BOTTLE_MAX = { ml: 400, oz: 14 } as const
const PUMPING_MAX = { ml: 600, oz: 20 } as const
const TEMP_RANGE = { f: [94, 107], c: [34.5, 41.5] } as const

const shown = (n: number) => String(Math.round(n * 100) / 100)

export function bottleCheck(amount: number, unit: VolumeUnit): string | null {
  if (!(amount > BOTTLE_MAX[unit])) return null
  return `${shown(amount)} ${unit === 'ml' ? 'mL' : 'oz'} is a lot for one bottle. Check the number; you can still save it.`
}

export function pumpingCheck(amount: number, unit: VolumeUnit): string | null {
  if (!(amount > PUMPING_MAX[unit])) return null
  return `${shown(amount)} ${unit === 'ml' ? 'mL' : 'oz'} is a lot for one session. Check the number; you can still save it.`
}

export function temperatureCheck(value: number, unit: TempUnit): string | null {
  if (!(value > 0)) return null
  const [lo, hi] = TEMP_RANGE[unit]
  if (value >= lo && value <= hi) return null
  return `${shown(value)} °${unit.toUpperCase()} is outside what a thermometer reads on a baby (${lo}–${hi} °${unit.toUpperCase()}). Check the number; you can still save it.`
}
