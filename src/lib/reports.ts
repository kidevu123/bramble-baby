/**
 * The numbers Reports leads with: one day's totals against what is usual for this child and typical
 * for the age (the Day view's glance), and a range's daily averages per category (the Summary overview).
 * Pure functions over the event sets, so the page stays layout.
 */
import { addDays, differenceInCalendarDays, format, isSameDay, startOfDay } from 'date-fns'
import type { Child, GrowthEntry } from './api/types'
import { ACTIVITY_LABEL, dayWindow, isPotty, summarizeDay, type EventSets, type GrowthSets, type TimelineItem } from './events'
import { dayCalories, weightForDay, type CalorieTracking } from './calories'
import { decodeSolidsNotes } from './foods'
import { growthEntryTime } from './growth-note'
import { compareDiapers, compareFeeds, compareSleep, diaperNormFor, feedingNormFor, feverStatus, fToC, percentile, sleepNormFor, type NormStatus, type Sex } from './science'
import { holdNote, judgedAge, whoFrom, type AgeFrom } from './preterm'
import { formatDurationShort, parseDate, parseDuration as parseDur } from './time'
import { convertLength, convertVolume, convertWeight, formatLength, formatTemp, formatWeight, roundTo, volumeLabel, type UnitPrefs, type VolumeUnit } from './units'

/** A glance figure: whole mL, one decimal of oz ("12.2 oz", not "12.18 oz"). */
export function tidyVolume(amount: number, unit: VolumeUnit): string {
  return `${unit === 'oz' ? roundTo(amount, 1) : Math.round(amount)} ${volumeLabel(unit)}`
}

export type GlanceKey = 'sleep' | 'feeds' | 'diapers' | 'pumping'
export type GlanceStatus = NormStatus | 'none'

export interface GlanceStat {
  key: GlanceKey
  label: string
  /** The headline number ("9h 27m", "8 feeds"). */
  value: string
  /** The second line: what else the day held ("12 oz by bottle", "6 wet · 2 poo"). */
  detail: string
  /** The child's own average over the week before this day, or null without enough days. */
  usual: string | null
  /** Against the age-typical range; 'none' where there is no norm (pumping) or nothing to judge yet. */
  status: GlanceStatus
  /** The range itself, in words ("typical 14–17h"), for the status caption. */
  typical: string | null
}

const WEEK = 7

/** Mean of the days that have anything logged, or null when fewer than two do. */
function usualOf(values: number[]): number | null {
  const active = values.filter((v) => v > 0)
  return active.length >= 2 ? active.reduce((s, v) => s + v, 0) / active.length : null
}

/**
 * One day at a glance. For today the sleep figure is the last 24 h (a day in progress has not had its
 * night yet) and feeds/diapers are judged against the hours elapsed, as the Home card does; a past day
 * is judged whole. The day runs from `dayStartHour` (the same window as the Day view's strip: 0 for
 * midnight, the child's day start when Reports starts days there), so a tile counts what the strip draws.
 */
