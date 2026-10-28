import { ageWakeWindow } from './nap-window'

export interface ScheduleItem {
  kind: 'wake' | 'nap' | 'bedtime' | 'feed'
  /** HH:mm, 24h */
  start: string
  end?: string
  label: string
  note?: string
  /** Minutes from midnight of the wake day, not wrapped, so items order correctly across midnight. */
  at: number
}

export interface ScheduleInput {
  ageMonths: number
  /** HH:mm */
  wakeTime: string
  wakeWindowMinutes?: number
  napsPerDay?: number
  napLengthMinutes?: number
  includeFeeds?: boolean
}

const EARLIEST_BEDTIME = 18 * 60
const LATEST_BEDTIME = 21 * 60
const FEED_INTERVAL_MINUTES = 180

export function formatHHmm(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function parseHHmm(s: string, base: Date): Date {
  const [h, m] = s.split(':').map(Number)
  const d = new Date(base)
  d.setHours(Number.isFinite(h) ? h : 7, Number.isFinite(m) ? m : 0, 0, 0)
  return d
}

function minutesToHHmm(total: number): string {
  const wrapped = ((Math.round(total) % 1440) + 1440) % 1440
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`
}

function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (Number.isFinite(h) ? h : 7) * 60 + (Number.isFinite(m) ? m : 0)
}

/** Typical nap length by age. Older babies consolidate into fewer, longer naps. */
export function typicalNapLength(ageMonths: number): number {
  if (ageMonths < 3) return 45
  if (ageMonths < 6) return 60
  if (ageMonths < 9) return 75
  if (ageMonths < 12) return 80
  if (ageMonths < 18) return 105
  if (ageMonths < 36) return 90
  return 60
}

export function ageStageLabel(ageMonths: number): string {
  if (ageMonths < 0) return 'Expecting'
  if (ageMonths < 3) return 'Newborn (0–3 mo)'
  if (ageMonths < 6) return 'Infant (3–6 mo)'
  if (ageMonths < 12) return 'Older infant (6–12 mo)'
  if (ageMonths < 24) return 'Toddler (12–24 mo)'
  if (ageMonths < 36) return 'Toddler (2–3 yr)'
  return 'Preschooler (3+ yr)'
}

/**
 * Builds a suggested day from a wake time: naps spaced by wake windows that grow
 * through the day (first shortest, last longest), then a bedtime clamped to 18:00–21:00.
 */
export function buildSchedule(input: ScheduleInput): ScheduleItem[] {
  const age = ageWakeWindow(input.ageMonths)
  const naps = input.napsPerDay ?? age.napsPerDay
  const midWindow = input.wakeWindowMinutes ?? Math.round((age.minMinutes + age.maxMinutes) / 2)
  const napLength = input.napLengthMinutes ?? typicalNapLength(input.ageMonths)
  const wakeMin = hhmmToMinutes(input.wakeTime)

  const items: ScheduleItem[] = [{ kind: 'wake', start: minutesToHHmm(wakeMin), label: 'Wake up', at: wakeMin }]

  // Spread windows from -15% (first) to +15% (last).
  const windowFor = (index: number, total: number) => {
    if (total <= 1) return midWindow
    const t = index / (total - 1)
    return Math.round(midWindow * (0.85 + 0.3 * t))
  }

  let cursor = wakeMin
  const windows = naps + 1
  let planned = 0
  for (let i = 0; i < naps; i++) {
    const w = windowFor(i, windows)
    const napStart = cursor + w
    const napEnd = napStart + napLength
    // A late wake time (or a long day) runs out of room: no nap may end after the latest bedtime,
    // otherwise the list shows naps after "Bedtime" and, once wrapped past midnight, before "Wake up".
    if (napEnd > LATEST_BEDTIME) break
    planned++
    items.push({
      kind: 'nap',
      start: minutesToHHmm(napStart),
      end: minutesToHHmm(napEnd),
      label: naps === 1 ? 'Nap' : `Nap ${i + 1}`,
      note: `after ${Math.floor(w / 60) ? `${Math.floor(w / 60)}h ` : ''}${w % 60 ? `${w % 60}m` : ''} awake`.replace(/\s+/g, ' '),
      at: napStart,
    })
    cursor = napEnd
  }

  const lastWindow = windowFor(windows - 1, windows)
  let bedtime = cursor + lastWindow
  if (planned === 0) bedtime = wakeMin + Math.max(lastWindow, naps === 0 ? 12 * 60 : 0)
  // Clamp to 18:00–21:00 but never before the last nap ends or the wake time itself.
  bedtime = Math.min(Math.max(bedtime, EARLIEST_BEDTIME, cursor), Math.max(LATEST_BEDTIME, cursor))
  items.push({ kind: 'bedtime', start: minutesToHHmm(bedtime), label: 'Bedtime', note: 'Start the wind-down routine 20–30 minutes before.', at: bedtime })

  if (input.includeFeeds && input.ageMonths < 6) {
    for (let t = wakeMin; t < bedtime; t += FEED_INTERVAL_MINUTES) {
      items.push({ kind: 'feed', start: minutesToHHmm(t), label: 'Feed', note: 'Roughly every 3 hours; follow hunger cues.', at: t })
    }
  }

  return items.sort((a, b) => a.at - b.at || (a.kind === 'feed' ? 1 : b.kind === 'feed' ? -1 : 0))
}
