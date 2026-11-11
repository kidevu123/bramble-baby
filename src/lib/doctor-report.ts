/**
 * The report for the pediatrician: everything the visit asks about, since the last visit (or over the last
 * N days), in one page that prints or shares as text. Pure: the page only renders what this returns.
 *
 * Growth leads (the latest weight, height and head with the WHO percentile and the change since the one
 * before, the gain since the last visit in grams a day against the doctor's goal), then the daily averages
 * with the age-typical band beside each, a week-by-week (or day-by-day) table, temperatures and medicines
 * in the range, and the points for the page's two charts (weight over the window against the WHO curves
 * and the goal, intake by day).
 */
import { addDays, differenceInCalendarDays, endOfDay, format, isSameDay, startOfDay } from 'date-fns'
import type { Child, GrowthEntry, Medication, Temperature } from './api/types'
import { summarizeDay, type EventSets, type GrowthSets } from './events'
import { growthEntryTime } from './growth-note'
import { ageMonthsOn, growthAt, growthChange, growthPercentile } from './reports'
import { asBasis, correctedAgeText, describeWeeks, judgedAge, whoFrom, type AgeFrom } from './preterm'
import { describePercentile, diaperNormFor, feedingNormFor, feverStatus, fToC, sleepNormFor, valueAtPercentile, type Sex } from './science'
import { formatAge, formatDurationShort, parseDate, parseDuration } from './time'
import { dayCalories, TYPICAL_KCAL_PER_KG, weightForDay } from './calories'
import type { FortifySettings } from './fortify'
import { convertVolume, convertWeight, formatLength, formatTemp, formatVolume, formatWeight, volumeLabel, type UnitPrefs } from './units'
import { formatGrams, formatPerDay, gainVerdict, spanDays, weightGain, type WeightGain } from './weight-gain'

export interface ReportGrowthRow {
  key: 'weight' | 'height' | 'head'
  label: string
  value: string
  date: string
  percentile: string | null
  change: string | null
}

export interface ReportAverage {
  key: 'feeds' | 'bottle' | 'mlkg' | 'nursing' | 'wet' | 'dirty' | 'sleep' | 'naps' | 'pumped' | 'kcal' | 'kcalkg'
  label: string
  value: string
  /** The same average as a number (in the unit `value` is written in), for drawing it against its band. */
  num: number
  /** The age-typical band as numbers in that unit, or null when the science has none for this age. */
  band: [number, number] | null
  /** The age-typical band in the same words, or null when the science has none for this age. */
  typical: string | null
  /** How many whole days in the range carried this kind of entry (today, still in progress, is left out). */
  loggedDays: number
}

export interface ReportDay {
  date: Date
  feeds: number
  bottle: number
  nursingMinutes: number
  /** Every diaper change that day (wet, dirty, both or dry). */
  diaperCount: number
  wet: number
  dirty: number
  sleepHours: number
  naps: number
  pumped: number
  /** Calories by bottle that day, and per kg by the weighing that applied (null without one). */
  kcal: number
  kcalPerKg: number | null
}

/** The doctor's calorie goal and the household's fortification (Settings › Calories & fortifying); null while calories are off. */
export interface ReportCalories {
  goal: number | null
  fortify: FortifySettings | null
}

/** One week of the window (the last one may be shorter), averaged over its logged days like the daily averages. */
export interface ReportWeek {
  from: Date
  to: Date
  /** Whole days in the week that carried any entry. */
  loggedDays: number
  feeds: number
  bottle: number
  kcalPerKg: number | null
  wet: number
  dirty: number
  sleepHours: number
  pumped: number
  /** The latest weighing in the week, in the phone's unit. */
  weight: { value: string; at: Date } | null
}

/** The gain between the weighing the last visit started from and the latest one: what the doctor compares. */
export interface VisitGain {
  from: { value: string; at: Date }
  to: { value: string; at: Date }
  grams: number
  days: number
  perDay: number
  /** "on the doctor's 20 g/day" / "4 g/day short of the doctor's 20" / null without a goal. */
  vsGoal: string | null
}

export interface ChartPoint {
  at: Date
  /** In the phone's weight unit. */
  value: number
}

