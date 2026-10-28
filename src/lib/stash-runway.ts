/**
 * How long the stash lasts, and how far it is from the goal.
 *
 * The runway is the usable stash divided by what the baby drinks of it: breast-milk bottles a day, averaged
 * over the last seven full days that had any (today is left out because it is not over). The goal is a
 * number of days' worth of bottles to have banked (Settings › Pumps); progress is measured against today's
 * intake, and the date it will be reached comes from the net surplus, pumped minus drunk, over the same week.
 */
import { addDays, differenceInCalendarDays, format, isSameDay, startOfDay } from 'date-fns'
import type { MilkBag } from './api/companion'
import type { Feeding, Pumping } from './api/types'
import { bagState } from './milk'
import { parseDate } from './time'
import { convertVolume, formatVolume, type VolumeUnit } from './units'

const WEEK = 7
const BREAST_MILK = new Set(['breast milk', 'fortified breast milk'])

export interface StashRunway {
  /** Millilitres in the stash that are not expired. */
  usableMl: number
  /** Breast-milk bottle intake, mL a day, over the days of the last week that had any; null when none. */
  intakeMlPerDay: number | null
  /** Days of the last week with a breast-milk bottle logged. */
  intakeDays: number
  /** Pumped, mL a day, over the days of the last week with a session; null when none. */
  pumpedMlPerDay: number | null
  /** Pumped minus drunk, mL a day, both summed over the same days of the last week (those with either
   *  logged), so one big session never reads as a daily surplus; null without pumping or bottles. */
  netMlPerDay: number | null
  /** usableMl / intakeMlPerDay; null without an intake. */
  daysCovered: number | null
  goalDays: number | null
  /** The goal in millilitres at today's intake; null without a goal or an intake. */
  goalMl: number | null
  /** 0–1 of the goal banked; null without a goal. */
  goalProgress: number | null
  /** When the goal will be reached at the current net surplus; null when reached, unknown, or the stash is shrinking. */
  goalReachedOn: Date | null
}

const avgPerLoggedDay = (totals: number[]): { avg: number | null; days: number } => {
  const active = totals.filter((v) => v > 0)
  return { avg: active.length ? active.reduce((s, v) => s + v, 0) / active.length : null, days: active.length }
}

/** Amounts on feedings and pumping are in the phone's unit (the hooks convert); bags are millilitres. */
export function stashRunway(bags: MilkBag[], feedings: Feeding[], pumping: Pumping[], unit: VolumeUnit, goalDays: number | null | undefined, now: Date = new Date()): StashRunway {
  const usableMl = bags.filter((b) => b.status === 'stored' && bagState(b, now) !== 'expired').reduce((s, b) => s + b.remaining_ml, 0)
  const today = startOfDay(now)
  const days = Array.from({ length: WEEK }, (_, i) => addDays(today, -(i + 1)))
  const ml = (amount: number | null | undefined) => (amount ? convertVolume(amount, unit, 'ml') : 0)
  const bottles = feedings.filter((f) => f.method === 'bottle' && BREAST_MILK.has(f.type))
  let intake = avgPerLoggedDay(days.map((d) => bottles.filter((f) => isSameDay(parseDate(f.start), d)).reduce((s, f) => s + ml(f.amount), 0)))
  // Nothing in the last week yet (a stash started today): today's bottles are all there is to go on.
  if (!intake.days) intake = avgPerLoggedDay([bottles.filter((f) => isSameDay(parseDate(f.start), today)).reduce((s, f) => s + ml(f.amount), 0)])
  const pumpedByDay = days.map((d) => pumping.filter((p) => isSameDay(parseDate(p.start), d)).reduce((s, p) => s + ml(p.amount), 0))
  const drunkByDay = days.map((d) => bottles.filter((f) => isSameDay(parseDate(f.start), d)).reduce((s, f) => s + ml(f.amount), 0))
  const pumped = avgPerLoggedDay(pumpedByDay)
  // Net over the same days on both sides: one 300 mL session against a week of 120 mL bottles is a stash
  // shrinking by ~77 mL a day, not growing by 180.
  const netDays = days.map((_, i) => i).filter((i) => pumpedByDay[i] > 0 || drunkByDay[i] > 0)
  const net = intake.avg !== null && pumped.avg !== null && netDays.length ? netDays.reduce((s, i) => s + pumpedByDay[i] - drunkByDay[i], 0) / netDays.length : null
  const goal = typeof goalDays === 'number' && Number.isFinite(goalDays) && goalDays > 0 ? Math.round(goalDays) : null
  const goalMl = goal !== null && intake.avg !== null ? goal * intake.avg : null
  const goalProgress = goalMl !== null ? Math.min(1, usableMl / goalMl) : null
  let goalReachedOn: Date | null = null
  if (goalMl !== null && usableMl < goalMl && net !== null && net > 0) goalReachedOn = addDays(today, Math.ceil((goalMl - usableMl) / net))
  return {
    usableMl,
    intakeMlPerDay: intake.avg,
    intakeDays: intake.days,
    pumpedMlPerDay: pumped.avg,
    netMlPerDay: net,
    daysCovered: intake.avg ? usableMl / intake.avg : null,
    goalDays: goal,
    goalMl,
    goalProgress,
    goalReachedOn,
  }
}

