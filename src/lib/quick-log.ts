/**
 * Quick logging: the one-tap answers to "when did this happen" for something logged after the fact, and
 * the pumping sheet's prefilled session, so an entry is usually "tap a chip, type the amount, Save".
 */
import { parseDate, secondsBetween } from './time'

export interface AgoOption {
  minutes: number
  label: string
}

/** The chips under a log sheet's time field. */
export const AGO_OPTIONS: AgoOption[] = [
  { minutes: 0, label: 'Just now' },
  { minutes: 15, label: '15 min ago' },
  { minutes: 30, label: '30 min ago' },
  { minutes: 60, label: '1 h ago' },
]

/** A chip reads as chosen while the time is within this of what it would set (a sheet left open drifts). */
const AGO_TOLERANCE_MS = 90_000

export function minutesAgo(minutes: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - minutes * 60_000)
}

/** The chip that matches a time, by its minutes, or null when the time was set by hand (or is in the future). */
export function agoChoice(value: Date | null, now: Date = new Date()): number | null {
  if (!value) return null
  const ago = now.getTime() - value.getTime()
  if (ago < -AGO_TOLERANCE_MS) return null
  const hit = AGO_OPTIONS.find((o) => Math.abs(ago - o.minutes * 60_000) <= AGO_TOLERANCE_MS)
  return hit ? hit.minutes : null
}

/** A start–end session moved so that it ends at `end`, keeping its length (a chip under "Finished:"). */
export function sessionEndingAt(start: Date, end: Date, newEnd: Date): { start: Date; end: Date } {
  const length = Math.max(0, end.getTime() - start.getTime())
  return { start: new Date(newEnd.getTime() - length), end: newEnd }
}

/** Pumping sheet default when there is no earlier session to copy. */
export const DEFAULT_PUMPING_SECONDS = 15 * 60
const MIN_SESSION_SECONDS = 60
const MAX_SESSION_SECONDS = 3 * 3600

/**
 * How long the most recent session lasted, in seconds, as the length to prefill the next one with; null
 * without a usable earlier session. Sessions under a minute or over three hours are timer mistakes, not
 * a routine, and are skipped.
 */
export function lastSessionSeconds(entries: { start: string; end: string }[]): number | null {
  const sorted = [...entries].sort((a, b) => parseDate(b.start).getTime() - parseDate(a.start).getTime())
  for (const e of sorted) {
    const seconds = secondsBetween(e.start, e.end)
    if (seconds >= MIN_SESSION_SECONDS && seconds <= MAX_SESSION_SECONDS) return Math.round(seconds / 60) * 60
  }
  return null
}