/** The page's charts: weights over the window with the WHO curves and the goal line, intake by day. */
export interface ReportChart {
  /** Every weighing in the window, plus the one it starts from. */
  weights: ChartPoint[]
  /** From the first weighing of the window, rising at the doctor's goal, to the end; null without a goal. */
  goal: { from: ChartPoint; to: ChartPoint; gramsPerDay: number } | null
  /** The WHO 2nd, 50th and 98th for the child's sex across the window; empty without a sex or before term. */
  curves: { label: string; points: ChartPoint[] }[]
  from: Date
  to: Date
}

/** One day of the daily-pattern picture: when she slept, fed and was changed, in hours since that day's midnight. */
export interface ReportPatternDay {
  date: Date
  sleep: [number, number][]
  feeds: number[]
  wet: number[]
  dirty: number[]
}

/** A weighing in the window with the change since the one before it. */
export interface ReportWeighing {
  at: Date
  /** False when the weighing has only a date (no clock in its note). */
  timed: boolean
  value: string
  /** Change since the previous weighing listed, in grams, and per day; null on the first. */
  grams: number | null
  perDay: number | null
}

/** The daily pattern shows at most this many days (the latest), so each day keeps a readable row on one page. */
export const PATTERN_DAYS = 28

export interface DoctorReport {
  child: { name: string; birthDate: string; age: string; sex: Sex | null }
  /** `wholeDays`: the days before today, the ones the averages are taken over. `visit`: the last visit and this one when
   *  the report is for a visit (the window runs from the one to the other). */
  range: { from: Date; to: Date; days: number; wholeDays: number; visit: { last: Date; this: Date } | null }
  growth: ReportGrowthRow[]
  /** The gain since the last visit's weighing; null without a visit window or two weighings. */
  visitGain: VisitGain | null
  weeks: ReportWeek[]
  chart: ReportChart | null
  /** The weighings the chart plots, oldest first, each with its change since the one before. */
  weighings: ReportWeighing[]
  /** The latest PATTERN_DAYS days of the window, oldest first, for the 24-hour picture. */
  pattern: ReportPatternDay[]
  gain: { sinceLast: string | null; week: string | null; /** The gain since the day the goal was given. */ sinceGoal: string | null; perDay: string | null; verdict: string | null; goal: number | null } | null
  averages: ReportAverage[]
  days: ReportDay[]
  temperatures: { at: Date; value: string; level: string }[]
  medicines: { at: Date; name: string; dose: string }[]
  units: UnitPrefs
}

const band = (lo: number, hi: number, suffix = '') => (lo === hi ? `${lo}${suffix}` : `${lo}–${hi}${suffix}`)
const one = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/**
 * Averages are over the days that carry that kind of entry: a day nobody logged is not a day of zero feeds.
 * `logged` says which days count; by default the days where the value itself is above zero. Wet and dirty
 * diapers count over the days with any diaper (a day of six wet ones and no dirty one is a day of zero
 * dirty), naps over the days with any sleep.
 */
function avgOf<T>(rows: T[], value: (r: T) => number, logged: (r: T) => boolean = (r) => value(r) > 0): { value: number; days: number } {
  const active = rows.filter(logged)
  return { value: active.length ? active.reduce((s, r) => s + value(r), 0) / active.length : 0, days: active.length }
}

/** The report's window: the last N days, or a visit (from the last visit to this one, never past today). */
export type ReportWindow = number | { lastVisit: Date; thisVisit: Date }

/** A visit window is never longer than this: a one-page report cannot hold more, and well visits come sooner. */
export const MAX_VISIT_DAYS = 91
/** How far before the window a weighing may lie and still be the one it starts from. */
export const ANCHOR_DAYS = 7

