import { format, startOfDay } from 'date-fns'
import type { BarDay } from './charts'
import type { EventSets } from '../../lib/events'
import { parseDate } from '../../lib/time'
import { convertVolume, type VolumeUnit, type WeightUnit } from '../../lib/units'

/** "20:00" → "8:00 PM", "07:30" → "7:30 AM": the 12-hour clock every other screen uses. */
export function clock12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim())
  if (!m) return hhmm
  const h = Number(m[1]) % 24
  return `${((h + 11) % 12) + 1}:${m[2]}\u00a0${h >= 12 ? 'PM' : 'AM'}`
}

/** A bedtime band, short enough for a tile: "20:00"–"23:00" → "8–11 PM", "19:30"–"21:00" → "7:30–9 PM". */
export function clockRange(range: [string, string]): string {
  const parts = range.map((t) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(t.trim())
    if (!m) return null
    const h = Number(m[1]) % 24
    return { clock: `${((h + 11) % 12) + 1}${m[2] === '00' ? '' : `:${m[2]}`}`, mer: h >= 12 ? 'PM' : 'AM' }
  })
  const [a, b] = parts
  if (!a || !b) return `${range[0]}–${range[1]}`
  return a.mer === b.mer ? `${a.clock}–${b.clock}\u00a0${b.mer}` : `${a.clock}\u00a0${a.mer}–${b.clock}\u00a0${b.mer}`
}

function roundMl(ml: number): number {
  return ml < 30 ? Math.round(ml / 5) * 5 : Math.round(ml / 10) * 10
}

/**
 * Science notes are written in ounces ("2–3 oz every 3–4 hours"). On a mL phone every "N oz" or "N–M oz"
 * becomes mL, rounded the way a person would say it (5 mL steps under 30, 10 mL above); an oz phone reads
 * the text as written.
 */
export function ozText(text: string, unit: VolumeUnit): string {
  if (unit === 'oz') return text
  return text.replace(/(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s*oz\b/g, (_all, a: string, b?: string) => {
    const lo = roundMl(convertVolume(Number(a), 'oz', 'ml'))
    if (b === undefined) return `${lo} mL`
    return `${lo}–${roundMl(convertVolume(Number(b), 'oz', 'ml'))} mL`
  })
}

/** An ounce band [2, 3] in the phone's unit: "2–3 oz" or "60–90 mL". */
export function ozRange(range: [number, number], unit: VolumeUnit): string {
  return ozText(`${range[0]}–${range[1]} oz`, unit)
}

/**
 * Axis ticks on round numbers: a step of 1, 2 or 5 × 10ⁿ, the top raised to the next multiple, so every
 * gridline sits where its label says. `integer` keeps count axes on whole steps (never 2.5 feeds).
 */
export function niceTicks(max: number, target = 4, integer = false): { top: number; ticks: number[] } {
  const want = Math.max(max, 1e-9) / target
  const pow = 10 ** Math.floor(Math.log10(want))
  const mults = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]
  const found = mults.map((m) => m * pow).find((s) => s >= want - 1e-12) ?? 10 * pow
  const step = integer ? Math.max(1, Math.round(found)) : found
  const top = Math.max(step, Math.ceil(max / step - 1e-9) * step)
  const ticks: number[] = []
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return { top, ticks }
}

/** Tick steps for a pounds axis: 1, 2, 4 and 8 oz, then whole pounds, so every label reads "5 lb 12 oz". */
export const LB_STEPS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 5, 10]

/**
 * The y range of a line chart: the values with a little room above and below, never narrower than `minSpan`
 * (so a flat week does not turn 1 oz into a cliff), and round ticks inside it, at most `maxTicks`. `steps` are
 * the allowed tick steps (ounces on a pounds axis); without them, or when none fits, a 1/2/2.5/5 step.
 */
