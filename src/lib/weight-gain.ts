/**
 * How fast the child is gaining, in grams a day, whatever units the weights are shown in.
 *
 * A pediatrician talks in grams a day ("she should gain 20 g a day"); the phone shows pounds and ounces and
 * the chart shows a curve, and neither makes "20 a day" checkable. This turns the weighings into: the gain
 * since the last weighing on an earlier day, the gain over roughly the last week, both as a total and per
 * day, in grams with the ounce equivalent beside it, and one line that measures the per-day rate against
 * the doctor's goal (a child setting) or, without one, the age-typical band.
 */
import { addDays, differenceInCalendarDays, format } from 'date-fns'
import type { Weight } from './api/types'
import { growthEntryTime } from './growth-note'
import { growthAt } from './reports'
import { holdNote, judgedAge, type AgeFrom, type AgeHold } from './preterm'
import { expectedWeightGain } from './science'
import { convertWeight, type WeightUnit } from './units'

export const GRAMS_PER_OZ = 28.349523125
/** A "week" is the weighing nearest to 7 days before the latest, this far back at most and at least. */
const WEEK_MIN_DAYS = 5
const WEEK_MAX_DAYS = 10
/** How far one weighing can sit from the next on its own: a feed or a wet diaper either side of the scale moves a
 *  newborn by 20–40 g, and so does the time of day. */
export const DAY_TO_DAY_SWING_G = 30

export interface GainStep {
  grams: number
  /** Calendar days between the two weighings (at least 1). */
  days: number
  perDay: number
  since: Date
  /** Whether `since` carries a real clock (from the note), not the noon stand-in for a date-only weighing. */
  sinceTimed: boolean
}

export interface WeightGain {
  latest: { grams: number; at: Date; timed: boolean } | null
  /** Against the previous weighing on an earlier day. */
  sinceLast: GainStep | null
  /** Against the weighing nearest to a week before the latest. */
  week: GainStep | null
  /** Grams a day the age band expects; null in the first two weeks (loss and regain, no rate to hold). */
  typicalPerDay: [number, number] | null
  /** In the NICU or before the due date (Settings › Born early): no age-typical band, only the doctor's goal. */
  held?: AgeHold
  /** The doctor's grams a day, when the household recorded one. */
  goal: number | null
  /** Midnight of the day the doctor gave the goal, when it is recorded (with a goal). */
  goalStart: Date | null
  /** The gain since that day, once two weighings a day apart are in. */
  sinceGoal: GoalTrend | null
}

/** How long after the goal starts before its average is judged: one weighing swings ±30 g, so a few days of
 *  weighings say little about grams a day (3 days of ±30 g is ±10 g/day either way). */
export const GOAL_JUDGE_DAYS = 7

/**
 * The gain since the goal was given: weeks before it (tube feeds in the NICU, the regain of birth weight) do
 * not count against it. The rate is a straight line through every weighing since that day (least squares), so
 * a heavy or light weighing at either end moves it less than first-to-last would.
 */
export interface GoalTrend {
  /** Midnight of the day the goal was given. */
  start: Date
  /** The first and the latest weighing counted. */
  from: Date
  to: Date
  /** Grams from the first counted weighing to the latest. */
  grams: number
  /** Days from the first counted weighing to the latest (fractional). */
  days: number
  weighings: number
  perDay: number
  /** Fewer than `GOAL_JUDGE_DAYS` since the goal started: shown, not judged. */
  early: boolean
  /** When the average is first judged. */
  judgedFrom: Date
}

const DAY_MS = 86_400_000

/** Midnight of a yyyy-MM-dd day, or null for anything else. */
function dayStart(day: string | null | undefined): Date | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const start = new Date(`${day}T00:00:00`)
  return Number.isNaN(start.getTime()) ? null : start
}

