/**
 * The report for the pediatrician: everything the visit asks about, over the last N days, in one page that
 * prints or shares as text. Pure: the page only renders what this returns.
 *
 * Growth leads (the latest weight, height and head with the WHO percentile and the change since the one
 * before, and the gain per day in grams against the doctor's goal), then the daily averages with the
 * age-typical band beside each, then a day-by-day table, then temperatures and medicines in the range.
 */
import { addDays, differenceInCalendarDays, format, isSameDay, startOfDay } from 'date-fns'
import type { Child, GrowthEntry, Medication, Temperature } from './api/types'
import { summarizeDay, type EventSets, type GrowthSets } from './events'
import { growthAt, growthChange, growthPercentile } from './reports'
import { asBasis, correctedAgeText, describeWeeks, judgedAge, type AgeFrom } from './preterm'
import { describePercentile, diaperNormFor, feedingNormFor, feverStatus, fToC, sleepNormFor, type Sex } from './science'
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
  key: 'feeds' | 'bottle' | 'nursing' | 'wet' | 'dirty' | 'sleep' | 'naps' | 'pumped' | 'kcal' | 'kcalkg'
  label: string
  value: string
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

export interface DoctorReport {
  child: { name: string; birthDate: string; age: string; sex: Sex | null }
  /** `wholeDays`: the days before today, the ones the averages are taken over. */
  range: { from: Date; to: Date; days: number; wholeDays: number }
  growth: ReportGrowthRow[]
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

export function buildDoctorReport(events: EventSets, growth: GrowthSets | undefined, child: Child, units: UnitPrefs, sex: Sex | null, goal: number | null | undefined, days: number, now: Date = new Date(), goalSince?: string | null, age: AgeFrom = child.birth_date, calories: ReportCalories | null = null): DoctorReport {
  const to = startOfDay(now)
  const from = addDays(to, -(days - 1))
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

  // ---- averages with the age-typical band
  const averages: ReportAverage[] = []
  if (!ctx.expecting) {
    const feedNorm = feedingNormFor(ctx.ageMonths, ctx.dayOfLife)
    const diaperNorm = diaperNormFor(ctx.dayOfLife)
    const sleepNorm = sleepNormFor(ctx.ageMonths)
    const vol = volumeLabel(units.volume)
    const feeds = avgOf(whole, (d) => d.feeds)
    averages.push({ key: 'feeds', label: 'Feeds a day', value: one(feeds.value), typical: ctx.hold ? null : band(feedNorm.feedsPerDay[0], feedNorm.feedsPerDay[1]), loggedDays: feeds.days })
    const bottle = avgOf(whole, (d) => d.bottle)
    if (bottle.days) {
      const typicalDay = !ctx.hold && feedNorm.ozPerDay ? band(Math.round(convertVolume(feedNorm.ozPerDay[0], 'oz', units.volume)), Math.round(convertVolume(feedNorm.ozPerDay[1], 'oz', units.volume)), ` ${vol}`) : null
      averages.push({ key: 'bottle', label: 'By bottle a day', value: formatVolume(bottle.value, units.volume), typical: typicalDay, loggedDays: bottle.days })
    }
    const kcal = avgOf(whole, (d) => d.kcal)
    if (kcal.days) averages.push({ key: 'kcal', label: 'Calories by bottle a day', value: `${Math.round(kcal.value)} kcal`, typical: null, loggedDays: kcal.days })
    const perKg = avgOf(whole, (d) => d.kcalPerKg ?? 0)
    if (perKg.days && calories) averages.push({ key: 'kcalkg', label: calories.goal ? `kcal per kg a day (goal ${calories.goal})` : 'kcal per kg a day', value: String(Math.round(perKg.value)), typical: ctx.hold || ctx.ageMonths >= 6 ? null : band(TYPICAL_KCAL_PER_KG[0], TYPICAL_KCAL_PER_KG[1]), loggedDays: perKg.days })
    const nursing = avgOf(whole, (d) => d.nursingMinutes)
    // A day's total minutes has no band: the science gives minutes a side per feed, which beside a day's
    // total would read as six times over.
    if (nursing.days) averages.push({ key: 'nursing', label: 'Nursing a day', value: `${Math.round(nursing.value)} min`, typical: null, loggedDays: nursing.days })
    const anyDiaper = (d: ReportDay) => d.diaperCount > 0
    const wet = avgOf(whole, (d) => d.wet, anyDiaper)
    averages.push({ key: 'wet', label: 'Wet diapers a day', value: one(wet.value), typical: ctx.hold ? null : band(diaperNorm.wetPerDay[0], diaperNorm.wetPerDay[1]), loggedDays: wet.days })
    const dirty = avgOf(whole, (d) => d.dirty, anyDiaper)
    averages.push({ key: 'dirty', label: 'Dirty diapers a day', value: one(dirty.value), typical: ctx.hold ? null : band(diaperNorm.dirtyPerDay[0], diaperNorm.dirtyPerDay[1]), loggedDays: dirty.days })
    const sleep = avgOf(whole, (d) => d.sleepHours)
    averages.push({ key: 'sleep', label: 'Sleep a day', value: formatDurationShort(sleep.value * 3600), typical: ctx.hold ? null : `${band(sleepNorm.totalHours[0], sleepNorm.totalHours[1])} h`, loggedDays: sleep.days })
    const naps = avgOf(whole, (d) => d.naps, (d) => d.sleepHours > 0)
    if (whole.some((d) => d.naps > 0)) averages.push({ key: 'naps', label: 'Naps a day', value: one(naps.value), typical: ctx.hold ? null : band(sleepNorm.napsPerDay[0], sleepNorm.napsPerDay[1]), loggedDays: naps.days })
    const pumped = avgOf(whole, (d) => d.pumped)
    if (pumped.days) averages.push({ key: 'pumped', label: 'Pumped a day', value: formatVolume(pumped.value, units.volume), typical: null, loggedDays: pumped.days })
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
    range: { from, to, days: differenceInCalendarDays(to, from) + 1, wholeDays: whole.length },
    growth: rows,
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
  lines.push(`${format(r.range.from, 'MMM d')} – ${format(r.range.to, 'MMM d, yyyy')} (${r.range.days} days), from Bramble`)
  if (r.growth.length) {
    lines.push('')
    lines.push('GROWTH')
    for (const g of r.growth) lines.push(`${g.label}: ${g.value} on ${g.date}${g.percentile ? ` · ${g.percentile}` : ''}${g.change ? ` · ${g.change}` : ''}`)
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
  lines.push('')
  lines.push('DAY BY DAY')
  lines.push(`date · feeds · bottle · wet/dirty · sleep · pumped`)
  for (const d of r.days) {
    lines.push(`${format(d.date, 'MMM d')} · ${d.feeds} · ${d.bottle ? formatVolume(d.bottle, r.units.volume) : '–'} · ${d.wet}/${d.dirty} · ${d.sleepHours ? formatDurationShort(d.sleepHours * 3600) : '–'} · ${d.pumped ? formatVolume(d.pumped, r.units.volume) : '–'}`)
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
