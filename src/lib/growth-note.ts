/**
 * Time of day for growth entries (weight, height, head circumference).
 *
 * Baby Buddy's growth models carry only a `date`, so the clock time lives in the entry's `notes` as one
 * ` · `-separated segment of the form `8:38 AM` (12-hour, two-digit minutes, AM/PM). The companion's
 * Hatch import writes `Hatch Grow scale · 8:38 AM[ · note]` (server/hatch.py `_note`), the growth sheet
 * writes `8:38 AM[ · note]`. Readers accept the segment in any position; the writer puts the segment
 * back where it found it (`slot`), so editing never reorders a note. A note without a segment is an
 * entry without a time: the timeline shows it at noon, the sheet asks for a time.
 */
import { format } from 'date-fns'
import type { GrowthEntry } from './api/types'
import { parseDate } from './time'

const SEPARATOR = ' · '
const CLOCK = /^\s*(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?\s*$/

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
}

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
  if (!raw) return { time: null, text: '', slot: 0 }
  const segments = raw.split(SEPARATOR)
  const slot = segments.findIndex((s) => parseClock(s) !== null)
  if (slot < 0) return { time: null, text: raw, slot: 0 }
  const time = parseClock(segments[slot])
  const rest = segments.filter((_, i) => i !== slot)
  return { time, text: rest.join(SEPARATOR), slot }
}

/**
 * The note to store: `text` (any clock segment it already holds is dropped, so nothing doubles) with the
 * clock inserted at `slot` (clamped to the end), or `text` alone when there is no time.
 */
export function encodeGrowthNote(text: string, time: Date | null, slot = 0): string {
  const clean = decodeGrowthNote(text).text
  if (!time) return clean
  const segments = clean ? clean.split(SEPARATOR) : []
  const at = Math.max(0, Math.min(slot, segments.length))
  return [...segments.slice(0, at), formatClockSegment(time), ...segments.slice(at)].join(SEPARATOR)
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
