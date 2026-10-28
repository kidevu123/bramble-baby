import { formatDurationShort } from '../time'

export interface SleepNorm {
  minMonths: number
  maxMonths: number
  /** Total sleep per 24h, hours. */
  totalHours: [number, number]
  nightHours: [number, number]
  napHours: [number, number]
  napsPerDay: [number, number]
  wakeWindowMinutes: [number, number]
  typicalBedtime: [string, string]
  notes: string
  sources: string[]
}

/**
 * Totals follow the AASM 2016 consensus (4–12 mo 12–16h incl. naps; 1–2y 11–14h; 3–5y 10–13h) and the
 * NSF 2015 newborn range (14–17h). Night/nap splits and wake windows are the commonly cited pediatric
 * sleep-consultant ranges consistent with those totals; they are guidance, not diagnostic thresholds.
 */
export const SLEEP_NORMS: SleepNorm[] = [
  { minMonths: 0, maxMonths: 1, totalHours: [14, 17], nightHours: [8, 9], napHours: [7, 9], napsPerDay: [4, 6], wakeWindowMinutes: [35, 60], typicalBedtime: ['20:00', '23:00'], notes: 'Sleep is spread evenly around the clock; no day/night rhythm yet. Feed-driven cycles of 2–3 hours are normal.', sources: ['nsf-2015', 'hc-wake-windows'] },
  { minMonths: 1, maxMonths: 3, totalHours: [14, 17], nightHours: [8, 10], napHours: [5, 7], napsPerDay: [4, 5], wakeWindowMinutes: [60, 90], typicalBedtime: ['20:00', '22:00'], notes: 'Night stretches begin to lengthen; a distinct bedtime starts to emerge around 6–8 weeks.', sources: ['nsf-2015', 'hc-wake-windows'] },
  { minMonths: 3, maxMonths: 4, totalHours: [14, 16], nightHours: [9, 11], napHours: [4, 5], napsPerDay: [3, 4], wakeWindowMinutes: [75, 120], typicalBedtime: ['19:30', '21:00'], notes: 'Sleep cycles mature (the "4-month regression"); more frequent night wakings are common and temporary.', sources: ['nsf-2015', 'hc-wake-windows'] },
  { minMonths: 4, maxMonths: 6, totalHours: [12, 16], nightHours: [10, 12], napHours: [3, 4], napsPerDay: [3, 3], wakeWindowMinutes: [120, 150], typicalBedtime: ['19:00', '20:30'], notes: 'Three naps is typical; the third is short. Many babies can settle themselves for at least one nap.', sources: ['aasm-2016', 'hc-wake-windows'] },
  { minMonths: 6, maxMonths: 9, totalHours: [12, 16], nightHours: [10, 12], napHours: [2.5, 3.5], napsPerDay: [2, 3], wakeWindowMinutes: [150, 180], typicalBedtime: ['19:00', '20:00'], notes: 'The third nap drops around 7–8 months. Night feeds are physiologically optional for most healthy babies by now.', sources: ['aasm-2016', 'hc-wake-windows'] },
  { minMonths: 9, maxMonths: 12, totalHours: [12, 16], nightHours: [10, 12], napHours: [2, 3], napsPerDay: [2, 2], wakeWindowMinutes: [180, 240], typicalBedtime: ['19:00', '20:00'], notes: 'Two naps: mid-morning and early afternoon. Separation anxiety and standing in the crib can disturb settling.', sources: ['aasm-2016', 'hc-wake-windows'] },
  { minMonths: 12, maxMonths: 18, totalHours: [11, 14], nightHours: [10, 12], napHours: [2, 3], napsPerDay: [1, 2], wakeWindowMinutes: [240, 330], typicalBedtime: ['19:00', '20:00'], notes: 'The transition to one midday nap usually happens between 13 and 18 months.', sources: ['aasm-2016', 'hc-wake-windows'] },
  { minMonths: 18, maxMonths: 24, totalHours: [11, 14], nightHours: [10, 12], napHours: [1.5, 2.5], napsPerDay: [1, 1], wakeWindowMinutes: [300, 360], typicalBedtime: ['19:00', '20:00'], notes: 'One nap after lunch. Keep the nap from running past ~3:30 PM to protect bedtime.', sources: ['aasm-2016', 'hc-wake-windows'] },
  { minMonths: 24, maxMonths: 36, totalHours: [11, 14], nightHours: [10, 12], napHours: [1, 2], napsPerDay: [1, 1], wakeWindowMinutes: [330, 390], typicalBedtime: ['19:00', '20:30'], notes: 'Nap resistance is common at 2; quiet time in the crib still helps.', sources: ['aasm-2016', 'hc-wake-windows'] },
  { minMonths: 36, maxMonths: 60, totalHours: [10, 13], nightHours: [10, 12], napHours: [0, 1.5], napsPerDay: [0, 1], wakeWindowMinutes: [360, 720], typicalBedtime: ['19:00', '20:30'], notes: 'Most children stop napping between 3 and 5; total sleep comes mostly at night.', sources: ['aasm-2016', 'hc-wake-windows'] },
]

export function sleepNormFor(ageMonths: number): SleepNorm {
  const m = Math.max(0, ageMonths)
  return SLEEP_NORMS.find((n) => m >= n.minMonths && m < n.maxMonths) ?? SLEEP_NORMS[SLEEP_NORMS.length - 1]
}

export type NormStatus = 'low' | 'typical' | 'high'

export function compareSleep(totalSeconds: number, ageMonths: number): { status: NormStatus; norm: SleepNorm; text: string } {
  const norm = sleepNormFor(ageMonths)
  const hours = totalSeconds / 3600
  const [lo, hi] = norm.totalHours
  const status: NormStatus = hours < lo - 0.5 ? 'low' : hours > hi + 0.5 ? 'high' : 'typical'
  const range = `${lo}–${hi}h`
  const text =
    status === 'typical'
      ? `${formatDurationShort(totalSeconds)} total · within the typical ${range} for this age`
      : status === 'low'
        ? `${formatDurationShort(totalSeconds)} total · below the typical ${range}; watch for overtiredness`
        : `${formatDurationShort(totalSeconds)} total · above the typical ${range}; plenty of sleep is fine if feeding well`
  return { status, norm, text }
}