const mlIn = (ml: number, unit: VolumeUnit) => formatVolume(convertVolume(ml, 'ml', unit), unit)

/** "4.2 days" / "1.9 days" / "1 day" / "18 hours" / "about an hour". */
export function coverageText(days: number): string {
  if (days >= 1) {
    const d = Math.round(days * 10) / 10
    return `${d} day${d === 1 ? '' : 's'}`
  }
  const hours = Math.round(days * 24)
  if (hours >= 24) return '1 day'
  if (hours <= 1) return 'about an hour'
  return `${hours} hours`
}

/** The headline of the runway card. */
export function runwayHeadline(r: StashRunway): string {
  if (r.usableMl < 1) return 'Nothing to pour'
  if (r.daysCovered === null) return 'No bottles logged yet'
  return coverageText(r.daysCovered)
}

/** The line under it: what the headline was measured against. */
export function runwayLine(r: StashRunway, unit: VolumeUnit, name: string): string {
  if (r.usableMl < 1) return 'The stash has no usable milk. Bags you add show up here with how long they last.'
  if (r.intakeMlPerDay === null) return `${mlIn(r.usableMl, unit)} in the stash. Log ${name}’s bottles and this says how many days it covers.`
  const basis = r.intakeDays >= 2 ? `over ${r.intakeDays} days` : 'so far'
  return `${mlIn(r.usableMl, unit)} in the stash at ${name}’s ${mlIn(r.intakeMlPerDay, unit)} a day by bottle (${basis}).`
}

/** The goal line, or null without a goal set in Settings › Pumps. */
export function goalLine(r: StashRunway, unit: VolumeUnit, name: string, now: Date = new Date()): string | null {
  if (r.goalDays === null) return null
  if (r.goalMl === null) return `Goal: ${r.goalDays} days of bottles banked. Once bottles are logged, this shows how close the stash is.`
  const pct = Math.round((r.goalProgress ?? 0) * 100)
  if (r.goalProgress !== null && r.goalProgress >= 1) return `Goal reached: ${r.goalDays} days of bottles (${mlIn(r.goalMl, unit)}) are banked.`
  const head = `Goal: ${r.goalDays} days of bottles (${mlIn(r.goalMl, unit)}) · ${pct}% there`
  if (r.netMlPerDay === null) return `${head}. Log pumping and this says when you get there.`
  if (r.netMlPerDay <= 0) return `${head}. The stash is ${r.netMlPerDay === 0 ? 'holding steady' : `shrinking by ${mlIn(-r.netMlPerDay, unit)} a day`}, so it is not growing towards the goal.`
  const when = r.goalReachedOn!
  const inDays = differenceInCalendarDays(when, startOfDay(now))
  return `${head}. Pumping ${mlIn(r.netMlPerDay, unit)} a day more than ${name} drinks, you get there ${inDays <= 1 ? 'tomorrow' : `by ${format(when, 'MMM d')}`}.`
}
