import { addDays, format, isSameDay, startOfDay } from 'date-fns'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRightIcon, ClipboardIcon } from '../../components/icons'
import { Segmented } from '../../components/ui/Segmented'
import { usePrefs } from '../../hooks/usePrefs'
import { rangeDays, useChildEvents, useGrowth } from '../../hooks/useEvents'
import type { Child } from '../../lib/api/types'
import { formatAge } from '../../lib/time'
import { RiseBedtime } from './RiseBedtime'
import { useAgeBasis } from '../../hooks/useAgeBasis'
import { useChildSettings } from '../../hooks/useChildSettings'
import { ageHold, holdNote, judgedAge, judgedMonths, normsFrom, whoFrom, type AgeBasis, type AgeHold } from '../../lib/preterm'
import { describePercentile, diaperNormFor, expectedWeightGain, feedingByWeight, feedingNormFor, feverStatus, judgeByWeight, fToC, percentile, sleepNormFor, type GrowthMetric, type Sex } from '../../lib/science'
import { convertLength, convertVolume, convertWeight } from '../../lib/units'
import { ACTIVITY_LABEL } from '../../lib/events'
import { isPotty, summarizeDay, type EventSets } from '../../lib/events'
import type { DiaperChange, Weight } from '../../lib/api/types'
import { parseDate, parseDuration, formatDurationShort } from '../../lib/time'
import { formatLength, formatTemp, formatVolume, formatWeight, volumeLabel } from '../../lib/units'
import { FOOD_BY_LABEL, decodeSolidsNotes, foodsTried } from '../../lib/foods'
import '../log/solids.css'
import { ChartKey, Donut, LineChart, StackedBars, type BarDay, type PointText } from './charts'
import { GrowthAgeChart } from './GrowthAgeChart'
import { About } from '../../components/ui/About'
import { Overview } from './Glance'
import { growthAt, rangeOverview } from '../../lib/reports'
import { growthEntryTime } from '../../lib/growth-note'
import { CAT_OF_GLANCE, type Cat } from './categories'
import { comparePumps, pumpOf } from '../../lib/pumps'
import { SUPPLY_SPAN, supplyTrend, supplyVerdict, supplyWindowLine } from '../../lib/supply'
import { checkDetail, checkRate, checkTally, DAY_TO_DAY_SWING_G, formatGrams, formatPerDay, gainVerdict, MISSES_IN_A_ROW, stepCompares, stepNoiseNote, weekBesideGoal, weightChecks, weightGain } from '../../lib/weight-gain'
import { PumpChart } from './PumpChart'
import { dayCalories, judgeCalories, mlForGoal, TYPICAL_KCAL_PER_KG, weightForDay } from '../../lib/calories'
import { MILK_KCAL_PER_OZ, strengthText, type FortifySettings } from '../../lib/fortify'
import { nicuPumping } from '../../lib/nicu-pumping'
import { averagedDays, clockRange, diaperSplit, fullDayAverage, keepToRange, LB_STEPS, ozRange, ozText, volumeRange, weightTick } from './format'
import '../more/pumps.css'
import './summary.css'

type Span = 7 | 14 | 30 | 90 | 365

/** The milestone sheet's own words for its categories ("motor" was logged as Movement). */
const MILESTONE_CATEGORY: Record<string, string> = { motor: 'Movement', social: 'Social', language: 'Language', cognitive: 'Thinking', feeding: 'Feeding', other: 'Other' }

const CATS: { key: Cat; label: string; filter: string }[] = [
  { key: 'overview', label: 'Overview', filter: '' },
  { key: 'sleep', label: 'Sleep', filter: 'sleep' },
  { key: 'feed', label: 'Feeding', filter: 'feeding' },
  { key: 'solids', label: 'Solids', filter: 'solids' },
  { key: 'diaper', label: 'Diapers', filter: 'diaper' },
  { key: 'pump', label: 'Pumping', filter: 'pumping' },
  { key: 'activity', label: 'Activities', filter: 'activity' },
  { key: 'medicine', label: 'Medicine', filter: 'medicine' },
  { key: 'growth', label: 'Growth', filter: 'growth' },
  { key: 'temperature', label: 'Temperature', filter: 'temperature' },
  { key: 'milestones', label: 'Milestones', filter: 'milestones' },
]

const TEAL = 'var(--teal)'
const TEAL_LIGHT = 'var(--teal-light)'

