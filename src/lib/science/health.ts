export type FeverLevel = 'normal' | 'low-grade' | 'fever' | 'urgent'

/** Rectal-equivalent temperature. AAP: ≥ 38.0 °C (100.4 °F) is a fever; any fever under 3 months is urgent. */
export function feverStatus(tempC: number, ageMonths: number): { level: FeverLevel; text: string; sources: string[] } {
  const sources = ['hc-fever']
  if (tempC >= 40) return { level: 'urgent', text: '40 °C (104 °F) or higher: call your pediatrician now.', sources }
  if (tempC >= 38) {
    if (ageMonths < 3) return { level: 'urgent', text: 'Fever under 3 months old: call your pediatrician or seek care right away.', sources }
    return { level: 'fever', text: 'Fever (≥ 38 °C / 100.4 °F). Watch fluids and comfort; call if it lasts over 24 hours (under 2 years) or baby seems unwell.', sources }
  }
  if (tempC >= 37.5) return { level: 'low-grade', text: 'Slightly elevated. Recheck in an hour; dress lightly and offer fluids.', sources }
  return { level: 'normal', text: 'Normal range.', sources }
}

export const fToC = (f: number) => ((f - 32) * 5) / 9
export const cToF = (c: number) => (c * 9) / 5 + 32

export const TUMMY_TIME: { minMonths: number; minutesPerDay: [number, number]; text: string; sources: string[] }[] = [
  { minMonths: 0, minutesPerDay: [3, 15], text: 'Start with 2–3 short sessions of 3–5 minutes on a firm surface while awake and supervised, from the first days home.', sources: ['aap-tummy-time'] },
  { minMonths: 2, minutesPerDay: [15, 30], text: 'Work up to a total of 15–30 minutes a day across sessions. It builds neck, shoulder, and core strength and prevents flat spots.', sources: ['aap-tummy-time'] },
  { minMonths: 4, minutesPerDay: [30, 60], text: 'Once rolling, floor play on the tummy naturally extends; keep offering it until crawling.', sources: ['aap-tummy-time'] },
]

export const SCREEN_TIME = {
  text: 'Under 18 months: avoid screens other than video chat. 18–24 months: only high-quality programming watched together. 2–5 years: about 1 hour a day of quality content.',
  sources: ['aap-media-2016'],
}

export const VITAMIN_D = {
  text: 'Breastfed and partially breastfed babies need 400 IU of vitamin D daily from the first days. Formula-fed babies get enough once they drink about 32 oz a day.',
  sources: ['aap-vitamin-d'],
}

export const IRON = {
  text: 'Exclusively breastfed babies should start an iron supplement (1 mg/kg/day) around 4 months until iron-rich solids are established. Formula is iron-fortified.',
  sources: ['aap-iron'],
}

export const SAFE_SLEEP: { text: string; sources: string[] }[] = [
  { text: 'Back to sleep for every sleep, naps included, until 1 year.', sources: ['aap-safe-sleep-2022'] },
  { text: 'Firm, flat, non-inclined surface: crib, bassinet, or play yard with a fitted sheet only.', sources: ['aap-safe-sleep-2022'] },
  { text: 'Nothing in the sleep space: no blankets, pillows, bumpers, or soft toys. Use a sleep sack for warmth.', sources: ['aap-safe-sleep-2022'] },
  { text: 'Room-share without bed-sharing for at least the first 6 months.', sources: ['aap-safe-sleep-2022'] },
  { text: 'Offer a pacifier at sleep once breastfeeding is established; avoid overheating and smoke exposure.', sources: ['aap-safe-sleep-2022'] },
  { text: 'Weighted sleepwear or blankets are not safe. Move baby out of a swing, car seat, or lounger if they fall asleep there.', sources: ['aap-safe-sleep-2022'] },
]