export function buildDoctorReport(events: EventSets, growth: GrowthSets | undefined, child: Child, units: UnitPrefs, sex: Sex | null, goal: number | null | undefined, window: ReportWindow, now: Date = new Date(), goalSince?: string | null, age: AgeFrom = child.birth_date, calories: ReportCalories | null = null): DoctorReport {
  const today = startOfDay(now)
  let from: Date
  let to: Date
  let visit: DoctorReport['range']['visit'] = null
  if (typeof window === 'number') {
    to = today
    from = addDays(to, -(window - 1))
  } else {
    // The visit: from the last one to this one, clipped to today and to what fits a page.
    const thisVisit = startOfDay(window.thisVisit) > today ? today : startOfDay(window.thisVisit)
    let last = startOfDay(window.lastVisit)
    if (last > thisVisit) last = thisVisit
    if (differenceInCalendarDays(thisVisit, last) + 1 > MAX_VISIT_DAYS) last = addDays(thisVisit, -(MAX_VISIT_DAYS - 1))
    from = last
    to = thisVisit
    visit = { last: startOfDay(window.lastVisit), this: thisVisit }
  }
  const days = differenceInCalendarDays(to, from) + 1
  const dayList = Array.from({ length: days }, (_, i) => addDays(from, i))
  // Settings › Born early: corrected age for the bands and percentiles; none at all in the NICU or before term.
  const ctx = judgedAge(age, now)
  const basis = asBasis(age)
  const birth = parseDate(child.birth_date)

  // ---- growth: the latest of each, with the change since the one before
  const rows: ReportGrowthRow[] = []
  let gain: DoctorReport['gain'] = null
  if (growth) {
    const latestTwo = <T extends GrowthEntry>(list: T[]): [T | null, T | null] => {
      const sorted = [...list].sort((a, b) => growthAt(b).getTime() - growthAt(a).getTime())
      return [sorted[0] ?? null, sorted[1] ?? null]
    }
    const pct = (e: GrowthEntry): string | null => {
      const p = growthPercentile(e, age, sex, units)
      return Number.isNaN(p) ? null : describePercentile(p)
    }
    const [w, wPrev] = latestTwo(growth.weights)
    if (w) rows.push({ key: 'weight', label: 'Weight', value: formatWeight(w.weight, units.weight), date: format(growthAt(w), 'MMM d, yyyy'), percentile: pct(w), change: wPrev ? growthChange(w.weight, wPrev.weight, units.weight, growthAt(wPrev), growthAt(w)) : null })
    const [h, hPrev] = latestTwo(growth.heights)
    if (h) rows.push({ key: 'height', label: 'Length', value: formatLength(h.height, units.length), date: format(growthAt(h), 'MMM d, yyyy'), percentile: pct(h), change: hPrev ? growthChange(h.height, hPrev.height, units.length, growthAt(hPrev), growthAt(h)) : null })
    const [hc, hcPrev] = latestTwo(growth.heads)
    if (hc) rows.push({ key: 'head', label: 'Head', value: formatLength(hc.head_circumference, units.length), date: format(growthAt(hc), 'MMM d, yyyy'), percentile: pct(hc), change: hcPrev ? growthChange(hc.head_circumference, hcPrev.head_circumference, units.length, growthAt(hcPrev), growthAt(hc)) : null })
    const g: WeightGain = weightGain(growth.weights, units.weight, age, goal, now, goalSince)
    if (g.sinceLast || g.week) {
      const rate = g.sinceGoal ?? g.week ?? g.sinceLast!
      const t = g.sinceGoal
      gain = {
        sinceLast: g.sinceLast ? `${formatGrams(g.sinceLast.grams, units.weight)} since ${format(g.sinceLast.since, 'MMM d')}` : null,
        week: g.week ? `${formatGrams(g.week.grams, units.weight)} over the last ${g.week.days} days` : null,
        sinceGoal: t ? `${formatGrams(t.grams, units.weight)} since the goal was given on ${format(t.start, 'MMM d')} (${t.weighings} weighings over ${spanDays(t.days)})` : null,
        perDay: formatPerDay(rate.perDay, units.weight),
        verdict: gainVerdict(g, units.weight),
        goal: g.goal,
      }
    }
  }

  // ---- the gain the doctor compares: the weighing the last visit started from (the latest on or before that day,
  // else the first in the window) against the latest in the window
  let visitGain: VisitGain | null = null
  let chart: ReportChart | null = null
  if (growth) {
    const windowEnd = endOfDay(to)
    const sorted = [...growth.weights].sort((a, b) => growthAt(a).getTime() - growthAt(b).getTime()).filter((w) => growthAt(w) <= windowEnd)
    // The weighing the window starts from: the latest on or before its first day, as long as it is recent (the visit's
    // own weighing, or one within the week before); else the first inside the window.
    const before = sorted.filter((w) => growthAt(w) <= endOfDay(from) && growthAt(w) >= addDays(from, -ANCHOR_DAYS))
    const anchor = before.length ? before[before.length - 1] : sorted.find((w) => growthAt(w) >= from) ?? null
    const latest = sorted.length ? sorted[sorted.length - 1] : null
    const inWindow = sorted.filter((w) => growthAt(w) >= from && (!anchor || w.id !== anchor.id))
    const point = (w: GrowthEntry & { weight: number }): ChartPoint => ({ at: growthAt(w), value: w.weight })
    if (anchor && latest && anchor.id !== latest.id) {
      const grams = convertWeight(latest.weight - anchor.weight, units.weight, 'kg') * 1000
      const spanD = (growthAt(latest).getTime() - growthAt(anchor).getTime()) / 86_400_000
      const perDay = spanD > 0 ? grams / spanD : 0
      let vsGoal: string | null = null
      if (goal && spanD > 0) {
        const diff = Math.round(perDay - goal)
        vsGoal = Math.abs(diff) <= Math.max(1, goal * 0.1) ? `on the doctor's ${goal} g/day` : diff < 0 ? `${-diff} g/day short of the doctor's ${goal}` : `${diff} g/day over the doctor's ${goal}`
      }
      if (visit) visitGain = { from: { value: formatWeight(anchor.weight, units.weight), at: growthAt(anchor) }, to: { value: formatWeight(latest.weight, units.weight), at: growthAt(latest) }, grams: Math.round(grams), days: Math.round(spanD * 10) / 10, perDay: Math.round(perDay), vsGoal }
    }
    const weights = [...(anchor ? [point(anchor)] : []), ...inWindow.map(point)]
    if (weights.length) {
      const first = weights[0]
      const gramsPerDay = goal ?? 0
      const goalLine = goal
        ? { from: first, to: { at: windowEnd, value: first.value + convertWeight(((gramsPerDay / 1000) * (windowEnd.getTime() - first.at.getTime())) / 86_400_000, 'kg', units.weight) }, gramsPerDay }
        : null
      const curves: ReportChart['curves'] = []
      if (sex) {
        const start = weights[0].at < from ? weights[0].at : from
        const samples: Date[] = []
        for (let d = startOfDay(start); d <= windowEnd; d = addDays(d, 3)) samples.push(d)
        samples.push(windowEnd)
        for (const [p, label] of [[2.3, '2nd'], [50, '50th'], [97.7, '98th']] as [number, string][]) {
          const points: ChartPoint[] = []
          for (const at of samples) {
            const basisDay = whoFrom(age, at)
            if (basisDay === null) continue
            const months = ageMonthsOn(format(at, 'yyyy-MM-dd'), basisDay)
            if (months > 24) continue
            points.push({ at, value: convertWeight(valueAtPercentile('weight', sex, months, p), 'kg', units.weight) })
          }
          if (points.length >= 2) curves.push({ label, points })
        }
      }
      chart = { weights, goal: goalLine, curves, from: weights[0].at < from ? weights[0].at : from, to: windowEnd }
    }
  }

  // ---- the weighings the chart plots, each with its change since the one before
  const timedAt = new Map((growth?.weights ?? []).map((w) => [growthAt(w).getTime(), growthEntryTime(w) !== null]))
  const weighingRows: ReportWeighing[] = (chart?.weights ?? []).map((p, i, list) => {
    const prev = i ? list[i - 1] : null
    const grams = prev ? convertWeight(p.value - prev.value, units.weight, 'kg') * 1000 : null
    const spanD = prev ? (p.at.getTime() - prev.at.getTime()) / 86_400_000 : 0
    return { at: p.at, timed: timedAt.get(p.at.getTime()) ?? false, value: formatWeight(p.value, units.weight), grams: grams === null ? null : Math.round(grams), perDay: grams !== null && spanD >= 0.5 ? Math.round(grams / spanD) : null }
  })

  // ---- the daily pattern: each of the latest days as a row of 24 hours
  const hourOf = (t: Date, day: Date) => (t.getTime() - day.getTime()) / 3_600_000
  const pattern: ReportPatternDay[] = dayList.slice(-PATTERN_DAYS).map((day) => {
    const next = addDays(day, 1)
    const sleep: [number, number][] = []
    for (const sl of events.sleep) {
      const a = parseDate(sl.start)
      const b = parseDate(sl.end)
      if (b <= day || a >= next) continue
      sleep.push([Math.max(0, hourOf(a, day)), Math.min(24, hourOf(b, day))])
    }
    const on = (t: string) => {
      const d = parseDate(t)
      return d >= day && d < next ? hourOf(d, day) : null
    }
    const hours = (list: (number | null)[]) => list.filter((h): h is number => h !== null).sort((x, y) => x - y)
    return {
      date: day,
      sleep: sleep.sort((x, y) => x[0] - y[0]),
      feeds: hours(events.feedings.filter((f) => f.type !== 'solid food').map((f) => on(f.start))),
      wet: hours(events.changes.filter((c) => c.wet && !c.solid).map((c) => on(c.time))),
      dirty: hours(events.changes.filter((c) => c.solid).map((c) => on(c.time))),
    }
  })

  // ---- day by day
  const weighings = (growth?.weights ?? []).map((w) => ({ kg: convertWeight(w.weight, units.weight, 'kg'), at: growthAt(w) }))
  const dayRows: ReportDay[] = dayList.map((d) => {
    const s = summarizeDay(events, d)
    const nursing = events.feedings.filter((f) => isSameDay(parseDate(f.start), d) && f.type !== 'solid food' && f.method !== 'bottle').reduce((sum, f) => sum + parseDuration(f.duration) / 60, 0)
    const kcal = calories ? dayCalories(events.feedings.filter((f) => isSameDay(parseDate(f.start), d)), units.volume, calories.fortify).kcal : 0
    const kg = weightForDay(weighings, addDays(d, 1))
    return { date: d, feeds: s.feedCount, bottle: s.bottleVolume, nursingMinutes: nursing, diaperCount: s.diaperCount, wet: s.wetCount, dirty: s.solidCount, sleepHours: s.sleepSeconds / 3600, naps: s.napCount, pumped: s.pumpVolume, kcal, kcalPerKg: kg && kcal > 0 ? kcal / kg : null }
  })
  // Today is still in progress: it stays in the day-by-day table but not in the averages (2 feeds by 7 AM
  // is not a day of 2 feeds), as the supply trend and the stash runway leave it out too.
  const whole = dayRows.filter((d) => d.date.getTime() < startOfDay(now).getTime())

  // ---- week by week, from the start of the window (the last week may be short); today, in progress, is left out
  const weeks: ReportWeek[] = []
  for (let i = 0; i < whole.length; i += 7) {
    const chunk = whole.slice(i, i + 7)
    const logged = (d: ReportDay) => d.feeds > 0 || d.diaperCount > 0 || d.sleepHours > 0 || d.pumped > 0
    const active = chunk.filter(logged)
    const avg = (value: (d: ReportDay) => number, rows: ReportDay[] = active) => (rows.length ? rows.reduce((s, d) => s + value(d), 0) / rows.length : 0)
    const withKcal = active.filter((d) => d.kcalPerKg !== null)
    const wkEnd = endOfDay(chunk[chunk.length - 1].date)
    const wkWeights = (growth?.weights ?? []).filter((w) => growthAt(w) >= chunk[0].date && growthAt(w) <= wkEnd).sort((a, b) => growthAt(b).getTime() - growthAt(a).getTime())
    weeks.push({
      from: chunk[0].date,
      to: chunk[chunk.length - 1].date,
      loggedDays: active.length,
      feeds: avg((d) => d.feeds),
      bottle: avg((d) => d.bottle),
      kcalPerKg: withKcal.length ? avg((d) => d.kcalPerKg ?? 0, withKcal) : null,
      wet: avg((d) => d.wet, active.filter((d) => d.diaperCount > 0)),
      dirty: avg((d) => d.dirty, active.filter((d) => d.diaperCount > 0)),
      sleepHours: avg((d) => d.sleepHours, active.filter((d) => d.sleepHours > 0)),
      pumped: avg((d) => d.pumped, active.filter((d) => d.pumped > 0)),
      weight: wkWeights.length ? { value: formatWeight(wkWeights[0].weight, units.weight), at: growthAt(wkWeights[0]) } : null,
    })
  }

  // ---- averages with the age-typical band
  const averages: ReportAverage[] = []
  if (!ctx.expecting) {
    const feedNorm = feedingNormFor(ctx.ageMonths, ctx.dayOfLife)
    const diaperNorm = diaperNormFor(ctx.dayOfLife)
    const sleepNorm = sleepNormFor(ctx.ageMonths)
    const vol = volumeLabel(units.volume)
    const feeds = avgOf(whole, (d) => d.feeds)
    averages.push({ key: 'feeds', label: 'Feeds a day', value: one(feeds.value), num: feeds.value, band: ctx.hold ? null : [feedNorm.feedsPerDay[0], feedNorm.feedsPerDay[1]], typical: ctx.hold ? null : band(feedNorm.feedsPerDay[0], feedNorm.feedsPerDay[1]), loggedDays: feeds.days })
    const bottle = avgOf(whole, (d) => d.bottle)
    if (bottle.days) {
      const dayBand: [number, number] | null = !ctx.hold && feedNorm.ozPerDay ? [Math.round(convertVolume(feedNorm.ozPerDay[0], 'oz', units.volume)), Math.round(convertVolume(feedNorm.ozPerDay[1], 'oz', units.volume))] : null
      const typicalDay = dayBand ? band(dayBand[0], dayBand[1], ` ${vol}`) : null
      averages.push({ key: 'bottle', label: 'By bottle a day', value: formatVolume(bottle.value, units.volume), num: bottle.value, band: dayBand, typical: typicalDay, loggedDays: bottle.days })
      // Intake per kilogram, the figure a pediatrician reasons in: each day's bottles over the weight that applied.
      // The 150–180 mL/kg band is for full feeds by bottle (row 90): none when she also nurses, is held, or is past 6 months.
      const perKgDays = whole.filter((d) => d.bottle > 0).map((d) => ({ d, kg: weightForDay(weighings, addDays(d.date, 1)) })).filter((x): x is { d: ReportDay; kg: number } => x.kg !== null && x.kg > 0)
      if (perKgDays.length) {
        const mlkg = perKgDays.reduce((sum, x) => sum + convertVolume(x.d.bottle, units.volume, 'ml') / x.kg, 0) / perKgDays.length
        const nurses = dayRows.some((d) => d.nursingMinutes > 0) // today's nursing counts too: she is not bottle-only
        const applies = !ctx.hold && !nurses && ctx.dayOfLife >= 14 && ctx.ageMonths < 6
        averages.push({ key: 'mlkg', label: 'Intake per kg a day', value: `${Math.round(mlkg)} mL/kg`, num: mlkg, band: applies ? [150, 180] : null, typical: applies ? '150–180 mL/kg' : nurses ? 'bottles only; nursing not counted' : null, loggedDays: perKgDays.length })
      }
    }
    const kcal = avgOf(whole, (d) => d.kcal)
    if (kcal.days) averages.push({ key: 'kcal', label: 'Calories by bottle a day', value: `${Math.round(kcal.value)} kcal`, num: kcal.value, band: null, typical: null, loggedDays: kcal.days })
    const perKg = avgOf(whole, (d) => d.kcalPerKg ?? 0)
    if (perKg.days && calories) averages.push({ key: 'kcalkg', label: calories.goal ? `kcal per kg a day (goal ${calories.goal})` : 'kcal per kg a day', value: String(Math.round(perKg.value)), num: perKg.value, band: ctx.hold || ctx.ageMonths >= 6 ? null : [TYPICAL_KCAL_PER_KG[0], TYPICAL_KCAL_PER_KG[1]], typical: ctx.hold || ctx.ageMonths >= 6 ? null : band(TYPICAL_KCAL_PER_KG[0], TYPICAL_KCAL_PER_KG[1]), loggedDays: perKg.days })
    const nursing = avgOf(whole, (d) => d.nursingMinutes)
    // A day's total minutes has no band: the science gives minutes a side per feed, which beside a day's
    // total would read as six times over.
    if (nursing.days) averages.push({ key: 'nursing', label: 'Nursing a day', value: `${Math.round(nursing.value)} min`, num: nursing.value, band: null, typical: null, loggedDays: nursing.days })
    const anyDiaper = (d: ReportDay) => d.diaperCount > 0
    const wet = avgOf(whole, (d) => d.wet, anyDiaper)
    averages.push({ key: 'wet', label: 'Wet diapers a day', value: one(wet.value), num: wet.value, band: ctx.hold ? null : [diaperNorm.wetPerDay[0], diaperNorm.wetPerDay[1]], typical: ctx.hold ? null : band(diaperNorm.wetPerDay[0], diaperNorm.wetPerDay[1]), loggedDays: wet.days })
    const dirty = avgOf(whole, (d) => d.dirty, anyDiaper)
    averages.push({ key: 'dirty', label: 'Dirty diapers a day', value: one(dirty.value), num: dirty.value, band: ctx.hold ? null : [diaperNorm.dirtyPerDay[0], diaperNorm.dirtyPerDay[1]], typical: ctx.hold ? null : band(diaperNorm.dirtyPerDay[0], diaperNorm.dirtyPerDay[1]), loggedDays: dirty.days })
    const sleep = avgOf(whole, (d) => d.sleepHours)
    averages.push({ key: 'sleep', label: 'Sleep a day', value: formatDurationShort(sleep.value * 3600), num: sleep.value, band: ctx.hold ? null : [sleepNorm.totalHours[0], sleepNorm.totalHours[1]], typical: ctx.hold ? null : `${band(sleepNorm.totalHours[0], sleepNorm.totalHours[1])} h`, loggedDays: sleep.days })
    const naps = avgOf(whole, (d) => d.naps, (d) => d.sleepHours > 0)
    if (whole.some((d) => d.naps > 0)) averages.push({ key: 'naps', label: 'Naps a day', value: one(naps.value), num: naps.value, band: ctx.hold ? null : [sleepNorm.napsPerDay[0], sleepNorm.napsPerDay[1]], typical: ctx.hold ? null : band(sleepNorm.napsPerDay[0], sleepNorm.napsPerDay[1]), loggedDays: naps.days })
    const pumped = avgOf(whole, (d) => d.pumped)
    if (pumped.days) averages.push({ key: 'pumped', label: 'Pumped a day', value: formatVolume(pumped.value, units.volume), num: pumped.value, band: null, typical: null, loggedDays: pumped.days })
  }

  // ---- health in the range
  const inRange = (t: string) => {
    const d = parseDate(t)
    return d >= from && d < addDays(to, 1)
  }
  const temperatures = events.temperature
    .filter((t: Temperature) => inRange(t.time))
    .sort((a, b) => parseDate(a.time).getTime() - parseDate(b.time).getTime())
    .map((t) => {
      const c = units.temp === 'f' ? fToC(t.temperature) : t.temperature
      const level = feverStatus(c, ctx.ageMonths).level
      return { at: parseDate(t.time), value: formatTemp(t.temperature, units.temp), level: level === 'normal' ? 'normal' : level === 'low-grade' ? 'low-grade fever' : level === 'fever' ? 'fever' : 'high fever' }
    })
  const medicines = events.medication
    .filter((m: Medication) => inRange(m.time))
    .sort((a, b) => parseDate(a.time).getTime() - parseDate(b.time).getTime())
    .map((m) => ({ at: parseDate(m.time), name: m.name, dose: m.dosage ? `${m.dosage} ${m.dosage_unit}` : '' }))

  return {
    child: { name: child.first_name, birthDate: format(birth, 'MMM d, yyyy'), age: [formatAge(child.birth_date, now), correctedAgeText(basis, now), basis.bornAtDays !== null ? `born at ${describeWeeks(basis.bornAtDays)}` : null].filter(Boolean).join(' · '), sex },
    range: { from, to, days, wholeDays: whole.length, visit },
    growth: rows,
    visitGain,
    weeks,
    chart,
    weighings: weighingRows,
    pattern,
    gain,
    averages,
    days: dayRows,
    temperatures,
    medicines,
    units,
  }
}