/** The line through the weighings since the goal day; null with fewer than two of them or less than a day apart. */
function goalTrend(rows: { grams: number; at: Date }[], start: Date | null): GoalTrend | null {
  if (!start) return null
  const counted = rows.filter((r) => r.at.getTime() >= start.getTime()).sort((a, b) => a.at.getTime() - b.at.getTime())
  if (counted.length < 2) return null
  const first = counted[0]
  const last = counted[counted.length - 1]
  const days = (last.at.getTime() - first.at.getTime()) / DAY_MS
  if (days < 1) return null
  const xs = counted.map((r) => (r.at.getTime() - first.at.getTime()) / DAY_MS)
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length
  const my = counted.reduce((s, r) => s + r.grams, 0) / counted.length
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0)
  const sxy = xs.reduce((s, x, i) => s + (x - mx) * (counted[i].grams - my), 0)
  const judgedFrom = addDays(start, GOAL_JUDGE_DAYS) // calendar days: across a clock change 7 × 24 h is an hour short
  return {
    start,
    from: first.at,
    to: last.at,
    grams: last.grams - first.grams,
    days,
    weighings: counted.length,
    perDay: sxy / sxx,
    early: last.at.getTime() < judgedFrom.getTime(),
    judgedFrom,
  }
}

const toGrams = (value: number, unit: WeightUnit) => convertWeight(value, unit, 'kg') * 1000

/**
 * Weights in the phone's unit, any order; `upTo` limits the view to weighings on or before that moment;
 * `goalSince` is the day the doctor gave the goal (yyyy-MM-dd).
 */
export function weightGain(weights: Weight[], unit: WeightUnit, age: AgeFrom, goal: number | null | undefined, upTo?: Date, goalSince?: string | null): WeightGain {
  const rows = weights
    .map((w) => ({ grams: toGrams(w.weight, unit), at: growthAt(w), timed: growthEntryTime(w) !== null }))
    .filter((w) => Number.isFinite(w.grams) && (!upTo || w.at.getTime() <= upTo.getTime()))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
  const latest = rows[0] ?? null
  const goalValue = typeof goal === 'number' && Number.isFinite(goal) && goal > 0 ? goal : null
  const goalStart = goalValue !== null ? dayStart(goalSince) : null
  if (!latest) return { latest: null, sinceLast: null, week: null, typicalPerDay: null, goal: goalValue, goalStart, sinceGoal: null }
  const step = (prev: { grams: number; at: Date; timed: boolean }): GainStep => {
    const days = Math.max(1, differenceInCalendarDays(latest.at, prev.at))
    const grams = latest.grams - prev.grams
    return { grams, days, perDay: grams / days, since: prev.at, sinceTimed: prev.timed }
  }
  const earlier = rows.slice(1).filter((r) => differenceInCalendarDays(latest.at, r.at) >= 1)
  const sinceLast = earlier.length ? step(earlier[0]) : null
  const weekPick = earlier
    .map((r) => ({ r, days: differenceInCalendarDays(latest.at, r.at) }))
    .filter((x) => x.days >= WEEK_MIN_DAYS && x.days <= WEEK_MAX_DAYS)
    .sort((a, b) => Math.abs(a.days - 7) - Math.abs(b.days - 7) || b.r.at.getTime() - a.r.at.getTime())[0]
  const week = weekPick ? step(weekPick.r) : null
  // Counted from the due date for a baby born early; none at all while held (a preterm baby's gain is the NICU's call).
  const ctx = judgedAge(age, latest.at)
  const band = ctx.hold ? [0, 0] : expectedWeightGain(ctx.ageMonths).gramsPerWeek
  const typicalPerDay: [number, number] | null = band[1] > 0 ? [Math.round(band[0] / 7), Math.round(band[1] / 7)] : null
  return { latest, sinceLast, week, typicalPerDay, held: ctx.hold, goal: goalValue, goalStart, sinceGoal: goalTrend(rows, goalStart) }
}

/** "3 days" / "2.5 days" / "1 day" for a goal trend's span. */
export function spanDays(days: number): string {
  const r = Math.round(days * 2) / 2
  return `${Number.isInteger(r) ? r : r.toFixed(1)} day${r === 1 ? '' : 's'}`
}

/** Whether the week is worth a tile beside the goal's figure: not when the goal started within it. */
export function weekBesideGoal(gain: WeightGain): boolean {
  if (!gain.week) return false
  if (!gain.sinceGoal || !gain.goalStart || !gain.latest) return true
  return (gain.latest.at.getTime() - gain.goalStart.getTime()) / DAY_MS > WEEK_MAX_DAYS
}

/**
 * Which two weighings the step since the last one compares, under its number: "6:13 PM vs 10:36 AM yesterday"
 * (or "vs 10:36 AM Oct 9"), dates alone when either weighing has no clock ("Oct 12 vs Oct 11"). A step between
 * a morning and an evening weighing reads very differently from one between two mornings.
 */