export function dayGlance(events: EventSets, child: Child, units: UnitPrefs, day: Date, now: Date = new Date(), dayStartHour = 0, age: AgeFrom = child.birth_date): GlanceStat[] {
  const win = dayWindow(day, dayStartHour)
  if (now < win.start) return [] // a day that has not begun yet has nothing to judge
  const today = now >= win.start && now < win.end
  const ctx = judgedAge(age, today ? now : day) // a past day is judged by the age that day
  if (ctx.expecting) return []
  // In the NICU or before the due date (Settings › Born early): the numbers, never a verdict by age.
  const held = ctx.hold !== null
  const summary = summarizeDay(events, day, dayStartHour)
  const hours = today ? (now.getTime() - win.start.getTime()) / 3_600_000 : 24
  const before = Array.from({ length: WEEK }, (_, i) => summarizeDay(events, addDays(startOfDay(day), -(i + 1)), dayStartHour))
  const inDay = (t: string) => {
    const d = parseDate(t)
    return d >= win.start && d < win.end
  }

  let sleepSeconds = summary.sleepSeconds
  if (today) {
    const dayAgo = now.getTime() - 24 * 3600_000
    sleepSeconds = 0
    for (const s of events.sleep) {
      const st = Math.max(parseDate(s.start).getTime(), dayAgo)
      const en = Math.min(parseDate(s.end).getTime(), now.getTime())
      if (en > st) sleepSeconds += (en - st) / 1000
    }
  }
  const sleepNorm = sleepNormFor(ctx.ageMonths)
  const sleepUsual = usualOf(before.map((b) => b.sleepSeconds))
  const sleep: GlanceStat = {
    key: 'sleep',
    label: today ? 'Sleep, last 24 h' : 'Sleep',
    value: sleepSeconds > 0 ? formatDurationShort(sleepSeconds) : '—',
    detail: summary.napCount ? `${summary.napCount} nap${summary.napCount === 1 ? '' : 's'}` : 'no naps logged',
    usual: sleepUsual !== null ? formatDurationShort(sleepUsual) : null,
    status: !held && sleepSeconds > 0 ? compareSleep(sleepSeconds, ctx.ageMonths).status : 'none',
    typical: held ? null : `typical ${sleepNorm.totalHours[0]}–${sleepNorm.totalHours[1]}h`,
  }

  const feedsToday = events.feedings.filter((f) => f.type !== 'solid food' && inDay(f.start))
  const bottle = feedsToday.reduce((s, f) => s + (f.method === 'bottle' ? f.amount ?? 0 : 0), 0)
  const bottleOz = units.volume === 'oz' ? bottle : convertVolume(bottle, 'ml', 'oz')
  const feedNorm = feedingNormFor(ctx.ageMonths, ctx.dayOfLife)
  const feedUsual = usualOf(before.map((b) => b.feedCount))
  const feeds: GlanceStat = {
    key: 'feeds',
    label: 'Feeds',
    value: feedsToday.length ? `${feedsToday.length}` : '—',
    detail: bottle > 0 ? `${tidyVolume(bottle, units.volume)} by bottle` : feedsToday.length ? 'all nursing' : 'none logged',
    usual: feedUsual !== null ? `${Math.round(feedUsual * 10) / 10} a day` : null,
    status: !held && (feedsToday.length || hours > 12) ? compareFeeds(feedsToday.length, bottleOz || null, ctx.ageMonths, ctx.dayOfLife, hours).status : 'none',
    typical: held ? null : `typical ${feedNorm.feedsPerDay[0]}–${feedNorm.feedsPerDay[1]} a day`,
  }

  const diapersToday = events.changes.filter((d) => !isPotty(d) && inDay(d.time))
  const wet = diapersToday.filter((d) => d.wet).length
  const dirty = diapersToday.filter((d) => d.solid).length
  const diaperNorm = diaperNormFor(ctx.dayOfLife)
  const diaperUsual = usualOf(before.map((b) => b.diaperCount))
  const diapers: GlanceStat = {
    key: 'diapers',
    label: 'Diapers',
    value: diapersToday.length ? `${diapersToday.length}` : '—',
    detail: diapersToday.length ? `${wet} wet · ${dirty} poo` : 'none logged',
    usual: diaperUsual !== null ? `${Math.round(diaperUsual * 10) / 10} a day` : null,
    status: !held && ctx.ageMonths < 12 && (diapersToday.length || hours > 12) ? compareDiapers(wet, dirty, ctx.dayOfLife, hours).status : 'none',
    typical: held ? null : `typical ${diaperNorm.wetPerDay[0]}–${diaperNorm.wetPerDay[1]} wet a day`,
  }

  const pumpsToday = events.pumping.filter((p) => inDay(p.start))
  const pumpUsual = usualOf(before.map((b) => b.pumpVolume))
  const pumping: GlanceStat = {
    key: 'pumping',
    label: 'Pumped',
    value: summary.pumpVolume > 0 ? tidyVolume(summary.pumpVolume, units.volume) : '—',
    detail: pumpsToday.length ? `${pumpsToday.length} session${pumpsToday.length === 1 ? '' : 's'}` : 'none logged',
    usual: pumpUsual !== null ? `${tidyVolume(pumpUsual, units.volume)} a day` : null,
    status: 'none',
    typical: null,
  }
  return [sleep, feeds, diapers, pumping]
}

