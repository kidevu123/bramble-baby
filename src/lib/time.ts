import {
  addMonths,
  differenceInMinutes,
  differenceInMonths,
  differenceInDays,
  differenceInWeeks,
  format,
  isSameDay,
  isToday,
  isYesterday,
  startOfDay,
} from 'date-fns'

export const MINUTE = 60_000
export const HOUR = 3_600_000

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Parses ISO strings; date-only values (birth dates) are treated as local dates, not UTC midnight. */
export function parseDate(value: string | Date): Date {
  if (value instanceof Date) return value
  if (DATE_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(value)
}

/** Parses a Django duration ("HH:MM:SS" or "D HH:MM:SS" or "D days, HH:MM:SS") to seconds. */
export function parseDuration(value: string | null | undefined): number {
  if (!value) return 0
  const m = value.match(/^(?:(\d+)\s*(?:days?,?\s*)?)?(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/)
  if (!m) return 0
  const [, d, h, mi, s] = m
  return (Number(d ?? 0) * 24 + Number(h)) * 3600 + Number(mi) * 60 + Number(s)
}

export function secondsBetween(start: string | Date, end: string | Date): number {
  return Math.max(0, Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / 1000))
}

/** "1h 20m", "45m", "0m" */
export function formatDurationShort(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** "00:06:36" style clock for live timers. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/** "just now", "5m ago", "2h 10m ago", "yesterday", "3d ago" */
export function formatAgo(value: string | Date, now: Date = new Date()): string {
  const mins = differenceInMinutes(now, parseDate(value))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m ? `${h}h ${m}m ago` : `${h}h ago`
  }
  const days = differenceInDays(startOfDay(now), startOfDay(parseDate(value)))
  return days === 1 ? 'yesterday' : `${days}d ago`
}

export function formatTime(value: string | Date): string {
  return format(parseDate(value), 'h:mm a')
}

/** "Today, 9:41 AM" · "Yesterday, 7:02 PM" · "Mar 3, 6:15 AM" */
export function formatWhen(value: string | Date, now: Date = new Date()): string {
  const d = parseDate(value)
  if (isToday(d)) return `Today, ${format(d, 'h:mm a')}`
  if (isYesterday(d)) return `Yesterday, ${format(d, 'h:mm a')}`
  if (d.getFullYear() === now.getFullYear()) return format(d, 'MMM d, h:mm a')
  return format(d, 'MMM d yyyy, h:mm a')
}

export function formatDayLabel(value: Date, now: Date = new Date()): string {
  if (isSameDay(value, now)) return 'Today'
  if (isYesterday(value)) return 'Yesterday'
  return format(value, 'EEEE, MMM d')
}

/** "3 mo 2 wk", "6 wk 3 d", "12 d", "2 yr 1 mo" */
export function formatAge(birthDate: string, now: Date = new Date()): string {
  const birth = startOfDay(parseDate(birthDate))
  const today = startOfDay(now)
  const days = differenceInDays(today, birth)
  if (days < 0) return 'not born yet'
  if (days < 14) return `${days} d`
  const months = differenceInMonths(today, birth)
  if (months < 3) {
    const weeks = differenceInWeeks(today, birth)
    const rem = days - weeks * 7
    return rem ? `${weeks} wk ${rem} d` : `${weeks} wk`
  }
  if (months < 24) {
    // Weeks since the last whole calendar month, at most 3: a 30- or 31-day month holds a fourth whole week,
    // and "3 mo 4 wk" a day before 4 mo reads as a unit nobody uses.
    const weeksAfterMonths = Math.min(3, differenceInWeeks(today, addMonths(birth, months)))
    return weeksAfterMonths > 0 ? `${months} mo ${weeksAfterMonths} wk` : `${months} mo`
  }
  const years = Math.floor(months / 12)
  const remMonths = months % 12
  return remMonths ? `${years} yr ${remMonths} mo` : `${years} yr`
}

export function ageInMonths(birthDate: string, now: Date = new Date()): number {
  const days = differenceInDays(startOfDay(now), startOfDay(parseDate(birthDate)))
  return Math.max(0, days / 30.4375)
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(value: string | Date): string {
  return format(parseDate(value), "yyyy-MM-dd'T'HH:mm")
}

export function fromLocalInput(value: string): Date {
  return new Date(value)
}

export function toIso(value: Date): string {
  return value.toISOString()
}

export function minutesSinceMidnight(value: Date): number {
  return value.getHours() * 60 + value.getMinutes() + value.getSeconds() / 60
}

/** "07:30" → 7.5. Falls back to the given default for malformed input. */
export function hhmmToHours(value: string | null | undefined, fallback = 0): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value ?? '')
  if (!m) return fallback
  const h = Number(m[1]) + Number(m[2]) / 60
  return h >= 0 && h < 24 ? h : fallback
}

/**
 * Day vs night for classifying a sleep as nap or night sleep. Pass the child's configured cut-offs
 * ("HH:mm"); the defaults mirror the shared child settings.
 */
export function isDaytime(value: Date, dayStart: number | string = 6, dayEnd: number | string = 19): boolean {
  const startH = typeof dayStart === 'string' ? hhmmToHours(dayStart, 6) : dayStart
  const endH = typeof dayEnd === 'string' ? hhmmToHours(dayEnd, 19) : dayEnd
  const h = value.getHours() + value.getMinutes() / 60
  return h >= startH && h < endH
}