export function stepCompares(gain: Pick<WeightGain, 'latest' | 'sinceLast'>): string | null {
  const { latest, sinceLast } = gain
  if (!latest || !sinceLast) return null
  if (!latest.timed || !sinceLast.sinceTimed) return `${format(latest.at, 'MMM d')} vs ${format(sinceLast.since, 'MMM d')}`
  const when = sinceLast.days === 1 ? 'yesterday' : format(sinceLast.since, 'MMM d')
  return `${format(latest.at, 'h:mm a')} vs ${format(sinceLast.since, 'h:mm a')} ${when}`
}

/** The line under the step: one day is noise, the week is the trend (the weighings above can go down by a feed). */
export function stepNoiseNote(gain: Pick<WeightGain, 'week'>): string {
  const trend = gain.week ? `the ${gain.week.days}-day figure is the trend` : 'a week of weighings shows the trend'
  return `One day can swing ±${DAY_TO_DAY_SWING_G} g with feeds, diapers and the time of day; ${trend}.`
}

const signed = (n: number, text: string) => `${n < 0 ? '−' : '+'}${text}`

/** The ounce beside grams on a pounds phone; nothing when it rounds to 0 ("+1 g", never "+1 g (0 oz)"). */
function ozAside(grams: number, unit: WeightUnit): string {
  if (unit !== 'lb') return ''
  const oz = Math.round((Math.abs(grams) / GRAMS_PER_OZ) * 10) / 10
  return oz > 0 ? ` (${oz} oz)` : ''
}

/** "+34 g (1.2 oz)" for a pounds phone, "+34 g" for a kilograms one; no sign on zero. */
export function formatGrams(grams: number, unit: WeightUnit): string {
  const g = Math.round(Math.abs(grams))
  if (g === 0) return '0 g'
  return signed(grams, `${g} g`) + ozAside(grams, unit)
}

/** "+17 g/day (0.6 oz)" / "+17 g/day". */
export function formatPerDay(perDay: number, unit: WeightUnit): string {
  const g = Math.round(Math.abs(perDay))
  if (g === 0) return '0 g/day'
  return signed(perDay, `${g} g/day`) + ozAside(perDay, unit)
}

/** The rate the verdict judges: the week when there is one, else the last step. */
export function gainRate(gain: WeightGain): { step: GainStep; over: string } | null {
  if (gain.week) return { step: gain.week, over: `over the last ${gain.week.days} days` }
  if (gain.sinceLast) return { step: gain.sinceLast, over: gain.sinceLast.days === 1 ? 'since yesterday' : `over the last ${gain.sinceLast.days} days` }
  return null
}

/**
 * One sentence against the doctor's goal, or the age-typical band when there is none. Null with one weighing.
 * With the goal's day recorded it judges the gain since then, and only once a week of weighings is in.
 */
export function gainVerdict(gain: WeightGain, unit: WeightUnit): string | null {
  const t = gain.sinceGoal
  if (t && gain.goal !== null) {
    const rateText = `${formatPerDay(t.perDay, unit)} since ${format(t.start, 'MMM d')} (${t.weighings} weighings over ${spanDays(t.days)})`
    if (t.early) return `${rateText}. Too early to judge against the doctor's ${gain.goal} g/day: one weighing can swing ±${DAY_TO_DAY_SWING_G} g, so this settles from ${format(t.judgedFrom, 'MMM d')}.`
    const short = gain.goal - t.perDay
    if (short <= 1) return `On the doctor's ${gain.goal} g/day: ${rateText}.`
    return `Below the doctor's ${gain.goal} g/day: ${rateText}, ${Math.round(short)} g/day short.`
  }
  // The goal counts from its day: the weeks before it are not judged against it.
  if (gain.goalStart && gain.goal !== null) return `The doctor's ${gain.goal} g/day counts from ${format(gain.goalStart, 'MMM d')}; it is measured once two weighings a day apart are in since then.`
  const rate = gainRate(gain)
  if (!rate) return null
  const rateText = `${formatPerDay(rate.step.perDay, unit)} ${rate.over}`
  if (gain.goal !== null) {
    const short = gain.goal - rate.step.perDay
    if (short <= 1) return `On the doctor's ${gain.goal} g/day: ${rateText}.`
    return `Below the doctor's ${gain.goal} g/day: ${rateText}, ${Math.round(short)} g/day short.`
  }
  if (!gain.typicalPerDay && gain.held) return `${rateText}. ${holdNote(gain.held)}`
  if (!gain.typicalPerDay) return `${rateText}. In the first two weeks babies lose and regain birth weight, so no daily rate applies yet.`
  const [lo, hi] = gain.typicalPerDay
  const where = rate.step.perDay < lo ? 'below' : rate.step.perDay > hi ? 'above' : 'within'
  return `${rateText}, ${where} the typical ${lo}–${hi} g/day for this age.`
}