export function SummaryView({ events, child, now, span, onSpan, filters, cat, onCat, loading = false }: { loading?: boolean; events: EventSets; child: Child; now: Date; span: Span; onSpan: (s: Span) => void; filters: Record<string, boolean>; cat: Cat; onCat: (c: Cat) => void }) {
  const { prefs } = usePrefs()
  const childId = child.id
  const { settings } = useChildSettings(childId)
  // Settings › Born early: corrected age, and no verdicts by age in the NICU or before the due date.
  const age = useAgeBasis(child)
  const ctx = judgedAge(age, now)
  // Feeding reads the latest weight too: how much milk her weight suggests.
  const growth = useGrowth(cat === 'growth' || cat === 'feed' ? childId : null)
  const cats = CATS.filter((c) => !c.filter || filters[c.filter] !== false)
  // A hidden category must not stay selected (its tab is gone).
  const activeCat = cats.some((c) => c.key === cat) ? cat : (cats[0]?.key ?? cat)
  // While a wider range loads, the tabs and pills stay and the numbers wait (never a flash of zeros).
  const shown: Cat | null = loading ? null : activeCat

  const days = Array.from({ length: span }, (_, i) => startOfDay(addDays(now, -(span - 1 - i))))
  const summaries = days.map((d) => summarizeDay(events, d))
  // The events cover more than the range (the Day view may be paged back); lists and counts keep to it.
  const since = days[0].getTime()
  const ranged = keepToRange(events, since)
  // Overview averages count full days only; today joins once it is over (unless it is all there is).
  const today = startOfDay(now).getTime()
  const pastDays = days.filter((d) => d.getTime() < today)
  const anyPast = days.some((d, i) => d.getTime() < today && (summaries[i].sleepSeconds || summaries[i].feedCount || summaries[i].diaperCount || summaries[i].pumpVolume))
  const overviewDays = anyPast ? pastDays : days
  const label = (d: Date) => (span > 30 ? (d.getDate() === 1 ? format(d, 'MMM') : '') : span > 14 ? (d.getDate() % 5 === 1 ? format(d, 'd') : '') : format(d, span === 7 ? 'EEEEE' : 'd'))

  return (
    <div className="stack">
      <nav className="cat-tabs" aria-label="Report category">
        {cats.map((c) => (
          <button key={c.key} type="button" className={c.key === activeCat ? 'cat-tab active' : 'cat-tab'} aria-pressed={c.key === activeCat} onClick={() => onCat(c.key)}>
            {c.label}
          </button>
        ))}
      </nav>

      {activeCat !== 'growth' && activeCat !== 'milestones' ? (
        <div className="range-pills" role="group" aria-label="Range">
          {([7, 14, 30, 90, 365] as Span[]).map((s) => (
            <button key={s} type="button" aria-pressed={span === s} className={span === s ? 'range-pill active' : 'range-pill'} onClick={() => onSpan(s)}>
              {s === 365 ? '1Y' : `${s}D`}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="card card-pad reports-loading" role="status" aria-busy="true">
          Loading…
        </div>
      ) : null}
      {shown === 'overview' ? (
        <>
          <Overview rows={rangeOverview(events, child, prefs.units, overviewDays, now, age)} onOpen={(k) => onCat(CAT_OF_GLANCE[k])} />
          <About label="About these numbers">
            <p>Daily averages over the full days of the range; today joins once it is over.</p>
          </About>
          <Link to="/report" className="card card-pad doctor-link" data-testid="doctor-report-link">
            <span className="icon-circle sm tone-growth" aria-hidden>
              <ClipboardIcon />
            </span>
            <span className="grow">
              <span className="strong">Report for the pediatrician</span>
              <span className="small muted doctor-link-sub">Growth, feeds, diapers and sleep · print to PDF or share</span>
            </span>
            <ChevronRightIcon className="chev" aria-hidden />
          </Link>
        </>
      ) : null}
      {shown === 'sleep' ? (
        <>
          <SleepSummary days={days} summaries={summaries} events={events} label={label} ageMonths={ctx.ageMonths} hold={ctx.hold} now={now} />
          <RiseBedtime sleeps={events.sleep} days={days} now={now} ageMonths={judgedMonths(age, now)} />
        </>
      ) : null}
      {shown === 'solids' ? <SolidsSummary events={ranged} /> : null}
      {shown === 'activity' ? <ActivitySummary days={days} events={ranged} label={label} now={now} /> : null}
      {shown === 'medicine' ? <ListSummary title="Medicine" rows={ranged.medication.map((m) => ({ id: m.id, when: m.time, text: `${m.name} · ${m.dosage} ${m.dosage_unit}` }))} /> : null}
      {shown === 'temperature' ? <TemperatureSummary events={ranged} unit={prefs.units.temp} ageMonths={ctx.ageMonths} /> : null}
      {shown === 'milestones' ? <ListSummary title="Milestones" rows={events.milestones.map((m) => ({ id: m.id, when: m.date, text: `${m.title}${m.category ? ` · ${MILESTONE_CATEGORY[m.category] ?? m.category}` : ''}` }))} /> : null}
      {shown === 'feed' ? <FeedSummary days={days} events={events} label={label} unit={prefs.units.volume} ageMonths={ctx.ageMonths} dayOfLife={ctx.dayOfLife} hold={ctx.hold} now={now} weights={growth.data?.weights ?? []} name={child.first_name} calorieGoal={settings.calorieGoal ?? null} fortify={settings.fortify ?? null} /> : null}
      {shown === 'diaper' ? <DiaperSummary days={days} summaries={summaries} changes={events.changes} label={label} dayOfLife={ctx.dayOfLife} hold={ctx.hold} now={now} /> : null}
      {shown === 'pump' ? <PumpSummary days={days} summaries={summaries} label={label} unit={prefs.units.volume} events={events} child={child} now={now} age={age} /> : null}
      {shown === 'growth' ? <GrowthSummary data={growth.data} loading={growth.isLoading} child={child} sex={settings.sex ?? null} age={age} /> : null}
    </div>
  )
}

function SleepSummary({ days, summaries, events, label, ageMonths, hold, now }: { days: Date[]; summaries: ReturnType<typeof summarizeDay>[]; events: EventSets; label: (d: Date) => string; ageMonths: number; hold: AgeHold; now: Date }) {
  const norm = sleepNormFor(ageMonths)
  const sleepTypical = hold ? holdNote(hold) : `Typical for this age: ${norm.totalHours[0]}–${norm.totalHours[1]}h total, ${norm.napsPerDay[0] === norm.napsPerDay[1] ? norm.napsPerDay[0] : `${norm.napsPerDay[0]}–${norm.napsPerDay[1]}`} nap${norm.napsPerDay[1] === 1 ? '' : 's'} (${norm.napHours[0]}–${norm.napHours[1]}h), bedtime ${clockRange(norm.typicalBedtime)}.`
  const bars: BarDay[] = days.map((d, i) => {
    const napSecs = events.sleep.filter((s) => s.nap && startOfDay(parseDate(s.start)).getTime() === d.getTime()).reduce((sum, s) => sum + parseDuration(s.duration), 0)
    const total = summaries[i].sleepSeconds
    const night = Math.max(0, total - napSecs)
    return { label: label(d), date: d, parts: [{ value: night / 3600, color: TEAL, name: 'Night' }, { value: Math.min(napSecs, total) / 3600, color: TEAL_LIGHT, name: 'Naps' }] }
  })
  // Full days only: today's unfinished night would drag the average down.
  const used = averagedDays(summaries.map((x) => x.sleepSeconds), days, now)
  const avgTotal = used.length ? used.reduce((s, i) => s + summaries[i].sleepSeconds, 0) / used.length : 0
  const avgNap = used.length ? (used.reduce((s, i) => s + bars[i].parts[1].value, 0) * 3600) / used.length : 0
  const avgNight = Math.max(0, avgTotal - avgNap)
  return (
    <section className="card card-pad stack">
      <h3>Sleep trends</h3>
      <div className="row" style={{ gap: 24 }}>
        <div className="legend grow">
          <div className="legend-item">
            <span className="legend-name">
              <i className="legend-dot" style={{ background: TEAL_LIGHT }} /> Nap total avg
            </span>
            <span className="legend-value">{formatDurationShort(avgNap)}</span>
          </div>
          <div className="legend-item">
            <span className="legend-name">
              <i className="legend-dot" style={{ background: TEAL }} /> Night total avg
            </span>
            <span className="legend-value">{formatDurationShort(avgNight)}</span>
          </div>
        </div>
        <Donut segments={[{ value: avgNight, color: TEAL }, { value: avgNap, color: TEAL_LIGHT }]} sub="Daily total avg" label={formatDurationShort(avgTotal)} />
      </div>
      <StackedBars days={bars} unit="hours" formatTick={hoursTick} average={avgTotal / 3600} valueText={(h) => formatDurationShort(h * 3600) || '0m'} />
      <TypicalLine text={sleepTypical} />
    </section>
  )
}

function TypicalLine({ text, low = false, testId }: { text: string | null; /** Under what is typical: an orange edge, not green. */ low?: boolean; testId?: string }) {
  if (!text) return null
  return (
    <p className={low ? 'typical-line is-low' : 'typical-line'} data-testid={testId}>
      {text}
    </p>
  )
}

function FeedSummary({ days, events, label, unit, ageMonths, dayOfLife, hold, now, weights, name, calorieGoal, fortify }: { days: Date[]; events: EventSets; label: (d: Date) => string; unit: 'ml' | 'oz'; ageMonths: number; dayOfLife: number; hold: AgeHold; now: Date; weights: Weight[]; name: string; calorieGoal: number | null; fortify: FortifySettings | null }) {
  const norm = feedingNormFor(ageMonths, dayOfLife)
  const perDay = days.map((d) => {
    const feeds = events.feedings.filter((f) => startOfDay(parseDate(f.start)).getTime() === d.getTime() && f.type !== 'solid food')
    return {
      count: feeds.length,
      bottle: feeds.reduce((s, f) => s + (f.method === 'bottle' ? f.amount ?? 0 : 0), 0),
      nursingMin: feeds.reduce((s, f) => s + (f.method !== 'bottle' ? parseDuration(f.duration) / 60 : 0), 0),
      solids: events.feedings.filter((f) => startOfDay(parseDate(f.start)).getTime() === d.getTime() && f.type === 'solid food').length,
    }
  })
  const used = averagedDays(perDay.map((p) => p.count), days, now)
  const avg = (k: 'count' | 'bottle' | 'nursingMin') => (used.length ? used.reduce((s, i) => s + perDay[i][k], 0) / used.length : 0)
  const { prefs } = usePrefs()
  // Held (the NICU sets the feeds): no amount by weight and no age row, only what was logged.
  const bw = hold ? null : byWeightView({ weights, name, unit, weightUnit: prefs.units.weight, ageMonths, dayOfLife, bottleMl: convertVolume(avg('bottle'), unit, 'ml'), nursing: used.some((i) => perDay[i].nursingMin > 0), feedsPerDay: avg('count'), days: used.length })
  const byWeight = Boolean(bw && 'band' in bw)
  const cal = calorieView({ days, events, unit, weightUnit: prefs.units.weight, weights, now, goal: calorieGoal, fortify, hold, name })
  // The doctor's number leads while calories are being raised; otherwise the calories sit after the feeds.
  const calFirst = Boolean(cal && (calorieGoal || fortify))
  const calTiles = cal ? (
    <>
      <Stat name="Calories / day" value={`${Math.round(cal.kcal)} kcal`} detail={cal.nursing ? 'bottles only' : cal.perFeed ? `about ${Math.round(cal.perFeed)} a bottle` : null} testId="kcal-per-day" />
      {cal.perKg !== null ? <Stat name="kcal / kg / day" value={String(Math.round(cal.perKg))} detail={calorieGoal ? `goal ${calorieGoal}` : hold || ageMonths >= 6 ? null : `typical ${TYPICAL_KCAL_PER_KG[0]}–${TYPICAL_KCAL_PER_KG[1]}`} tone={cal.status === 'under' ? 'missed' : cal.status === 'met' ? 'met' : undefined} testId="kcal-per-kg" /> : null}
    </>
  ) : null
  return (
    <section className="card card-pad stack">
      <h3>Feeding</h3>
      {/* The tiles lead with the bottles beside what her weight suggests: the two numbers a parent sets side by side. */}
      <div className="stat-grid">
        {calFirst ? calTiles : null}
        <Stat name="Bottle / day" value={formatVolume(avg('bottle'), unit) || `0 ${unit}`} />
        {bw && 'band' in bw ? <Stat name={`${name}'s weight suggests`} value={bw.band} detail={`a day · ${bw.weighed}`} testId="by-weight-band" /> : null}
        <Stat name="Feeds / day" value={avg('count').toFixed(1)} detail={bw && 'band' in bw ? `about ${bw.perFeed} a feed` : null} testId="feeds-per-day" />
        {/* Nursing and solids only when there is any: "0m" and "0" on a bottle-fed newborn say nothing. */}
        {perDay.some((p) => p.nursingMin > 0) ? <Stat name="Nursing / day" value={formatDurationShort(avg('nursingMin') * 60)} /> : null}
        {perDay.some((p) => p.solids > 0) ? <Stat name="Solids meals" value={String(perDay.reduce((s, p) => s + p.solids, 0))} /> : null}
        {calFirst ? null : calTiles}
      </div>
      {cal?.verdict ? <TypicalLine text={cal.verdict} low={cal.status === 'under'} testId="kcal-verdict" /> : null}
      {bw && 'band' in bw ? <ByWeightVerdict view={bw} unit={unit} /> : <TypicalLine text={bw && 'note' in bw ? bw.note : null} />}
      <p className="small muted">Feeds per day</p>
      <StackedBars integer days={days.map((d, i) => ({ label: label(d), date: d, parts: [{ value: perDay[i].count, color: 'var(--orange)' }] }))} formatTick={(v) => String(Math.round(v))} valueText={(v) => `${Math.round(v)} feed${Math.round(v) === 1 ? '' : 's'}`} />
      {/* The age row's amount assumes a typical-weight baby; with a weighing, the amount by weight in the tiles replaces it. */}
      <TypicalLine text={hold ? holdNote(hold) : `Typical for this age: ${norm.feedsPerDay[0]}–${norm.feedsPerDay[1]} feeds a day${norm.ozPerDay && !byWeight ? `, about ${ozRange(norm.ozPerDay, unit)} total by bottle` : ''}.`} />
      {cal && cal.perKg !== null ? (
        <>
          <p className="small muted">Calories by bottle (kcal per kg a day)</p>
          <StackedBars days={days.map((d, i) => ({ label: label(d), date: d, parts: [{ value: cal.perKgByDay[i] ?? 0, color: 'var(--orange)' }] }))} formatTick={(v) => String(Math.round(v))} average={cal.perKg} valueText={(v) => `${Math.round(v)} kcal/kg`} />
        </>
      ) : null}
      {perDay.some((p) => p.bottle > 0) ? (
        <>
          <p className="small muted">Bottle volume ({volumeLabel(unit)})</p>
          <StackedBars days={days.map((d, i) => ({ label: label(d), date: d, parts: [{ value: perDay[i].bottle, color: 'var(--orange)' }] }))} formatTick={(v) => String(Math.round(v))} valueText={(v) => formatVolume(v, unit) || `0 ${volumeLabel(unit)}`} />
        </>
      ) : null}
      <About>
        <p>Averages count full days only; today joins once it is over.</p>
        <p>{ozText(norm.notes, unit)}</p>
        <p data-testid="kcal-note">
          Calories count bottles only: breast milk and standard formula at 20 kcal/oz, fortified milk at the strength it was mixed to. Nursing has no volume, so a day with nursing
          is more than this. Breast milk really varies (averages of 18–20 kcal/oz in studies), so the figure is close, not exact. Healthy term babies under 6 months take about
          100–120 kcal per kg a day; the goal, when set in Settings › Calories &amp; fortifying, is the doctor&apos;s.
        </p>
        <p data-testid="by-weight-note">
          By weight: about 150–180 mL per kg a day, which holds the AAP&apos;s rough rule of 2½ oz per pound inside it, and never more than about 32 oz (960 mL). It applies from two weeks to six months. Babies regulate their own intake: the AAP says a baby who is growing, gaining and content is likely taking the right amount, and a breastfed baby can level off around 750–800 mL a day from one to six months whatever they weigh. The weight checks on the Growth card are what settles it.
        </p>
      </About>
    </section>
  )
}

/**
 * How much milk a day her weight suggests (150–180 mL/kg, AAP's 2½ oz a pound inside it, at most 32 oz), and
 * where the bottles logged sit against it. Nursing has no volume, so with any nursing the bottles are shown
 * against the band but not judged: the day's total is more than they say.
 */
interface CalorieView {
  /** Average over full days with bottles, kcal a day. */
  kcal: number
  perFeed: number | null
  /** Average kcal per kg a day (each day by the weighing that applied), null with no weighing. */
  perKg: number | null
  perKgByDay: (number | null)[]
  nursing: boolean
  status: ReturnType<typeof judgeCalories>
  verdict: string | null
}

/** Calories by bottle over the range: a day, a bottle, per kg against the doctor's goal. Null with no bottle volume. */
function calorieView({ days, events, unit, weightUnit, weights, now, goal, fortify, hold, name }: { days: Date[]; events: EventSets; unit: 'ml' | 'oz'; weightUnit: Parameters<typeof formatWeight>[1]; weights: Weight[]; now: Date; goal: number | null; fortify: FortifySettings | null; hold: AgeHold; name: string }): CalorieView | null {
  const byDay = days.map((d) => dayCalories(events.feedings.filter((f) => isSameDay(parseDate(f.start), d)), unit, fortify))
  const used = averagedDays(byDay.map((c) => c.kcal), days, now)
  if (!used.length) return null
  const points = weights.map((w) => ({ kg: convertWeight(w.weight, weightUnit, 'kg'), at: growthAt(w) }))
  const perKgByDay = days.map((d, i) => {
    const kg = weightForDay(points, addDays(d, 1))
    return kg && byDay[i].kcal > 0 ? byDay[i].kcal / kg : null
  })
  const kcal = used.reduce((s, i) => s + byDay[i].kcal, 0) / used.length
  const bottles = used.reduce((s, i) => s + byDay[i].bottles, 0) / used.length
  const kgDays = used.filter((i) => perKgByDay[i] !== null)
  const perKg = kgDays.length ? kgDays.reduce((s, i) => s + (perKgByDay[i] ?? 0), 0) / kgDays.length : null
  const nursing = used.some((i) => byDay[i].nursing)
  const unknown = used.some((i) => byDay[i].unknown)
  const status = perKg !== null ? judgeCalories(perKg, goal, nursing) : null
  const latest = latestWeight(weights)
  const kg = latest ? convertWeight(latest.weight, weightUnit, 'kg') : null
  const strength = fortify?.kcalPerOz ?? MILK_KCAL_PER_OZ
  const vol = (ml: number) => formatVolume(convertVolume(ml, 'ml', unit), unit)
  const parts: string[] = []
  if (goal && perKg !== null && nursing) parts.push(`Nursing is not measured, so bottles alone cannot show whether ${name} reaches the doctor's ${goal} kcal/kg.`)
  else if (status === 'under' && perKg !== null) parts.push(`Bottles give ${Math.round(perKg)} kcal per kg a day, under the doctor's ${goal}.${kg && latest ? ` At ${strengthText(strength)} that goal is about ${vol(mlForGoal(goal!, kg, strength))} a day at ${formatWeight(latest.weight, weightUnit)}.` : ''}`)
  else if (status === 'met' && perKg !== null) parts.push(`Bottles give ${Math.round(perKg)} kcal per kg a day, ${perKg < goal! ? 'close to' : 'on'} the doctor's ${goal}.`)
  else if (perKg === null && goal) parts.push(`Log a weight to see kcal per kg against the doctor's ${goal}.`)
  if (unknown) parts.push('Some fortified bottles have no strength on them and count at 20 kcal/oz; set it in Settings › Calories & fortifying.')
  if (hold && !goal) parts.length = 0
  return { kcal, perFeed: bottles >= 1 ? kcal / bottles : null, perKg, perKgByDay, nursing, status, verdict: parts.join(' ') || null }
}

const latestWeight = (weights: Weight[]): Weight | undefined => [...weights].sort((a, b) => growthAt(b).getTime() - growthAt(a).getTime())[0]

interface ByWeightView {
  /** "395–475 mL", the band a day. */
  band: string
  /** "45–55 mL", a feed at the feeds logged (8 when none). */
  perFeed: string
  /** "5 lb 13 oz on Oct 22": the weighing it comes from. */
  weighed: string
  lo: number
  hi: number
  bottleMl: number
  status: ReturnType<typeof judgeByWeight> | null
  verdict: string | null
}

/** What her weight suggests, for the Feeding tiles; a note before two weeks old, nothing from solids on. */
function byWeightView({ weights, name, unit, weightUnit, ageMonths, dayOfLife, bottleMl, nursing, feedsPerDay, days }: { weights: Weight[]; name: string; unit: 'ml' | 'oz'; weightUnit: Parameters<typeof formatWeight>[1]; ageMonths: number; dayOfLife: number; bottleMl: number; nursing: boolean; feedsPerDay: number; days: number }): ByWeightView | { note: string } | null {
  const latest = latestWeight(weights)
  if (!latest) return null
  const r = feedingByWeight(convertWeight(latest.weight, weightUnit, 'kg'), ageMonths, dayOfLife)
  if (!r.applies) return r.reason === 'solids' ? null : { note: `From two weeks old, ${name}'s weight gives a daily amount; until then intake climbs day by day.` }
  const vol = (ml: number) => formatVolume(convertVolume(ml, 'ml', unit), unit)
  const range = (a: number, b: number) => volumeRange(a, b, unit)
  const [lo, hi] = r.mlPerDay
  const feeds = feedsPerDay >= 1 ? Math.round(feedsPerDay) : 8
  const status = bottleMl > 0 && !nursing && days > 0 ? judgeByWeight(bottleMl, r.mlPerDay) : null
  const verdict =
    status === 'low'
      ? `Bottles average ${vol(bottleMl)} a day, under the ${range(lo, hi)} ${name}'s weight suggests. Worth raising if the weight checks or wet diapers are low too.`
      : status === 'high'
        ? `Bottles average ${vol(bottleMl)} a day, over the ${range(lo, hi)} ${name}'s weight suggests. Usually fine for a content, growing baby who is not spitting up a lot.`
        : status === 'typical'
          ? `Bottles average ${vol(bottleMl)} a day, within what ${name}'s weight suggests.`
          : nursing && bottleMl > 0
            ? `Bottles average ${vol(bottleMl)} a day; nursing is not measured, so the day's total is more than that.`
            : nursing
              ? `Nursing is not measured in mL, so there is nothing to set against this; the weight checks show whether it is enough.`
              : null
  return { band: range(lo, hi), perFeed: range(lo / feeds, hi / feeds), weighed: `${formatWeight(latest.weight, weightUnit)} on ${format(growthAt(latest), 'MMM d')}`, lo, hi, bottleMl, status, verdict }
}

/** Under the tiles: where the bottles sit in the band, and what that means. */
function ByWeightVerdict({ view, unit }: { view: ByWeightView; unit: 'ml' | 'oz' }) {
  const { lo, hi, bottleMl, status } = view
  const top = Math.max(hi * 1.35, bottleMl * 1.1)
  const pct = (ml: number) => `${Math.min(100, (ml / top) * 100)}%`
  return (
    <div className="stack by-weight" data-testid="by-weight">
      {bottleMl > 0 ? (
        <div className="bw-gauge" role="img" aria-label={`Bottles ${formatVolume(convertVolume(bottleMl, 'ml', unit), unit)} a day against ${view.band}`}>
          <span className="bw-band" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
          <span className={`bw-mark is-${status ?? 'open'}`} style={{ left: pct(bottleMl) }} />
        </div>
      ) : null}
      <TypicalLine text={view.verdict} low={status === 'low'} />
    </div>
  )
}

function DiaperSummary({ days, summaries, changes, label, dayOfLife, hold, now }: { days: Date[]; changes: DiaperChange[]; summaries: ReturnType<typeof summarizeDay>[]; label: (d: Date) => string; dayOfLife: number; hold: AgeHold; now: Date }) {
  const norm = diaperNormFor(dayOfLife)
  const avg = fullDayAverage(summaries.map((x) => x.diaperCount), days, now)
  // Wet diapers are the hydration sign: their average against the age's typical count leads the card.
  // Over every day with a diaper logged (a day of only dirty ones counts as zero wet, never drops out).
  const diaperDays = averagedDays(summaries.map((x) => x.diaperCount), days, now)
  const counted = diaperDays.length
  const wetAvg = counted ? diaperDays.reduce((sum, i) => sum + summaries[i].wetCount, 0) / counted : 0
  const [wetLo, wetHi] = norm.wetPerDay
  // One logged day is not a pattern (a day of forgotten diapers would cry wolf): judged from two days on.
  const wetLow = !hold && counted >= 2 && wetAvg < wetLo
  const wetVerdict = hold
    ? counted
      ? `Wet diapers average ${wetAvg.toFixed(1)} a day. ${holdNote(hold)}`
      : null
    : counted === 1
    ? `Wet diapers: ${wetAvg.toFixed(0)} on the one full day logged so far; ${wetLo}–${wetHi} a day is typical at this age.`
    : counted
    ? wetLow
      ? `Wet diapers average ${wetAvg.toFixed(1)} a day, under the ${wetLo}–${wetHi} typical at this age. Offer feeds, and mention it to your pediatrician if it continues.`
      : `Wet diapers average ${wetAvg.toFixed(1)} a day: ${wetAvg > wetHi ? 'more than' : 'within'} the ${wetLo}–${wetHi} typical at this age.`
    : null
  const split = days.map((d) => diaperSplit(changes.filter((c) => !isPotty(c) && isSameDay(parseDate(c.time), d))))
  const n = days.length
  return (
    <section className="card card-pad stack">
      <h3>Diapers</h3>
      <TypicalLine text={wetVerdict} low={wetLow} testId="wet-verdict" />
      <div className="stat-grid">
        <Stat name="Per day" value={avg.toFixed(1)} />
        <Stat name={`Total · ${n} days`} value={String(summaries.reduce((s, x) => s + x.diaperCount, 0))} />
        <Stat name={`Wet · ${n} days`} value={String(summaries.reduce((s, x) => s + x.wetCount, 0))} />
        <Stat name={`Poo · ${n} days`} value={String(summaries.reduce((s, x) => s + x.solidCount, 0))} />
      </div>
      <StackedBars
        integer
        days={days.map((d, i) => ({
          label: label(d),
          date: d,
          parts: [
            { value: split[i].wet, color: 'var(--yellow)', name: 'Wet' },
            { value: split[i].mixed, color: 'var(--orange)', name: 'Wet and poo' },
            { value: split[i].poo, color: 'var(--brown)', name: 'Poo' },
          ],
        }))}
        formatTick={(v) => String(Math.round(v))}
        valueText={(v) => `${Math.round(v)} diaper${Math.round(v) === 1 ? '' : 's'}`}
        partText={(v) => String(Math.round(v))}
      />
      <div className="cal-legend chart-legend" data-testid="diaper-legend">
        <span>
          <i style={{ background: 'var(--yellow)' }} /> Wet
        </span>
        <span>
          <i style={{ background: 'var(--orange)' }} /> Wet and poo
        </span>
        <span>
          <i style={{ background: 'var(--brown)' }} /> Poo
        </span>
      </div>
      {hold ? null : <TypicalLine text={`Typical for this age: ${norm.dirtyPerDay[0]}–${norm.dirtyPerDay[1]} dirty a day.`} />}
      <About>
        <p>{norm.notes}</p>
      </About>
    </section>
  )
}

function PumpSummary({ days, summaries, label, unit, events, child, now, age }: { days: Date[]; summaries: ReturnType<typeof summarizeDay>[]; label: (d: Date) => string; unit: 'ml' | 'oz'; events: EventSets; child: Child; now: Date; age: AgeBasis }) {
  const avg = fullDayAverage(summaries.map((x) => x.pumpVolume), days, now)
  const pumpDays = averagedDays(summaries.map((x) => x.pumpVolume), days, now)
  const since = days[0]?.getTime() ?? 0
  const inRange = events.pumping.filter((p) => parseDate(p.start).getTime() >= since)
  const compared = comparePumps(inRange)
  // The trend always reads the last full week against the one before, whatever range is chosen above:
  // two full weeks plus today (rangeDays counts today as a day, so 14 would cut the earliest day off).
  const dayKey = startOfDay(now).getTime()
  const twoWeeks = useMemo(() => rangeDays(2 * SUPPLY_SPAN + 1, now), [dayKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const recent = useChildEvents(child.id, twoWeeks)
  const trend = useMemo(() => supplyTrend(recent.pumping, unit, now), [recent.pumping, unit, now])
  // In the NICU or before the due date (Settings › Born early): Mom's sessions and volume against what NICU
  // lactation teams aim for, counted from the delivery, in the tiles beside the numbers they are read against.
  const nicu = ageHold(age, now) ? nicuPumping(events.pumping, days, now, child.birth_date, unit) : null
  return (
    <>
      <section className="card card-pad stack supply" data-testid="supply-trend">
        <h3>This week against the week before</h3>
        <dl className="supply-rows">
          <div className="supply-row">
            <dt>Last 7 days</dt>
            <dd>{supplyWindowLine(trend.recent, unit)}</dd>
          </div>
          <div className="supply-row">
            <dt>The 7 before</dt>
            <dd>{supplyWindowLine(trend.prior, unit)}</dd>
          </div>
        </dl>
        <p className={`supply-verdict ${trend.state}`}>{supplyVerdict(trend, unit)}</p>
        <About label="How this is counted">
          <p>Full days only; a day with nothing logged is left out, not counted as zero. Settings › Notifications can warn of three low days in a row.</p>
        </About>
      </section>
      <section className="card card-pad stack">
        <h3>Pumping</h3>
        <div className="stat-grid">
          <Stat name="Volume / day" value={formatVolume(avg, unit) || `0 ${unit}`} detail={nicu?.volumeDetail} tone={nicu?.volumeTone ?? undefined} testId="pump-volume-day" />
          {nicu ? <Stat name="Sessions / day" value={nicu.sessionsPerDay.toFixed(1)} detail={nicu.sessionsDetail} tone={nicu.sessionsTone ?? undefined} testId="pump-sessions-day" /> : null}
          {/* The same full days as the average and as Overview (today joins once it is over), so the two totals agree. */}
          <Stat name={`Total · ${pumpDays.length} day${pumpDays.length === 1 ? '' : 's'}`} value={formatVolume(pumpDays.reduce((s, i) => s + summaries[i].pumpVolume, 0), unit) || `0 ${unit}`} />
        </div>
        <StackedBars days={days.map((d, i) => ({ label: label(d), date: d, parts: [{ value: summaries[i].pumpVolume, color: 'var(--purple)' }] }))} formatTick={(v) => String(Math.round(v))} average={avg || undefined} valueText={(v) => `${formatVolume(v, unit) || `0 ${volumeLabel(unit)}`} pumped`} />
        {avg ? (
          <About>
            <p>The dashed line is the average on full days with pumping. Bars above it are better days.</p>
            {nicu ? (
              <p data-testid="nicu-pump-note">
                For a baby in the NICU, lactation teams aim for 8 or more sessions in 24 hours with one at night, about 500 mL a day by the end of the first week and 750 mL by the end of the second (UW Medicine; Children&apos;s Mercy NICU). In a 2023 study of 427 NICU mothers, 5 or more sessions a day by day 5 was what predicted reaching full volume. After two weeks, 750 mL or more is full supply, 350–500 mL borderline and under 350 mL low. The first two weeks are building, so the volume is never called low then. Counted from the birth, over full days with a session logged.
              </p>
            ) : null}
          </About>
        ) : null}
      </section>
      <section className="card card-pad stack" data-testid="pump-compare">
        <h3>Which pump does best</h3>
        <PumpChart compared={compared} unit={unit} untagged={inRange.filter((p) => !pumpOf(p.tags) && p.amount !== null && p.amount !== undefined)} child={child.id} />
      </section>
    </>
  )
}

function GrowthSummary({ data, loading, child, sex, age }: { data: ReturnType<typeof useGrowth>['data']; loading: boolean; child: Child; sex: Sex | null; age: AgeBasis }) {
  const [metric, setMetric] = useState<'weight' | 'height' | 'head'>('weight')
  const [view, setView] = useState<'recent' | 'age'>('recent')
  const { prefs } = usePrefs()
  const { settings } = useChildSettings(child.id)
  if (loading || !data) return <p className="muted small">Loading growth…</p>
  const unit = prefs.units.weight
  const gainNow = metric === 'weight' ? weightGain(data.weights, unit, age, settings.weightGoalGPerDay, undefined, settings.weightGoalSince) : null
  const verdict = gainNow ? gainVerdict(gainNow, unit) : null
  const perDay = gainNow ? (gainNow.sinceGoal ?? gainNow.week ?? gainNow.sinceLast)?.perDay : undefined
  // A baby born early is on the WHO charts by corrected age: they count from the due date, and a measurement
  // before it has no percentile (Settings › Born early).
  const chartFrom = parseDate(normsFrom(age, new Date()))
  const corrected = chartFrom.getTime() !== parseDate(child.birth_date).getTime()
  const monthsFrom = (from: string, d: Date) => (d.getTime() - parseDate(from).getTime()) / (30.4375 * 86_400_000)
  const whoMetric: GrowthMetric = metric === 'weight' ? 'weight' : metric === 'height' ? 'length' : 'head'
  const toMetricUnit = (v: number) => (metric === 'weight' ? convertWeight(v, unit, 'kg') : convertLength(v, prefs.units.length, 'cm'))
  const fromMetricUnit = (v: number) => (metric === 'weight' ? convertWeight(v, 'kg', unit) : convertLength(v, 'cm', prefs.units.length))
  const nowAge = judgedAge(age, new Date())
  const gainText = nowAge.hold ? holdNote(nowAge.hold) : expectedWeightGain(nowAge.ageMonths).text
  const points =
    metric === 'weight'
      ? data.weights.map((w) => ({ x: growthAt(w), y: w.weight, timed: growthEntryTime(w) !== null }))
      : metric === 'height'
        ? data.heights.map((h) => ({ x: growthAt(h), y: h.height, timed: growthEntryTime(h) !== null }))
        : data.heads.map((h) => ({ x: growthAt(h), y: h.head_circumference, timed: growthEntryTime(h) !== null }))
  points.sort((a, b) => a.x.getTime() - b.x.getTime())
  const fmt = (v: number) => (metric === 'weight' ? formatWeight(v, unit) : formatLength(v, prefs.units.length))
  const formatY = (v: number) => (metric === 'weight' ? weightTick(v, unit) : `${Math.round(v * 10) / 10}`)
  const latest = points[points.length - 1]
  const pctAt = (p: { x: Date; y: number }) => {
    const from = sex ? whoFrom(age, p.x) : null
    return sex && from ? percentile(whoMetric, sex, monthsFrom(from, p.x), toMetricUnit(p.y)) : NaN
  }
  // "below the 1st percentile · below the typical range; worth discussing…": the place in the header, the advice in the fold.
  const [pctShort, pctAdvice] = sex && latest ? describePercentile(pctAt(latest)).split(' · ') : ['', undefined]
  // Each day's weighing is held to the rate from wherever she was at the check before: a slow start is not
  // carried into every later day (the line from the first weighing could never be reached once she was behind).
  const rate = gainNow ? checkRate(gainNow) : null
  const checks = rate && metric === 'weight' ? weightChecks(data.weights, unit, rate.gramsPerDay, gainNow?.goalStart) : []
  const tally = checks.length ? checkTally(checks) : null
  const lastCheck = checks[checks.length - 1] ?? null
  const checkAt = new Map(checks.map((c) => [c.at.getTime(), c]))
  const tones = points.map((p) => {
    const c = checkAt.get(p.x.getTime())
    return c ? (c.met ? ('met' as const) : ('missed' as const)) : null
  })
  const targets = checks.map((c) => ({ from: { x: c.since, y: c.fromY }, to: { x: c.at, y: c.targetY } }))
  // The axis fits the child's own line: a 4 oz gain must read as one, not vanish under a 12 lb 97th percentile.
  const minSpan = metric === 'weight' ? (unit === 'lb' ? 0.5 : 0.25) : prefs.units.length === 'in' ? (metric === 'head' ? 0.5 : 1) : metric === 'head' ? 1 : 2
  const steps = metric === 'weight' && unit === 'lb' ? LB_STEPS : undefined
  const grams = (v: number) => convertWeight(v, unit, 'kg') * 1000
  const valueText = (y: number) => (metric === 'weight' && unit === 'lb' ? `${fmt(y)} · ${Math.round(grams(y)).toLocaleString()} g` : fmt(y))
  const describe = (i: number): PointText => {
    const p = points[i]
    const prev = points[i - 1]
    const when = format(p.x, p.timed ? 'EEE, MMM d · h:mm a' : 'EEE, MMM d')
    const c = checkAt.get(p.x.getTime())
    const check = c ? { text: checkDetail(c), met: c.met } : null
    if (!prev) return { value: valueText(p.y), when, change: null, check }
    const since = isSameDay(prev.x, p.x) && prev.timed ? format(prev.x, 'h:mm a') : format(prev.x, 'MMM d')
    const diff = p.y - prev.y
    const change = metric === 'weight' ? formatGrams(grams(p.y) - grams(prev.y), unit) : `${diff >= 0 ? '+' : '−'}${formatLength(Math.abs(diff), prefs.units.length)}`
    return { value: valueText(p.y), when, change: `${change} since ${since}`, check }
  }
  const describeAge = (i: number): PointText => {
    const p = points[i]
    return { value: valueText(p.y), when: `Age ${formatAge(normsFrom(age, p.x), p.x)}${corrected ? ' corrected' : ''} · ${format(p.x, 'MMM d')}`, change: describePercentile(pctAt(p)).split(' · ')[0] || null }
  }
  const kids = sex === 'male' ? 'boys' : 'girls'
  const noun = metric === 'weight' ? 'weighing' : 'measurement'
  return (
    <section className="card card-pad stack">
      <Segmented label="Growth metric" size="sm" options={[{ value: 'weight', label: 'Weight' }, { value: 'height', label: 'Height' }, { value: 'head', label: 'Head' }]} value={metric} onChange={setMetric} />
      {latest ? (
        <p>
          <span className="strong" style={{ fontSize: 'var(--text-xl)' }}>
            {fmt(latest.y)}
          </span>
          <span className="small muted">
            {' '}
            · {format(latest.x, 'MMM d')}
            {pctShort ? ` · ${pctShort}` : ''}
          </span>
        </p>
      ) : null}
      {points.length ? <Segmented label="Chart" size="sm" options={[{ value: 'recent', label: 'Recent' }, { value: 'age', label: 'Growth chart' }]} value={view} onChange={setView} /> : null}
      {view === 'age' && points.length ? (
        sex ? (
          <>
            <GrowthAgeChart key={metric} points={points} birth={chartFrom} startLabel={corrected ? 'Due' : 'Birth'} sex={sex} metric={whoMetric} fromMetric={fromMetricUnit} formatY={formatY} steps={steps} describe={describeAge} noun={noun} />
            <ChartKey
              items={[
                { label: child.first_name, mark: 'dot', color: 'var(--text-strong)' },
                { label: '25th–75th', mark: 'swatch', color: 'color-mix(in srgb, var(--green) 45%, transparent)' },
                { label: '2nd–98th', mark: 'swatch', color: 'color-mix(in srgb, var(--yellow) 50%, transparent)' },
                { label: 'Outside', mark: 'swatch', color: 'color-mix(in srgb, var(--red) 30%, transparent)' },
              ]}
            />
          </>
        ) : (
          <p className="small muted" data-testid="age-chart-needs-sex">
            Set boy or girl on the Child tab to see the growth chart: the WHO curves differ for boys and girls.
          </p>
        )
      ) : (
        <>
          <LineChart key={metric} points={points} formatY={formatY} color="var(--green)" minSpan={minSpan} steps={steps} describe={describe} noun={noun} targets={targets} tones={tones} />
          {points.length ? (
            <ChartKey
              items={[
                { label: child.first_name, mark: 'line', color: 'var(--green)' },
                ...(checks.length
                  ? [
                      { label: 'Met', mark: 'dot' as const, color: 'var(--green)' },
                      { label: 'Missed', mark: 'dot' as const, color: 'var(--red)' },
                      { label: `${rate!.kind === 'goal' ? 'Goal' : 'Typical'} ${rate!.gramsPerDay} g/day from each check`, mark: 'target' as const },
                    ]
                  : []),
              ]}
            />
          ) : null}
        </>
      )}
      {gainNow && (gainNow.sinceLast || gainNow.week) ? (
        <div className="stack gain" data-testid="weight-gain">
          <div className="stat-grid">
            {lastCheck ? (
              <Stat name="Last check" value={formatGrams(lastCheck.grams, unit)} detail={checkDetail(lastCheck)} tone={lastCheck.met ? 'met' : 'missed'} testId="last-check" />
            ) : gainNow.sinceLast ? (
              <Stat name={`Since ${gainNow.sinceLast.days === 1 ? 'yesterday' : format(gainNow.sinceLast.since, 'MMM d')}`} value={formatGrams(gainNow.sinceLast.grams, unit)} detail={stepCompares(gainNow)} />
            ) : null}
            {tally ? <Stat name="Checks met" value={`${tally.met} of ${tally.of}`} detail={tally.of === 1 ? 'the last check' : `the last ${tally.of} checks`} testId="checks-met" /> : null}
            {gainNow.week && weekBesideGoal(gainNow) && !(gainNow.sinceLast && sameStep(gainNow.sinceLast, gainNow.week)) ? <Stat name={`Last ${gainNow.week.days} days`} value={formatGrams(gainNow.week.grams, unit)} /> : null}
            {/* The verdict line under the tiles already leads with the rate; a Per day tile beside it would say it twice. */}
            {verdict?.includes(formatPerDay(perDay!, unit)) ? null : (
              <Stat name="Per day" value={formatGrams(perDay!, unit)} detail={gainNow.sinceGoal ? `since ${format(gainNow.sinceGoal.start, 'MMM d')} · goal ${gainNow.goal}` : `over ${(gainNow.week ?? gainNow.sinceLast)!.days} days`} />
            )}
          </div>
          {verdict ? <TypicalLine text={verdict} /> : null}
          {/* Three misses in a row is a pattern, not a weighing: the one line here a parent has to act on. */}
          {tally && tally.missedInRow >= MISSES_IN_A_ROW ? (
            <p className="small goal-start-missing" data-testid="checks-alert">
              Under the {rate!.label} at the last {tally.missedInRow} checks in a row. One weighing swings, three in a row is a pattern: worth telling the pediatrician.
            </p>
          ) : null}
          {gainNow.goal !== null && !gainNow.goalStart ? (
            <p className="small goal-start-missing" data-testid="goal-start-missing">
              Every weighing is held to the {gainNow.goal} g/day goal. Set the day the doctor gave it on the Child tab and the days before it are left alone.
            </p>
          ) : null}
        </div>
      ) : metric === 'weight' ? (
        <TypicalLine text={gainText} />
      ) : null}
      <About testId="growth-about">
        <p>Tap a dot, or slide along the chart, to see each {noun}.</p>
        {view === 'recent' && checks.length ? (
          <p data-testid="checks-note">
            Each day&apos;s last weighing is a check. The dashed step starts where {child.first_name} was at the check before and rises at {rate!.kind === 'goal' ? `the doctor's ${rate!.gramsPerDay} g a day` : `${rate!.gramsPerDay} g a day, the low end of typical for this age`}: a dot on or above its end met it (green), below it missed (red). Each check starts again from the last weighing, so a slow start is never carried forward. One weighing can swing ±{DAY_TO_DAY_SWING_G} g with feeds, diapers and the time of day, so a single miss is mostly noise; three in a row is worth raising.
          </p>
        ) : null}
        {/* Without checks (no goal, first two weeks) the step tile stands alone: say what one day is worth. */}
        {view === 'recent' && !checks.length && gainNow?.sinceLast ? <p data-testid="gain-noise">{stepNoiseNote(gainNow)}</p> : null}
        {view === 'age' && sex ? (
          <p data-testid="percentile-note">
            The WHO growth standard for {kids}, the chart CDC and the AAP use from birth to 2 years. Lines: the 2nd, 5th, 10th, 25th, 50th, 75th, 90th, 95th and 98th percentiles. Doctors look closer below the 2nd or above the 98th, and when the dots cross down through lines over several weeks; following one curve matters more than which curve it is. The whole chart runs from birth to 3, 6, 12 or 24 months, like the card at the doctor's. Zoom in fits it to {child.first_name}: from birth to a little past today, as tall as the measurements and the lines either side of them, with the lines further out labelled where they leave the top.
            {pctAdvice ? ` ${pctAdvice.charAt(0).toUpperCase()}${pctAdvice.slice(1)}.` : ''}
          </p>
        ) : null}
        {view === 'age' && sex && corrected ? (
          <p data-testid="corrected-note">
            {child.first_name} was born early, so the chart counts from the due date (corrected age), the way pediatricians plot a preterm baby until two. Measurements before the due date are not on it: the WHO curves start at a term birth, and the NICU uses a preterm chart for those weeks.
          </p>
        ) : null}
        {view === 'recent' ? <p>The view is fitted to the {noun}s so a few ounces show; the Growth chart view puts them on the WHO curves by age.</p> : null}
        {gainNow ? (
          <p>
            {gainNow.goal === null
              ? 'The pediatrician gave a grams-a-day goal? Enter it on the Child tab and every check is held to it.'
              : gainNow.sinceGoal
                ? `Goal set on the Child tab: ${gainNow.goal} g/day from ${format(gainNow.sinceGoal.start, 'MMM d')}. The rate in the line under the tiles runs through every weighing since then, so one heavy or light weighing moves it less.`
                : gainNow.goalStart
                  ? `Goal set on the Child tab: ${gainNow.goal} g/day from ${format(gainNow.goalStart, 'MMM d')}.`
                  : `Goal set on the Child tab: ${gainNow.goal} g/day, with no start day yet.`}
          </p>
        ) : null}
      </About>
    </section>
  )
}

function sameStep(a: { days: number; grams: number }, b: { days: number; grams: number }): boolean {
  return a.days === b.days && Math.round(a.grams) === Math.round(b.grams)
}

/** "45m" under an hour, "1.5h" for fractional hours, "8h" otherwise. */
export function hoursTick(v: number): string {
  if (v === 0) return '0'
  if (v < 1) return `${Math.round(v * 60)}m`
  return Number.isInteger(Math.round(v * 2) / 2) ? `${Math.round(v)}h` : `${(Math.round(v * 2) / 2).toFixed(1)}h`
}

function Stat({ name, value, detail, tone, testId }: { name: string; value: string; /** A small line under the value. */ detail?: string | null; tone?: 'met' | 'missed'; testId?: string }) {
  return (
    <div className={tone ? `stat is-${tone}` : 'stat'} data-testid={testId}>
      <span className="stat-name">{name}</span>
      <span className="stat-value">{value}</span>
      {detail ? <span className="stat-detail">{detail}</span> : null}
    </div>
  )
}


function SolidsSummary({ events }: { events: EventSets }) {
  const solids = events.feedings.filter((f) => f.type === 'solid food')
  const tried = foodsTried(solids.map((f) => f.notes))
  const reactions = solids.map((f) => decodeSolidsNotes(f.notes))
  const loved = new Set(reactions.filter((r) => r.reaction === 'loved').flatMap((r) => r.foods))
  const disliked = new Set(reactions.filter((r) => r.reaction === 'disliked').flatMap((r) => r.foods))
  const allergic = new Set(reactions.filter((r) => r.reaction === 'allergic').flatMap((r) => r.foods))
  return (
    <section className="card card-pad stack">
      <h3>Solids</h3>
      <div className="stat-grid">
        <Stat name="Meals logged" value={String(solids.length)} />
        <Stat name="Foods tried" value={String(tried.length)} />
        <Stat name="Loved" value={String(loved.size)} />
        <Stat name="Reactions" value={String(allergic.size)} />
      </div>
      {tried.length ? (
        <div className="food-selected">
          {tried.map((t) => (
            <span key={t} className={`food-selected-chip static ${allergic.has(t) ? 'text-medicine' : disliked.has(t) ? 'muted' : ''}`}>
              {FOOD_BY_LABEL.get(t)?.emoji ?? '🍽️'} {t}
              {allergic.has(t) ? ' ⚠️' : loved.has(t) ? ' 😍' : ''}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted small">No solids logged yet.</p>
      )}
    </section>
  )
}

function ActivitySummary({ days, events, label, now }: { days: Date[]; events: EventSets; label: (d: Date) => string; now: Date }) {
  const all = [...events.activities.map((a) => ({ start: a.start, end: a.end, type: a.type })), ...events.tummy.map((t) => ({ start: t.start, end: t.end, type: 'tummy' }))]
  const perDay = days.map((d) => all.filter((a) => startOfDay(parseDate(a.start)).getTime() === d.getTime()))
  const minutes = (a: { start: string; end: string | null }) => (a.end ? (parseDate(a.end).getTime() - parseDate(a.start).getTime()) / 60_000 : 0)
  const byType = new Map<string, number>()
  for (const a of all) byType.set(a.type, (byType.get(a.type) ?? 0) + 1)
  return (
    <section className="card card-pad stack">
      <h3>Activities</h3>
      <div className="stat-grid">
        <Stat name="Sessions" value={String(all.length)} />
        <Stat name="Tummy time / day" value={`${Math.round(fullDayAverage(perDay.map((list) => list.filter((a) => a.type === 'tummy').reduce((x, a) => x + minutes(a), 0)), days, now))}m`} />
      </div>
      <StackedBars integer days={days.map((d, i) => ({ label: label(d), date: d, parts: [{ value: perDay[i].length, color: 'var(--lime)' }] }))} formatTick={(v) => String(Math.round(v))} valueText={(v) => `${Math.round(v)} activit${Math.round(v) === 1 ? 'y' : 'ies'}`} />
      <div className="food-selected">
        {[...byType.entries()].map(([t, n]) => (
          <span key={t} className="food-selected-chip static">
            {ACTIVITY_LABEL[t] ?? (t === 'tummy' ? 'Tummy time' : t)} · {n}
          </span>
        ))}
      </div>
    </section>
  )
}

function TemperatureSummary({ events, unit, ageMonths }: { events: EventSets; unit: 'c' | 'f'; ageMonths: number }) {
  const pts = [...events.temperature].sort((a, b) => parseDate(a.time).getTime() - parseDate(b.time).getTime()).map((t) => ({ x: parseDate(t.time), y: t.temperature }))
  const feverAt = unit === 'f' ? 100.4 : 38
  const latest = pts[pts.length - 1]
  const status = latest ? feverStatus(unit === 'f' ? fToC(latest.y) : latest.y, ageMonths) : null
  return (
    <section className="card card-pad stack">
      <h3>Temperature</h3>
      <div className="stat-grid">
        <Stat name="Readings" value={String(pts.length)} />
        <Stat name="Highest" value={pts.length ? formatTemp(Math.max(...pts.map((p) => p.y)), unit) : '—'} />
        <Stat name="Fever readings" value={String(pts.filter((p) => p.y >= feverAt).length)} />
      </div>
      <LineChart points={pts} formatY={(v) => v.toFixed(1)} color="var(--coral)" />
      {status ? <TypicalLine text={`Latest reading: ${status.text}`} /> : null}
      <About>
        <p>Fever is 38 °C / 100.4 °F or higher{ageMonths < 3 ? '; under 3 months any fever needs a same-day call' : ''}.</p>
      </About>
    </section>
  )
}

function ListSummary({ title, rows }: { title: string; rows: { id: number; when: string; text: string }[] }) {
  const sorted = [...rows].sort((a, b) => parseDate(b.when).getTime() - parseDate(a.when).getTime())
  return (
    <section className="card card-pad stack">
      <h3>{title}</h3>
      {sorted.length === 0 ? <p className="muted small">Nothing logged in this period.</p> : null}
      <ul className="plain-list">
        {sorted.map((r) => (
          <li key={r.id} className="plain-row">
            <span className="muted small" style={{ minWidth: 88 }}>
              {format(parseDate(r.when), r.when.length > 10 ? 'MMM d, h:mm a' : 'MMM d, yyyy')}
            </span>
            <span className="strong">{r.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
