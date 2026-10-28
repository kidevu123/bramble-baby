/**
 * Supply trend: this week's pumping against the week before.
 *
 * Both windows are full days (today is left out because it is not over): the last seven days and the seven
 * before them. A day with no session logged is treated as not logged, not as zero, so a forgotten day does not
 * read as a drop; each window needs a few logged days before the two are compared. The companion's low-supply
 * nudge (server/nudges.py, `supply`) uses the same idea over a shorter recent window.
 */
import { addDays, isSameDay, startOfDay } from 'date-fns'
import type { Pumping } from './api/types'
import { parseDate } from './time'
import { convertVolume, formatVolume, type VolumeUnit } from './units'

export const SUPPLY_SPAN = 7
/** Logged days a window needs before it counts. */
export const SUPPLY_MIN_DAYS = 3
/** Inside this the two weeks read as "holding steady". */
export const SUPPLY_STEADY = 0.1

export interface SupplyWindow {
  /** Millilitres a day over the logged days; null when too few. */
  mlPerDay: number | null
  /** Sessions a day over the logged days; null when too few. */
  sessionsPerDay: number | null
  /** Days of the window with at least one session. */
  days: number
  span: number
}

export interface SupplyTrend {
  recent: SupplyWindow
  prior: SupplyWindow
  /** (recent − prior) / prior; null when either window is thin. */
  changePct: number | null
  state: 'up' | 'down' | 'steady' | 'unknown'
}

function window(pumping: Pumping[], unit: VolumeUnit, firstDay: Date, span: number): SupplyWindow {
  const days = Array.from({ length: span }, (_, i) => addDays(firstDay, i))
  const perDay = days
    .map((d) => {
      const rows = pumping.filter((p) => isSameDay(parseDate(p.start), d))
      return { ml: rows.reduce((s, p) => s + (p.amount ? convertVolume(p.amount, unit, 'ml') : 0), 0), n: rows.length }
    })
    .filter((d) => d.n > 0)
  const enough = perDay.length >= SUPPLY_MIN_DAYS
  return {
    mlPerDay: enough ? perDay.reduce((s, d) => s + d.ml, 0) / perDay.length : null,
    sessionsPerDay: enough ? perDay.reduce((s, d) => s + d.n, 0) / perDay.length : null,
    days: perDay.length,
    span,
  }
}

/** Amounts on pumping rows are in the phone's unit (the hooks convert). */
export function supplyTrend(pumping: Pumping[], unit: VolumeUnit, now: Date = new Date(), span = SUPPLY_SPAN): SupplyTrend {
  const today = startOfDay(now)
  const recent = window(pumping, unit, addDays(today, -span), span)
  const prior = window(pumping, unit, addDays(today, -2 * span), span)
  const changePct = recent.mlPerDay !== null && prior.mlPerDay ? (recent.mlPerDay - prior.mlPerDay) / prior.mlPerDay : null
  const state = changePct === null ? 'unknown' : Math.abs(changePct) <= SUPPLY_STEADY ? 'steady' : changePct > 0 ? 'up' : 'down'
  return { recent, prior, changePct, state }
}

const mlIn = (ml: number, unit: VolumeUnit) => formatVolume(convertVolume(ml, 'ml', unit), unit)
const perDay = (n: number) => (Math.round(n * 10) / 10).toString().replace(/\.0$/, '')
const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`

/** "Last 7 days · 410 mL a day · 6 sessions a day", or what is missing. */
export function supplyWindowLine(w: SupplyWindow, unit: VolumeUnit): string {
  // "5 of 7 days logged" holds together on a narrow phone: non-breaking spaces inside the phrase.
  const logged = (days: number) => `${days}\u00a0of\u00a0${w.span}\u00a0days\u00a0logged`
  if (w.mlPerDay === null || w.sessionsPerDay === null) return w.days ? `${logged(w.days)}, need ${SUPPLY_MIN_DAYS}` : 'nothing logged'
  return `${mlIn(w.mlPerDay, unit)} a day · ${perDay(w.sessionsPerDay)} session${w.sessionsPerDay === 1 ? '' : 's'} a day${w.days < w.span ? ` · ${logged(w.days)}` : ''}`
}

/** The one line that judges the two weeks. */
export function supplyVerdict(t: SupplyTrend, unit: VolumeUnit): string {
  const { recent, prior, changePct } = t
  // Both weeks logged, but the week before carried no millilitres (sessions saved at 0): no percentage to give.
  if (recent.mlPerDay !== null && prior.mlPerDay === 0) {
    return recent.mlPerDay > 0
      ? `Up on the week before: ${mlIn(recent.mlPerDay, unit)} a day, from no amounts logged.`
      : 'No amounts logged in either week, only sessions at 0.'
  }
  if (changePct === null || recent.mlPerDay === null || prior.mlPerDay === null || recent.sessionsPerDay === null || prior.sessionsPerDay === null) {
    const thin = [recent.days < SUPPLY_MIN_DAYS ? 'this week' : null, prior.days < SUPPLY_MIN_DAYS ? 'the week before' : null].filter(Boolean)
    return `Not enough logged days ${thin.join(' and ')} to compare yet (${SUPPLY_MIN_DAYS} needed in each).`
  }
  if (t.state === 'steady') return `Holding steady: about ${mlIn(recent.mlPerDay, unit)} a day both weeks.`
  const head = `${t.state === 'up' ? 'Up' : 'Down'} ${pct(changePct)} on the week before: ${mlIn(recent.mlPerDay, unit)} a day from ${mlIn(prior.mlPerDay, unit)}.`
  const sessionsPct = prior.sessionsPerDay ? (recent.sessionsPerDay - prior.sessionsPerDay) / prior.sessionsPerDay : 0
  if (t.state === 'down' && sessionsPct <= -0.15) return `${head} Fewer sessions a day (${perDay(recent.sessionsPerDay)} from ${perDay(prior.sessionsPerDay)}) explain most of it.`
  if (t.state === 'down') return `${head} About as many sessions a day (${perDay(recent.sessionsPerDay)}), so each one gives less.`
  if (sessionsPct >= 0.15) return `${head} More sessions a day (${perDay(recent.sessionsPerDay)} from ${perDay(prior.sessionsPerDay)}).`
  return `${head} About as many sessions a day (${perDay(recent.sessionsPerDay)}), each giving more.`
}