/**
 * The rate each check is held to: the doctor's goal, else the bottom of the age-typical band (meeting the low end
 * of typical is not a problem; the middle would call half of healthy days a miss); null in the first two weeks.
 */
export function checkRate(gain: Pick<WeightGain, 'goal' | 'typicalPerDay'>): { gramsPerDay: number; label: string; kind: 'goal' | 'typical' } | null {
  if (gain.goal !== null) return { gramsPerDay: gain.goal, label: `${gain.goal} g/day`, kind: 'goal' }
  if (!gain.typicalPerDay) return null
  return { gramsPerDay: gain.typicalPerDay[0], label: `typical ${gain.typicalPerDay[0]} g/day`, kind: 'typical' }
}

/**
 * One weighing judged against the one before it: the target starts again from wherever she was at the last check,
 * so a slow start (tube feeds, the regain of birth weight) never makes every later day a miss. The cumulative line
 * from the first weighing it replaced could not be met once she was behind it, however well she gained after.
 */
export interface WeightCheck {
  /** The weighing judged: the latest of its day. */
  at: Date
  /** The check before it: the latest weighing of the previous day that had one. */
  since: Date
  /** Both carry a real clock, so `days` is the time between them, not whole days. */
  timed: boolean
  days: number
  grams: number
  /** What the rate asks for over `days`. */
  needed: number
  met: boolean
  /** In the chart's unit: where she was at the last check, where the rate would have put her, and where she is. */
  fromY: number
  targetY: number
  y: number
}

/**
 * One check a day (the day's latest weighing against the previous day's latest), from `from` on (the goal's day:
 * a check that starts before it is not counted). Weights in the phone's unit; oldest first.
 */
export function weightChecks(weights: Weight[], unit: WeightUnit, gramsPerDay: number, from?: Date | null): WeightCheck[] {
  const rows = weights
    .map((w) => ({ y: w.weight, grams: toGrams(w.weight, unit), at: growthAt(w), timed: growthEntryTime(w) !== null }))
    .filter((w) => Number.isFinite(w.grams))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
  const daily: typeof rows = []
  for (const r of rows) {
    const last = daily[daily.length - 1]
    if (last && differenceInCalendarDays(r.at, last.at) === 0) daily[daily.length - 1] = r
    else daily.push(r)
  }
  const perDayUnit = convertWeight(gramsPerDay / 1000, 'kg', unit)
  const checks: WeightCheck[] = []
  for (let i = 1; i < daily.length; i++) {
    const prev = daily[i - 1]
    const cur = daily[i]
    if (from && prev.at.getTime() < from.getTime()) continue
    const timed = prev.timed && cur.timed
    const days = timed ? (cur.at.getTime() - prev.at.getTime()) / DAY_MS : differenceInCalendarDays(cur.at, prev.at)
    const needed = gramsPerDay * days
    const grams = cur.grams - prev.grams
    checks.push({ at: cur.at, since: prev.at, timed, days, grams, needed, met: grams >= needed, fromY: prev.y, targetY: prev.y + perDayUnit * days, y: cur.y })
  }
  return checks
}

/** How many checks to count in the tally, and how many misses in a row make a pattern rather than a bad weighing. */
export const CHECK_TALLY = 7
export const MISSES_IN_A_ROW = 3

export interface CheckTally {
  met: number
  of: number
  /** Misses at the end, newest back. */
  missedInRow: number
}

export function checkTally(checks: WeightCheck[]): CheckTally {
  const recent = checks.slice(-CHECK_TALLY)
  let missedInRow = 0
  for (let i = checks.length - 1; i >= 0 && !checks[i].met; i--) missedInRow++
  return { met: recent.filter((c) => c.met).length, of: recent.length, missedInRow }
}

/** "needed +17 g · met" / "needed +20 g · 13 g short", under a check's number. */
export function checkDetail(c: WeightCheck): string {
  const need = `needed +${Math.round(c.needed)} g`
  return c.met ? `${need} · met` : `${need} · ${Math.round(c.needed - c.grams)} g short`
}
