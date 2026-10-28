import type { Contraction } from './api/companion'
import { parseDate } from './time'

export interface ContractionStats {
  /** Average duration in seconds over the window. */
  avgDurationSec: number
  /** Average start-to-start interval in seconds. */
  avgIntervalSec: number
  count: number
  /** 5-1-1: contractions ~5 min apart, lasting ~1 min, for 1 hour. */
  fiveOneOne: boolean
  /** Human summary such as "Every 6m 30s · lasting 55s" */
  summary: string
}

const fmt = (s: number) => {
  const total = Math.round(s)
  const m = Math.floor(total / 60)
  const r = total % 60
  return m ? (r ? `${m}m ${r}s` : `${m}m`) : `${r}s`
}

export function analyzeContractions(items: Contraction[], now: Date = new Date(), windowMinutes = 60): ContractionStats {
  const cutoff = now.getTime() - windowMinutes * 60_000
  const done = items
    .filter((c) => c.end && parseDate(c.start).getTime() >= cutoff)
    .sort((a, b) => parseDate(a.start).getTime() - parseDate(b.start).getTime())
  if (done.length === 0) return { avgDurationSec: 0, avgIntervalSec: 0, count: 0, fiveOneOne: false, summary: 'No contractions in the last hour' }
  const durations = done.map((c) => (parseDate(c.end!).getTime() - parseDate(c.start).getTime()) / 1000)
  const intervals: number[] = []
  for (let i = 1; i < done.length; i++) intervals.push((parseDate(done[i].start).getTime() - parseDate(done[i - 1].start).getTime()) / 1000)
  const avgDurationSec = durations.reduce((a, b) => a + b, 0) / durations.length
  const avgIntervalSec = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0
  const spanMin = (parseDate(done[done.length - 1].start).getTime() - parseDate(done[0].start).getTime()) / 60_000
  const fiveOneOne = intervals.length >= 6 && avgIntervalSec <= 5.5 * 60 && avgDurationSec >= 45 && spanMin >= 55
  const summary = intervals.length ? `Every ${fmt(avgIntervalSec)} · lasting ${fmt(avgDurationSec)}` : `Lasting ${fmt(avgDurationSec)}`
  return { avgDurationSec, avgIntervalSec, count: done.length, fiveOneOne, summary }
}

export function formatContractionDuration(c: Contraction, now: Date = new Date()): string {
  const end = c.end ? parseDate(c.end) : now
  return fmt(Math.max(0, (end.getTime() - parseDate(c.start).getTime()) / 1000))
}