export function lineDomain(values: number[], minSpan: number, steps?: number[], maxTicks = 5): { min: number; max: number; ticks: number[] } {
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  minSpan = minSpan > 0 ? minSpan : 1 // all zeros with no span given would divide by zero
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2
    lo = mid - minSpan / 2
    hi = mid + minSpan / 2
  }
  const pad = (hi - lo) * 0.08
  const min = Math.min(...values) >= 0 ? Math.max(0, lo - pad) : lo - pad
  const max = hi + pad
  const range = max - min
  const step = steps?.find((s) => range / s <= maxTicks) ?? (niceTicks(range, maxTicks - 1).ticks[1] || range)
  const ticks: number[] = []
  for (let t = Math.ceil(min / step - 1e-9) * step; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 1e6) / 1e6)
  return { min, max, ticks }
}

/** A weight axis label in the phone's format: "8 lb 3 oz" (no zero ounces: "8 lb"), or "3.7 kg". */
export function weightTick(v: number, unit: WeightUnit): string {
  if (unit === 'kg') return `${(Math.round(v * 10) / 10).toFixed(1)} kg`
  let lb = Math.floor(v)
  let oz = Math.round((v - lb) * 16)
  if (oz === 16) {
    lb += 1
    oz = 0
  }
  return oz ? `${lb} lb ${oz} oz` : `${lb} lb`
}

/**
 * Which days a report's daily average counts: the full days of the range that carry a value (today is not
 * over, so its half-day would drag every average down). Only when no full day has anything does today
 * count, so a brand-new log still shows a number.
 */
export function averagedDays(values: number[], days: Date[], now: Date): number[] {
  const today = startOfDay(now).getTime()
  const full = values.flatMap((v, i) => (v > 0 && days[i].getTime() < today ? [i] : []))
  if (full.length) return full
  return values.flatMap((v, i) => (v > 0 && days[i].getTime() === today ? [i] : []))
}

/** The mean of `values` over `averagedDays` (0 when nothing was logged). */
export function fullDayAverage(values: number[], days: Date[], now: Date): number {
  const used = averagedDays(values, days, now)
  return used.length ? used.reduce((s, i) => s + values[i], 0) / used.length : 0
}

/** An hour-axis label: "12a" at both midnights (the top and the bottom of a day), "6a", "12p", "6p". */
export function hourTick(h: number): string {
  const hour = ((h % 24) + 24) % 24
  return hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`
}

/** A day's diapers as bar segments: a mixed one (wet and poo) counts once, in its own colour. */
export function diaperSplit(changes: { wet: boolean; solid: boolean }[]): { wet: number; poo: number; mixed: number } {
  const mixed = changes.filter((c) => c.wet && c.solid).length
  return { wet: changes.filter((c) => c.wet && !c.solid).length, poo: changes.filter((c) => c.solid && !c.wet).length, mixed }
}

/** The lists Summary counts, kept to the range (the events cover more when the Day view was paged back). */
export function keepToRange(events: EventSets, since: number): EventSets {
  const inRange = (when: string) => parseDate(when).getTime() >= since
  return {
    ...events,
    feedings: events.feedings.filter((f) => inRange(f.start)),
    activities: events.activities.filter((a) => inRange(a.start)),
    tummy: events.tummy.filter((t) => inRange(t.start)),
    medication: events.medication.filter((m) => inRange(m.time)),
    temperature: events.temperature.filter((t) => inRange(t.time)),
  }
}

/** "395–475 mL" / "13.5–16 oz": a daily band from the weight, to 5 mL or half an ounce (never to the millilitre). */
export function volumeRange(loMl: number, hiMl: number, unit: VolumeUnit): string {
  if (unit === 'oz') {
    const oz = (ml: number) => Math.round(convertVolume(ml, 'ml', 'oz') * 2) / 2
    return `${oz(loMl)}–${oz(hiMl)} oz`
  }
  return `${Math.round(loMl / 5) * 5}–${Math.round(hiMl / 5) * 5} mL`
}

/** What a tapped bar says: its total, its day, and the parts of a stacked bar. */
export function barText(d: BarDay, say: (v: number) => string, sayPart: (v: number) => string = say): { value: string; when: string; change: string | null } {
  const named = d.parts.filter((p) => p.name)
  const total = d.parts.reduce((s, p) => s + p.value, 0)
  const parts = named.length > 1 ? named.filter((p) => p.value > 0).map((p) => `${p.name} ${sayPart(p.value)}`).join(' · ') : ''
  return { value: say(total), when: d.date ? format(d.date, 'EEE, MMM d') : d.label, change: parts || null }
}