/** The same report as plain text, for the share sheet, a message, or a patient portal. */
export function reportText(r: DoctorReport): string {
  const lines: string[] = []
  lines.push(`${r.child.name} · born ${r.child.birthDate} · ${r.child.age}${r.child.sex ? ` · ${r.child.sex === 'male' ? 'boy' : 'girl'}` : ''}`)
  lines.push(`${r.range.visit ? `Since the visit on ${format(r.range.visit.last, 'MMM d')}: ` : ''}${format(r.range.from, 'MMM d')} – ${format(r.range.to, 'MMM d, yyyy')} (${r.range.days} days), from Bramble`)
  if (r.growth.length) {
    lines.push('')
    lines.push('GROWTH')
    for (const g of r.growth) lines.push(`${g.label}: ${g.value} on ${g.date}${g.percentile ? ` · ${g.percentile}` : ''}${g.change ? ` · ${g.change}` : ''}`)
    if (r.visitGain) lines.push(`Since the last visit: ${r.visitGain.from.value} (${format(r.visitGain.from.at, 'MMM d')}) → ${r.visitGain.to.value} (${format(r.visitGain.to.at, 'MMM d')}), ${r.visitGain.grams >= 0 ? '+' : ''}${r.visitGain.grams} g over ${r.visitGain.days} days = ${r.visitGain.perDay} g/day${r.visitGain.vsGoal ? `, ${r.visitGain.vsGoal}` : ''}`)
    if (r.gain) {
      if (r.gain.sinceLast) lines.push(`Gain: ${r.gain.sinceLast}`)
      if (r.gain.week) lines.push(`Gain: ${r.gain.week}`)
      if (r.gain.sinceGoal) lines.push(`Gain: ${r.gain.sinceGoal}`)
      if (r.gain.perDay) lines.push(`Per day: ${r.gain.perDay}${r.gain.goal ? ` (goal ${r.gain.goal} g/day)` : ''}`)
    }
  }
  if (r.averages.length) {
    lines.push('')
    lines.push(`DAILY AVERAGES (over the ${r.range.wholeDays} full days before today)`)
    for (const a of r.averages) lines.push(`${a.label}: ${a.value}${a.typical ? ` (typical ${a.typical})` : ''}${a.loggedDays < r.range.wholeDays ? ` · ${a.loggedDays} of ${r.range.wholeDays} days logged` : ''}`)
  }
  if (r.weeks.length > 2) {
    lines.push('')
    lines.push('WEEK BY WEEK (averages over the days logged)')
    lines.push(`week · feeds/day · bottle/day · wet/dirty · sleep · weight`)
    for (const w of r.weeks) {
      lines.push(`${format(w.from, 'MMM d')}–${format(w.to, 'MMM d')} · ${one(w.feeds)} · ${w.bottle ? formatVolume(w.bottle, r.units.volume) : '–'} · ${one(w.wet)}/${one(w.dirty)} · ${w.sleepHours ? formatDurationShort(w.sleepHours * 3600) : '–'} · ${w.weight ? `${w.weight.value} (${format(w.weight.at, 'MMM d')})` : '–'}`)
    }
  } else {
    lines.push('')
    lines.push('DAY BY DAY')
    lines.push(`date · feeds · bottle · wet/dirty · sleep · pumped`)
    for (const d of r.days) {
      lines.push(`${format(d.date, 'MMM d')} · ${d.feeds} · ${d.bottle ? formatVolume(d.bottle, r.units.volume) : '–'} · ${d.wet}/${d.dirty} · ${d.sleepHours ? formatDurationShort(d.sleepHours * 3600) : '–'} · ${d.pumped ? formatVolume(d.pumped, r.units.volume) : '–'}`)
    }
  }
  if (r.temperatures.length) {
    lines.push('')
    lines.push('TEMPERATURES')
    for (const t of r.temperatures) lines.push(`${format(t.at, 'MMM d h:mm a')}: ${t.value} (${t.level})`)
  }
  if (r.medicines.length) {
    lines.push('')
    lines.push('MEDICINES')
    for (const m of r.medicines) lines.push(`${format(m.at, 'MMM d h:mm a')}: ${m.name}${m.dose ? ` ${m.dose}` : ''}`)
  }
  return lines.join('\n')
}