export interface OverviewRow {
  key: GlanceKey
  label: string
  /** Daily average over the days with data ("9h 10m", "7.7"). */
  average: string
  /** What the average is of ("a day", "feeds a day"). */
  unit: string
  /** One value per day in the range, oldest first, for the sparkline. */
  series: number[]
  status: GlanceStatus
  /** Why it has that status, in words ("within the typical 14–17h for this age"). */
  note: string
}

/** Compares a range average with the age-typical band, with half a unit of grace, like compareSleep. */
export function bandStatus(value: number, band: [number, number], grace = 0): NormStatus {
  return value < band[0] - grace ? 'low' : value > band[1] + grace ? 'high' : 'typical'
}

function bandNote(status: NormStatus, band: [number, number], what: string, suffix = ''): string {
  const range = `${band[0]}–${band[1]}${suffix}`
  return status === 'typical' ? `within the typical ${range} ${what}` : status === 'low' ? `below the typical ${range} ${what}` : `above the typical ${range} ${what}`
}

/** The Summary overview: each category's daily average across `days`, with where it sits for the age. */
export function rangeOverview(events: EventSets, child: Child, units: UnitPrefs, days: Date[], now: Date = new Date(), age: AgeFrom = child.birth_date): OverviewRow[] {
  const ctx = judgedAge(age, now)
  if (ctx.expecting) return []
  const held = ctx.hold
  const heldNote = (count: string) => `${count} ${holdNote(held)}`
  const summaries = days.map((d) => summarizeDay(events, d))
  const avg = (values: number[]) => {
    const active = values.filter((v) => v > 0)
    return active.length ? active.reduce((s, v) => s + v, 0) / active.length : 0
  }
  const rows: OverviewRow[] = []

  const sleepHours = summaries.map((s) => s.sleepSeconds / 3600)
  const sleepAvg = avg(sleepHours)
  const sleepNorm = sleepNormFor(ctx.ageMonths)
  const sleepStatus = !held && sleepAvg > 0 ? bandStatus(sleepAvg, sleepNorm.totalHours, 0.5) : 'none'
  rows.push({
    key: 'sleep',
    label: 'Sleep',
    average: sleepAvg > 0 ? formatDurationShort(sleepAvg * 3600) : '—',
    unit: 'a day',
    series: sleepHours,
    status: sleepStatus,
    note: sleepAvg > 0 && held ? heldNote(`${formatDurationShort(sleepAvg * 3600)} a day.`) : sleepStatus === 'none' ? 'No sleep logged in this range.' : bandNote(sleepStatus, sleepNorm.totalHours, 'for this age', 'h'),
  })

  const feedCounts = summaries.map((s) => s.feedCount)
  const feedAvg = avg(feedCounts)
  const feedNorm = feedingNormFor(ctx.ageMonths, ctx.dayOfLife)
  const feedStatus = !held && feedAvg > 0 ? bandStatus(feedAvg, feedNorm.feedsPerDay, 0.5) : 'none'
  const bottleAvg = avg(summaries.map((s) => s.bottleVolume))
  rows.push({
    key: 'feeds',
    label: 'Feeding',
    average: feedAvg > 0 ? `${Math.round(feedAvg * 10) / 10}` : '—',
    unit: bottleAvg > 0 ? `feeds a day · ${tidyVolume(bottleAvg, units.volume)} by bottle` : 'feeds a day',
    series: feedCounts,
    status: feedStatus,
    note: feedAvg > 0 && held ? heldNote(`${Math.round(feedAvg * 10) / 10} feeds a day.`) : feedStatus === 'none' ? 'No feeds logged in this range.' : bandNote(feedStatus, feedNorm.feedsPerDay, 'feeds a day'),
  })

  const diaperCounts = summaries.map((s) => s.diaperCount)
  const diaperAvg = avg(diaperCounts)
  // Wet a day over the days with any diaper logged: a day of only dirty ones is a day of no wet ones.
  const diaperDays = summaries.filter((s) => s.diaperCount > 0)
  const wetAvg = diaperDays.length ? diaperDays.reduce((a, s) => a + s.wetCount, 0) / diaperDays.length : 0
  const diaperNorm = diaperNormFor(ctx.dayOfLife)
  const diaperStatus = !held && ctx.ageMonths < 12 && diaperAvg > 0 ? bandStatus(wetAvg, diaperNorm.wetPerDay, 0.5) : 'none'
  rows.push({
    key: 'diapers',
    label: 'Diapers',
    average: diaperAvg > 0 ? `${Math.round(diaperAvg * 10) / 10}` : '—',
    unit: diaperAvg > 0 ? `a day · ${Math.round(wetAvg * 10) / 10} wet` : 'a day',
    series: diaperCounts,
    status: diaperStatus,
    note: diaperStatus === 'none' ? (diaperAvg > 0 ? (held ? heldNote(`${Math.round(diaperAvg * 10) / 10} changes a day.`) : `${Math.round(diaperAvg * 10) / 10} changes a day.`) : 'No diapers logged in this range.') : bandNote(diaperStatus, diaperNorm.wetPerDay, 'wet a day'),
  })

  const pumpVolumes = summaries.map((s) => s.pumpVolume)
  const pumpAvg = avg(pumpVolumes)
  const pumpTotal = pumpVolumes.reduce((s, v) => s + v, 0)
  rows.push({
    key: 'pumping',
    label: 'Pumping',
    average: pumpAvg > 0 ? tidyVolume(pumpAvg, units.volume) : '—',
    unit: pumpAvg > 0 ? `a day · ${tidyVolume(pumpTotal, units.volume)} in all` : 'a day',
    series: pumpVolumes,
    status: 'none',
    note: pumpAvg > 0 ? `${pumpVolumes.filter((v) => v > 0).length} of ${days.length} days with a session.` : 'No pumping logged in this range.',
  })
  return rows
}

