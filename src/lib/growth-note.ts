/**
 * Time of day for growth entries (weight, height, head circumference).
 *
 * Baby Buddy's growth models carry only a `date`, so the clock time lives in the entry's `notes` as one
 * ` · `-separated segment of the form `8:38 AM` (12-hour, two-digit minutes, AM/PM). The companion's
 * Hatch import writes `Hatch Grow scale · 8:38 AM[ · note]` (server/hatch.py `_note`), the growth sheet
 * writes `8:38 AM[ · note]`. Readers accept the segment in any position; the writer puts the segment
 * back where it found it (`slot`), so editing never reorders a note. A note without a segment is an
 * entry without a time: the timeline shows it at noon, the sheet asks for a time.
 *
 * A weighing taken with a diaper on is stored as the naked weight, and the deduction rides in the note as one more
 * segment, `diaper −25 g` (Settings › Weighing holds the dry diaper's weight), so the entry says what was taken off
 * and an edit can put the scale's own reading back on the sheet.
 */
import { format } from 'date-fns'
import type { GrowthEntry } from './api/types'
import { parseDate } from './time'
import { convertWeight, formatWeight, type WeightUnit } from './units'

const SEPARATOR = ' · '
const CLOCK = /^\s*(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?\s*$/
const DIAPER = /^\s*diaper\s*[−–-]\s*(\d+(?:\.\d+)?)\s*g\s*$/i

export interface ClockTime {
  hours: number
  minutes: number
}

export interface GrowthNote {
  /** Local clock time found in the note, or null when the note carries none. */
  time: ClockTime | null
  /** The note without the clock segment: what the Notes field shows and the user edits. */
  text: string
  /** Segment index the clock sat at (0 when there was none), so an edit can put it back in place. */
  slot: number
  /** Grams of a dry diaper taken off this weighing (the stored weight is the naked one), or null when none was. */
  diaperGrams: number | null
}

function parseDiaper(segment: string): number | null {
  const m = DIAPER.exec(segment)
  if (!m) return null
  const g = Number(m[1])
  return g > 0 ? g : null
}

export const formatDiaperSegment = (grams: number) => `diaper −${Math.round(grams * 10) / 10} g`

/** "25 g (0.9 oz)" on a pounds phone, "25 g" on a kilogram one. */
export function diaperText(grams: number, unit: WeightUnit): string {
  const g = `${Math.round(grams * 10) / 10} g`
  return unit === 'lb' ? `${g} (${(convertWeight(grams / 1000, 'kg', 'lb') * 16).toFixed(1)} oz)` : g
}

/** A diaper's grams in the phone's weight unit, to take off a reading or put back on one. */
export const diaperInUnit = (grams: number, unit: WeightUnit) => convertWeight(grams / 1000, 'kg', unit)

export { formatWeight }

function parseClock(segment: string): ClockTime | null {
  const m = CLOCK.exec(segment)
  if (!m) return null
  const h12 = Number(m[1])
  const minutes = Number(m[2])
  if (h12 < 1 || h12 > 12 || minutes > 59) return null
  const pm = m[3].toLowerCase() === 'p'
  const hours = (h12 % 12) + (pm ? 12 : 0)
  return { hours, minutes }
}

export function formatClockSegment(time: Date): string {
  return format(time, 'h:mm a')
}

export function decodeGrowthNote(notes: string | null | undefined): GrowthNote {
  const raw = notes ?? ''
  if (!raw) return { time: null, text: '', slot: 0, diaperGrams: null }
  const segments = raw.split(SEPARATOR)
  const diaperAt = segments.findIndex((s) => parseDiaper(s) !== null)
  const diaperGrams = diaperAt < 0 ? null : parseDiaper(segments[diaperAt])
  const withoutDiaper = segments.filter((_, i) => i !== diaperAt)
  const slot = withoutDiaper.findIndex((s) => parseClock(s) !== null)
  if (slot < 0) return { time: null, text: withoutDiaper.join(SEPARATOR), slot: 0, diaperGrams }
  const time = parseClock(withoutDiaper[slot])
  const rest = withoutDiaper.filter((_, i) => i !== slot)
  return { time, text: rest.join(SEPARATOR), slot, diaperGrams }
}

/**
 * The note to store: `text` (any clock or diaper segment it already holds is dropped, so nothing doubles) with the
 * clock inserted at `slot` (clamped to the end), or `text` alone when there is no time; the diaper segment, when a
 * dry diaper's grams were taken off the weighing, goes last.
 */
export function encodeGrowthNote(text: string, time: Date | null, slot = 0, diaperGrams: number | null = null): string {
  const clean = decodeGrowthNote(text).text
  const segments = clean ? clean.split(SEPARATOR) : []
  const at = Math.max(0, Math.min(slot, segments.length))
  const withClock = time ? [...segments.slice(0, at), formatClockSegment(time), ...segments.slice(at)] : segments
  return [...withClock, ...(diaperGrams && diaperGrams > 0 ? [formatDiaperSegment(diaperGrams)] : [])].join(SEPARATOR)
}

/** The clock in `notes` placed on the local calendar day `date` (YYYY-MM-DD), or null without a clock. */
export function growthNoteTime(date: string, notes: string | null | undefined): Date | null {
  const { time } = decodeGrowthNote(notes)
  if (!time) return null
  const at = parseDate(date)
  at.setHours(time.hours, time.minutes, 0, 0)
  return at
}

export function growthEntryTime(entry: GrowthEntry): Date | null {
  return growthNoteTime(entry.date, entry.notes)
}
