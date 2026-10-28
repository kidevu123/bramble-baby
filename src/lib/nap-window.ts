import { HOUR, MINUTE, isDaytime, parseDate } from './time'
import type { Sleep } from './api/types'

export interface WakeWindow {
  minMinutes: number
  maxMinutes: number
  napsPerDay: number
}

/** Age-based wake windows (pediatric sleep consensus ranges). */
export function ageWakeWindow(ageMonths: number): WakeWindow {
  if (ageMonths < 1) return { minMinutes: 45, maxMinutes: 60, napsPerDay: 5 }
  if (ageMonths < 2) return { minMinutes: 60, maxMinutes: 90, napsPerDay: 4 }
  if (ageMonths < 3) return { minMinutes: 75, maxMinutes: 105, napsPerDay: 4 }
  if (ageMonths < 4) return { minMinutes: 90, maxMinutes: 120, napsPerDay: 4 }
  if (ageMonths < 6) return { minMinutes: 120, maxMinutes: 150, napsPerDay: 3 }
  if (ageMonths < 8) return { minMinutes: 150, maxMinutes: 180, napsPerDay: 3 }
  if (ageMonths < 10) return { minMinutes: 165, maxMinutes: 210, napsPerDay: 2 }
  if (ageMonths < 13) return { minMinutes: 180, maxMinutes: 240, napsPerDay: 2 }
  if (ageMonths < 18) return { minMinutes: 240, maxMinutes: 330, napsPerDay: 1 }
  if (ageMonths < 36) return { minMinutes: 300, maxMinutes: 390, napsPerDay: 1 }
  return { minMinutes: 360, maxMinutes: 720, napsPerDay: 0 }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Observed daytime wake windows: the gap between the end of one sleep and the
 * start of the next, when the gap is a plausible daytime awake stretch.
 */
export function observedWakeWindows(sleeps: Sleep[], now: Date, lookbackDays = 7): number[] {
  const cutoff = now.getTime() - lookbackDays * 24 * HOUR
  const ordered = sleeps
    .filter((s) => parseDate(s.end).getTime() >= cutoff)
    .sort((a, b) => parseDate(a.start).getTime() - parseDate(b.start).getTime())
  const windows: number[] = []
  for (let i = 0; i < ordered.length - 1; i++) {
    const wake = parseDate(ordered[i].end)
    const nextSleep = parseDate(ordered[i + 1].start)
    const gapMin = (nextSleep.getTime() - wake.getTime()) / MINUTE
    if (gapMin < 20 || gapMin > 8 * 60) continue
    if (!isDaytime(wake)) continue
    windows.push(gapMin)
  }
  return windows
}

/** `stale`: the last logged wake is so long ago (STALE_HOURS) that sleep is not being logged, so no nap is predicted. */
export type NapPredictionState = 'asleep' | 'predicted' | 'overdue' | 'stale' | 'no-data'

/** No baby is awake this long: past it, "Awake 274h" and a nap "due" at 3:50 AM would be noise. */
export const STALE_HOURS = 12

export interface NapPrediction {
  state: NapPredictionState
  /** Predicted ideal sleep start. */
  at: Date | null
  /** Start/end of the comfortable window around the prediction. */
  windowStart: Date | null
  windowEnd: Date | null
  lastWakeAt: Date | null
  asleepSince: Date | null
  wakeWindowMinutes: number
  /** How many observed windows informed the prediction. */
  samples: number
  source: 'age' | 'learned'
}

/**
 * @param asleepSince start of a running sleep timer, if any. Baby Buddy sleeps always have an end,
 * so without this the prediction keeps counting the wake window while the baby is actually asleep.
 */
export function predictNap(sleeps: Sleep[], ageMonths: number, now: Date = new Date(), adjustMinutes = 0, asleepSince: Date | null = null): NapPrediction {
  const age = ageWakeWindow(ageMonths)
  const ageMid = (age.minMinutes + age.maxMinutes) / 2
  const observed = observedWakeWindows(sleeps, now)
  // Blend the learned median with the age prior; trust data more as it accumulates.
  const weight = Math.min(observed.length / 8, 0.75)
  const learned = observed.length ? median(observed) : ageMid
  const windowMin = Math.max(20, Math.round(weight * learned + (1 - weight) * ageMid) + adjustMinutes)
  const halfSpread = Math.max(10, Math.round((age.maxMinutes - age.minMinutes) / 4))

  const running = sleeps.find((s) => !s.end)
  if (running || asleepSince) {
    return {
      state: 'asleep',
      at: null,
      windowStart: null,
      windowEnd: null,
      lastWakeAt: null,
      asleepSince: running ? parseDate(running.start) : asleepSince,
      wakeWindowMinutes: windowMin,
      samples: observed.length,
      source: weight > 0 ? 'learned' : 'age',
    }
  }

  const latest = sleeps
    .filter((s) => s.end)
    .sort((a, b) => parseDate(b.end).getTime() - parseDate(a.end).getTime())[0]
  if (!latest) {
    return {
      state: 'no-data',
      at: null,
      windowStart: null,
      windowEnd: null,
      lastWakeAt: null,
      asleepSince: null,
      wakeWindowMinutes: windowMin,
      samples: 0,
      source: 'age',
    }
  }
  const lastWake = parseDate(latest.end)
  if (now.getTime() - lastWake.getTime() > STALE_HOURS * 60 * MINUTE) {
    return { state: 'stale', at: null, windowStart: null, windowEnd: null, lastWakeAt: lastWake, asleepSince: null, wakeWindowMinutes: windowMin, samples: observed.length, source: weight > 0 ? 'learned' : 'age' }
  }
  const at = new Date(lastWake.getTime() + windowMin * MINUTE)
  const windowStart = new Date(at.getTime() - halfSpread * MINUTE)
  const windowEnd = new Date(at.getTime() + halfSpread * MINUTE)
  return {
    state: now.getTime() > windowEnd.getTime() ? 'overdue' : 'predicted',
    at,
    windowStart,
    windowEnd,
    lastWakeAt: lastWake,
    asleepSince: null,
    wakeWindowMinutes: windowMin,
    samples: observed.length,
    source: weight > 0 ? 'learned' : 'age',
  }
}

/** Rough bedtime suggestion: age-appropriate bedtime hour, nudged by the last wake. */
export function suggestBedtime(ageMonths: number, now: Date, lastWake: Date | null): Date {
  const window = ageWakeWindow(ageMonths)
  const base = new Date(now)
  base.setHours(ageMonths < 4 ? 20 : ageMonths < 12 ? 19 : 19, ageMonths < 4 ? 0 : 30, 0, 0)
  if (!lastWake) return base
  const byWindow = new Date(lastWake.getTime() + window.maxMinutes * MINUTE)
  // Never suggest earlier than the wake window allows, and keep it within the evening.
  const latest = new Date(now)
  latest.setHours(21, 0, 0, 0)
  const candidate = byWindow > base ? byWindow : base
  return candidate > latest ? latest : candidate
}
