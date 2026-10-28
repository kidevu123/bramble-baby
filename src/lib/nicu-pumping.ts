/**
 * Pumping for a baby in the NICU (or home before his due date): Mom's sessions and volume against what NICU
 * lactation teams aim for, counted in her days since delivery (the real birth, never the corrected age).
 *
 * Sources (see the Born early sheet's fold):
 * - 8 or more sessions in 24 hours, one of them at night (Children's Mercy NICU lactation; UW Medicine,
 *   "Breastfeeding your hospitalized baby").
 * - 5 or more a day by day 5 is what predicted coming to volume ("Early pumping frequency and coming to volume…", J Perinatol 2023, 427 NICU mothers).
 * - About 500 mL a day by the end of week 1 and 750 mL by the end of week 2 (UW Medicine); after two weeks,
 *   750 or more is full supply, 350–500 borderline, under 350 low (Children's Mercy).
 * The first two weeks are building: the volume is shown against where it is heading, never called low.
 */
import { startOfDay } from 'date-fns'
import type { Pumping } from './api/types'
import { daysSinceDelivery } from './preterm'
import { parseDate } from './time'
import { convertVolume, type VolumeUnit } from './units'

export const SESSIONS_AIM = 8
export const SESSIONS_EARLY = 5
/** A session that starts between midnight and this hour is a night session. */
export const NIGHT_ENDS_HOUR = 6
export const WEEK1_ML = 500
export const FULL_ML = 750
export const BORDERLINE_ML = 350
/** The days of building (no verdict on the volume before the end of week 2). */
export const BUILDING_DAYS = 14

export type NicuTone = 'met' | 'missed' | null

export interface NicuPumping {
  /** Full days counted (days with a session, before today; today alone when none). */
  days: number
  /** Mom's day since delivery at the last day counted (day 1 is the birth day). */
  deliveryDay: number
  sessionsPerDay: number
  nights: number
  mlPerDay: number
  sessionsDetail: string
  sessionsTone: NicuTone
  volumeDetail: string
  volumeTone: NicuTone
}

/** "750 mL" or "25 oz": a target in the phone's unit, rounded the way people say it. */
export function targetText(ml: number, unit: VolumeUnit): string {
  return unit === 'oz' ? `${Math.round(convertVolume(ml, 'ml', 'oz'))} oz` : `${ml} mL`
}

export function nicuPumping(pumping: Pumping[], days: Date[], now: Date, birth: string, unit: VolumeUnit): NicuPumping | null {
  const born = startOfDay(parseDate(birth)).getTime()
  const today = startOfDay(now).getTime()
  const byDay = new Map<number, { n: number; ml: number; night: boolean }>()
  for (const p of pumping) {
    const t = parseDate(p.start)
    const k = startOfDay(t).getTime()
    const d = byDay.get(k) ?? { n: 0, ml: 0, night: false }
    d.n += 1
    d.ml += convertVolume(p.amount ?? 0, unit, 'ml')
    if (t.getHours() < NIGHT_ENDS_HOUR) d.night = true
    byDay.set(k, d)
  }
  const keys = days.map((d) => startOfDay(d).getTime()).filter((k) => k >= born && byDay.has(k))
  let used = keys.filter((k) => k < today)
  if (!used.length) used = keys.filter((k) => k === today)
  if (!used.length) return null
  const rows = used.map((k) => byDay.get(k)!)
  const sessionsPerDay = rows.reduce((s, r) => s + r.n, 0) / rows.length
  const mlPerDay = rows.reduce((s, r) => s + r.ml, 0) / rows.length
  const nights = rows.filter((r) => r.night).length
  const deliveryDay = daysSinceDelivery(birth, new Date(Math.max(...used)))

  const nightWord = `${nights} of ${rows.length} ${rows.length === 1 ? 'day' : 'days'} with one at night`
  const sessionsTone: NicuTone = sessionsPerDay >= SESSIONS_AIM - 0.25 ? 'met' : deliveryDay >= SESSIONS_EARLY && sessionsPerDay < SESSIONS_EARLY ? 'missed' : null
  const sessionsDetail = `aim ${SESSIONS_AIM} a day · ${nightWord}`

  let volumeDetail: string
  let volumeTone: NicuTone = null
  if (deliveryDay <= 7) volumeDetail = `day ${deliveryDay} · aim ${targetText(WEEK1_ML, unit)} a day by day 7`
  else if (deliveryDay <= BUILDING_DAYS) volumeDetail = `day ${deliveryDay} · aim ${targetText(FULL_ML, unit)} a day by day 14`
  else if (mlPerDay >= FULL_ML) {
    volumeDetail = `full supply is ${targetText(FULL_ML, unit)} or more`
    volumeTone = 'met'
  } else if (mlPerDay >= WEEK1_ML) volumeDetail = `over ${targetText(WEEK1_ML, unit)} · full supply is ${targetText(FULL_ML, unit)}`
  // Borderline is said, not marked red: only low supply carries the red edge (this is Mom's own body).
  else if (mlPerDay >= BORDERLINE_ML) volumeDetail = `borderline (${targetText(BORDERLINE_ML, unit).split(' ')[0]}–${targetText(WEEK1_ML, unit)}) · full supply is ${targetText(FULL_ML, unit)}`
  else {
    volumeDetail = `low: under ${targetText(BORDERLINE_ML, unit)} · worth asking the NICU's lactation consultant`
    volumeTone = 'missed'
  }
  return { days: rows.length, deliveryDay, sessionsPerDay, nights, mlPerDay, sessionsDetail, sessionsTone, volumeDetail, volumeTone }
}