// ---- The Day view's second tier: growth and whatever else the day held.


export type ExtraKey = 'calories' | 'weight' | 'height' | 'head' | 'temperature' | 'medicine' | 'tummy' | 'solids' | 'activity'

export interface ExtraStat {
  key: ExtraKey
  label: string
  value: string
  detail: string
  /** The Summary category a tap opens. */
  cat: 'feed' | 'growth' | 'temperature' | 'medicine' | 'activity' | 'solids'
}

/** The entry's moment: its clock segment when the note has one, else noon of its date. */
export function growthAt(e: GrowthEntry): Date {
  return growthEntryTime(e) ?? new Date(`${e.date}T12:00:00`)
}

export const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`

/** The child's age in months on a calendar date: whole days since birth over the WHO's 30.4375-day month,
 *  whatever the time of day of the entry. */
export function ageMonthsOn(date: string | Date, birthDate: string): number {
  return differenceInCalendarDays(parseDate(date), parseDate(birthDate)) / 30.4375
}

/**
 * The WHO percentile of one growth entry (its value in `units`), at the child's age on the entry's own
 * date; NaN when there is none (no sex set, past 24 months). The one rule Reports, the pediatrician report
 * and the Child page share, so the same height never reads 64th on one screen and 62nd on another.
 */
export function growthPercentile(entry: GrowthEntry, age: AgeFrom, sex: Sex | null | undefined, units: UnitPrefs): number {
  if (!sex) return NaN
  // A baby born early (Settings › Born early) is on the WHO standards from his due date, by corrected age.
  const from = whoFrom(age, parseDate(entry.date))
  if (from === null) return NaN
  const months = ageMonthsOn(entry.date, from)
  if ('weight' in entry) return percentile('weight', sex, months, convertWeight(entry.weight, units.weight, 'kg'))
  if ('height' in entry) return percentile('length', sex, months, convertLength(entry.height, units.length, 'cm'))
  return percentile('head', sex, months, convertLength(entry.head_circumference, units.length, 'cm'))
}

/** "64th pct" for a growth entry, or '' when there is no percentile. */
export function growthPercentileLabel(entry: GrowthEntry, age: AgeFrom, sex: Sex | null | undefined, units: UnitPrefs): string {
  const p = growthPercentile(entry, age, sex, units)
  if (Number.isNaN(p)) return ''
  // A rounded "0th" or "100th" means nothing: off the chart reads as under the 1st / over the 99th.
  if (p < 0.5) return '<1st pct'
  if (p > 99.5) return '>99th pct'
  return `${ordinal(Math.round(p))} pct`
}

/** "+1.2 oz since Oct 1" in the household's own unit, small differences in the small unit. */
export function growthChange(latest: number, previous: number, unit: 'lb' | 'kg' | 'in' | 'cm', since: Date, latestAt?: Date): string {
  const d = latest - previous
  // Two weighings on the same day: "since 8:38 AM", not "since Oct 8".
  const when = latestAt && isSameDay(since, latestAt) ? format(since, 'h:mm a') : format(since, 'MMM d')
  // Below what the small unit shows (a tenth of an ounce, a gram, a tenth of an inch) is no change.
  const tiny = unit === 'lb' ? 0.05 / 16 : unit === 'kg' ? 0.0005 : 0.05
  if (Math.abs(d) < tiny) return `no change since ${when}`
  const sign = d > 0 ? '+' : '−'
  const a = Math.abs(d)
  let text: string
  // Weight carries the other unit too: the doctor talks in grams, the phone shows ounces.
  if (unit === 'lb') text = `${a < 1 ? `${Math.round(a * 16 * 10) / 10} oz` : `${Math.round(a * 100) / 100} lb`} (${Math.round(a * 453.59237)} g)`
  else if (unit === 'kg') {
    const oz = Math.round(((a * 1000) / 28.349523125) * 10) / 10
    // Under a twentieth of an ounce the ounce part says nothing: "+1 g", never "+1 g (0 oz)".
    text = `${a < 1 ? `${Math.round(a * 1000)} g` : `${Math.round(a * 100) / 100} kg`}${oz > 0 ? ` (${oz} oz)` : ''}`
  }
  else text = `${Math.round(a * 10) / 10} ${unit}`
  return `${sign}${text} since ${when}`
}

/**
 * Growth as it stood on that day (the latest measurement on or before it, the change since the one
 * before, and the WHO percentile when the child's sex is set) and the day's temperature, medicine,
 * tummy time, solids and other activities, only when the day has them.
 */
export function dayExtras(events: EventSets, growth: GrowthSets | undefined, child: Child, units: UnitPrefs, sex: Sex | null, day: Date, now: Date = new Date(), dayStartHour = 0, age: AgeFrom = child.birth_date, calories: CalorieTracking | null = null): ExtraStat[] {
  const win = dayWindow(day, dayStartHour)
  const ctx = judgedAge(age, now >= win.start && now < win.end ? now : day)
  if (ctx.expecting) return []
  const out: ExtraStat[] = []
  // Calories switched on (Settings › Calories & fortifying): the day's total by bottle leads, per kg by the weighing
  // that applied, against the doctor's goal. Nursing has no volume, so it is named as left out.
  if (calories) {
    const feeds = events.feedings.filter((f) => {
      const d = parseDate(f.start)
      return d >= win.start && d < win.end
    })
    const c = dayCalories(feeds, units.volume, calories.fortify)
    if (c.bottles) {
      const kg = weightForDay((growth?.weights ?? []).map((w) => ({ kg: convertWeight(w.weight, units.weight, 'kg'), at: growthAt(w) })), win.end)
      const parts = [`${c.bottles} bottle${c.bottles === 1 ? '' : 's'}`]
      if (kg) parts.push(`${Math.round(c.kcal / kg)} kcal/kg${calories.goal ? ` of the doctor's ${calories.goal}` : ''}`)
      if (c.nursing) parts.push('nursing not counted')
      if (now >= win.start && now < win.end) parts.push('so far today')
      out.push({ key: 'calories', label: 'Calories', value: `${Math.round(c.kcal)} kcal`, detail: parts.join(' · '), cat: 'feed' })
    }
  }
  const pct = (e: GrowthEntry) => {
    const label = growthPercentileLabel(e, age, sex, units)
    return label ? ` · ${label}` : ''
  }

  if (growth) {
    // Only what was measured on the day being looked at (with the change since the measurement before it): a
    // height from three days ago is not that day's activity, and read like it was (2026-10-12).
    const dayStart = win.start.getTime()
    const dayEnd = win.end.getTime()
    const latestOf = <T extends GrowthEntry>(list: T[]): [T | null, T | null] => {
      const sorted = list.filter((e) => growthAt(e).getTime() < dayEnd).sort((a, b) => growthAt(b).getTime() - growthAt(a).getTime())
      const onDay = sorted[0] && growthAt(sorted[0]).getTime() >= dayStart ? sorted[0] : null
      return [onDay, onDay ? (sorted[1] ?? null) : null]
    }
    const [w, wPrev] = latestOf(growth.weights)
    if (w) {
      out.push({
        key: 'weight',
        label: 'Weight',
        value: formatWeight(w.weight, units.weight),
        detail: `${format(growthAt(w), 'MMM d')}${wPrev ? ` · ${growthChange(w.weight, wPrev.weight, units.weight, growthAt(wPrev), growthAt(w))}` : ''}${pct(w)}`,
        cat: 'growth',
      })
    }
    const [h, hPrev] = latestOf(growth.heights)
    if (h) {
      out.push({
        key: 'height',
        label: 'Height',
        value: formatLength(h.height, units.length),
        detail: `${format(growthAt(h), 'MMM d')}${hPrev ? ` · ${growthChange(h.height, hPrev.height, units.length, growthAt(hPrev), growthAt(h))}` : ''}${pct(h)}`,
        cat: 'growth',
      })
    }
    const [hc, hcPrev] = latestOf(growth.heads)
    if (hc) {
      out.push({
        key: 'head',
        label: 'Head',
        value: formatLength(hc.head_circumference, units.length),
        detail: `${format(growthAt(hc), 'MMM d')}${hcPrev ? ` · ${growthChange(hc.head_circumference, hcPrev.head_circumference, units.length, growthAt(hcPrev), growthAt(hc))}` : ''}${pct(hc)}`,
        cat: 'growth',
      })
    }
  }

  const onDay = (t: string) => {
    const d = parseDate(t)
    return d >= win.start && d < win.end
  }
  const temps = events.temperature.filter((t) => onDay(t.time)).sort((a, b) => parseDate(b.time).getTime() - parseDate(a.time).getTime())
  if (temps.length) {
    const t = temps[0]
    const c = units.temp === 'f' ? fToC(t.temperature) : t.temperature
    const fever = feverStatus(c, ctx.ageMonths)
    const word = fever.level === 'normal' ? 'normal' : fever.level === 'low-grade' ? 'low-grade fever' : fever.level === 'fever' ? 'fever' : 'high fever, call the pediatrician'
    out.push({ key: 'temperature', label: 'Temperature', value: formatTemp(t.temperature, units.temp), detail: `${format(parseDate(t.time), 'h:mm a')} · ${word}${temps.length > 1 ? ` · ${temps.length} readings` : ''}`, cat: 'temperature' })
  }
  const meds = events.medication.filter((m) => onDay(m.time))
  if (meds.length) {
    const names = [...new Set(meds.map((m) => m.name.trim()).filter(Boolean))]
    out.push({ key: 'medicine', label: 'Medicine', value: `${meds.length} dose${meds.length === 1 ? '' : 's'}`, detail: names.join(', ') || 'logged', cat: 'medicine' })
  }
  const tummy = events.tummy.filter((t) => onDay(t.start))
  if (tummy.length) {
    const minutes = Math.round(tummy.reduce((s, t) => s + parseDur(t.duration), 0) / 60)
    out.push({ key: 'tummy', label: 'Tummy time', value: `${minutes} min`, detail: `${tummy.length} session${tummy.length === 1 ? '' : 's'}`, cat: 'activity' })
  }
  const solids = events.feedings.filter((f) => f.type === 'solid food' && onDay(f.start))
  if (solids.length) {
    const foods = [...new Set(solids.flatMap((f) => decodeSolidsNotes(f.notes).foods))]
    out.push({ key: 'solids', label: 'Solids', value: `${solids.length} meal${solids.length === 1 ? '' : 's'}`, detail: foods.slice(0, 4).join(', ') + (foods.length > 4 ? '…' : '') || 'logged', cat: 'solids' })
  }
  const acts = events.activities.filter((a) => onDay(a.start))
  if (acts.length) {
    const kinds = [...new Set(acts.map((a) => ACTIVITY_LABEL[a.type] ?? a.type))]
    out.push({ key: 'activity', label: 'Activities', value: `${acts.length}`, detail: kinds.join(', '), cat: 'activity' })
  }
  return out
}

// ---- the day's breakdown: everything logged that day, by kind --------------------------------------------

export type DayLogKey = 'feeds' | 'diapers' | 'sleep' | 'pumping' | 'solids' | 'other'
export interface DayLogGroup {
  key: DayLogKey
  title: string
  /** Oldest first: a day is checked from morning to night. */
  items: TimelineItem[]
  /** The longest stretch between two entries of the group on that day (feeds and diapers), for spotting one
   *  that was never logged. */
  longestGap: { seconds: number; from: Date; to: Date } | null
}

const LOG_GROUP: Partial<Record<TimelineItem['kind'], DayLogKey>> = {
  nursing: 'feeds',
  bottle: 'feeds',
  feeding: 'feeds',
  diaper: 'diapers',
  potty: 'diapers',
  sleep: 'sleep',
  pumping: 'pumping',
  solids: 'solids',
}
const LOG_TITLE: Record<DayLogKey, string> = { feeds: 'Feeds', diapers: 'Diapers', sleep: 'Sleep', pumping: 'Pumping', solids: 'Solids', other: 'Everything else' }
const LOG_ORDER: DayLogKey[] = ['feeds', 'diapers', 'sleep', 'pumping', 'solids', 'other']

/**
 * Everything logged on one day (the same window as the tiles and the strip), grouped so a family can check
 * nothing was missed: Feeds, Diapers, Sleep, Pumping, Solids, then everything else, each oldest first. Empty
 * groups are left out, and so are growth measurements (the Day view's rows above already show that day's).
 */
export function dayLog(items: TimelineItem[], day: Date, dayStartHour = 0): DayLogGroup[] {
  const win = dayWindow(day, dayStartHour)
  // Measurements are the rows above it (the day's weight, height, head), so they are not listed twice.
  const inDay = items.filter((t) => t.kind !== 'growth' && t.at >= win.start && t.at < win.end).sort((a, b) => a.at.getTime() - b.at.getTime())
  return LOG_ORDER.map((key) => {
    const list = inDay.filter((t) => (LOG_GROUP[t.kind] ?? 'other') === key)
    let longestGap: DayLogGroup['longestGap'] = null
    if (key === 'feeds' || key === 'diapers') {
      for (let i = 1; i < list.length; i++) {
        const seconds = (list[i].at.getTime() - list[i - 1].at.getTime()) / 1000
        if (!longestGap || seconds > longestGap.seconds) longestGap = { seconds, from: list[i - 1].at, to: list[i].at }
      }
    }
    return { key, title: LOG_TITLE[key], items: list, longestGap }
  }).filter((g) => g.items.length > 0)
}
