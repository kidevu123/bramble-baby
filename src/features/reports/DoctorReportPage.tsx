import { addDays, differenceInCalendarDays, endOfDay, format, parseISO, startOfDay } from 'date-fns'
import { useMemo, useState } from 'react'
import { TopBar } from '../../components/nav/TopBar'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Field'
import { useChildren } from '../../hooks/useChildren'
import { useChildSettings } from '../../hooks/useChildSettings'
import { useChildEvents, useGrowth } from '../../hooks/useEvents'
import { useNow } from '../../hooks/useNow'
import { usePrefs } from '../../hooks/usePrefs'
import { buildDoctorReport, MAX_VISIT_DAYS, reportText, type DoctorReport, type ReportAverage, type ReportWindow } from '../../lib/doctor-report'
import { ageBasis } from '../../lib/preterm'
import { calorieTracking } from '../../lib/calories'
import { formatDurationShort } from '../../lib/time'
import { formatVolume } from '../../lib/units'
import { LB_STEPS, weightTick } from './format'
import { ReportIntakeChart, ReportWeightChart } from './ReportCharts'
import './summary.css'
import './report.css'

/** Without a last visit on record, the report covers the last two weeks. */
const DEFAULT_DAYS = 14

/**
 * The report for the pediatrician: one page, from the last visit to this one, that prints (iOS: Print, then pinch
 * the preview to save a PDF) or shares as plain text into a message or a patient portal. Growth with the weight
 * chart against the WHO curves and the doctor's goal, feeding with the bottles a day, diapers and sleep, the weeks
 * side by side, fevers and medicines. The two visit dates are typed here and remembered for the child.
 * Reached from Reports › Summary › Overview; Back returns there.
 */
export function DoctorReportPage() {
  const { child } = useChildren()
  const { prefs } = usePrefs()
  const { settings, update } = useChildSettings(child?.id ?? null)
  const [status, setStatus] = useState<string | null>(null)
  const now = useNow(60_000)
  const todayKey = format(now, 'yyyy-MM-dd')
  const lastVisit = settings.visits?.last ?? ''
  const thisVisit = settings.visits?.this ?? todayKey
  const win: ReportWindow = useMemo(() => (lastVisit ? { lastVisit: parseISO(lastVisit), thisVisit: parseISO(thisVisit) } : DEFAULT_DAYS), [lastVisit, thisVisit])
  // The events read from the window's start to now (the report clips the window itself; the read is capped like it).
  const range = useMemo(() => {
    const today = startOfDay(now)
    const from = typeof win === 'number' ? addDays(today, -(win - 1)) : addDays(today, -Math.min(MAX_VISIT_DAYS - 1, Math.max(0, differenceInCalendarDays(today, startOfDay(win.lastVisit)))))
    return { from, to: endOfDay(now) }
  }, [win, todayKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const events = useChildEvents(child?.id ?? null, range)
  const growth = useGrowth(child?.id ?? null)
  const { bornAtDays, nicu } = settings
  const report = useMemo(
    () => (child ? buildDoctorReport(events, growth.data, child, prefs.units, settings.sex ?? null, settings.weightGoalGPerDay, win, now, settings.weightGoalSince, ageBasis(child, { bornAtDays, nicu }), calorieTracking(settings)) : null),
    [events, growth.data, child, prefs.units, settings.sex, settings.weightGoalGPerDay, settings.weightGoalSince, settings, bornAtDays, nicu, win, now],
  )
  if (!child || !report) return null
  const text = reportText(report)
  const vol = prefs.units.volume
  const wUnit = prefs.units.weight

  const setVisits = (patch: { last?: string | null; this?: string | null }) => update((latest) => ({ visits: { ...(latest.visits ?? {}), ...patch } }))

  async function share() {
    setStatus(null)
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: `${child!.first_name}: report for the pediatrician`, text })
        return
      }
      await navigator.clipboard.writeText(text)
      setStatus('Copied as text. Paste it into a message or the patient portal.')
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return
      setStatus('Could not share. Press and hold the report below to select and copy it.')
    }
  }

  const avg = (key: ReportAverage['key']) => report!.averages.find((a) => a.key === key) ?? null
  const typicalNote = (a: ReportAverage | null) => (a ? [a.typical ? `typical ${a.typical}` : null, a.loggedDays < report!.range.wholeDays ? `${a.loggedDays} of ${report!.range.wholeDays} days logged` : null].filter(Boolean).join(' · ') : '')
  const weight = report.growth.find((g) => g.key === 'weight') ?? null
  const length = report.growth.find((g) => g.key === 'height') ?? null
  const head = report.growth.find((g) => g.key === 'head') ?? null
  const feeds = avg('feeds')
  const bottle = avg('bottle')
  const kcalKg = avg('kcalkg')
  const nursing = avg('nursing')
  const wet = avg('wet')
  const dirty = avg('dirty')
  const sleep = avg('sleep')
  const naps = avg('naps')
  const pumped = avg('pumped')
  const bottleDays = report.days.filter((d) => d.date < startOfDay(now))
  const intakeDays = bottleDays.length >= 2 ? bottleDays : report.days
  const byWeek = report.weeks.length > 2
  const g = report.visitGain
  const gainLow = g?.vsGoal?.includes('short') ?? false
  const kcalLow = Boolean(kcalKg && report.averages.length && settings.calorieGoal && Number(kcalKg.value) < settings.calorieGoal * 0.95)

  return (
    <>
      <TopBar title="Pediatrician report" back right="none" />
      <main className="page stack report-page">
        <div className="report-actions stack">
          {/* The visit dates are the report's range: from the last visit to this one. Remembered for the child. */}
          <div className="report-visits">
            <TextField label="Last visit" type="date" value={lastVisit} max={todayKey} onChange={(e) => setVisits({ last: e.target.value || null })} />
            <TextField label="This visit" type="date" value={thisVisit} min={lastVisit || undefined} onChange={(e) => setVisits({ this: e.target.value || null })} />
          </div>
          <p className="xs muted" style={{ margin: 0 }}>
            {lastVisit ? `The report covers the visit on ${format(parseISO(lastVisit), 'MMM d')} to ${report.range.to.getTime() < startOfDay(parseISO(thisVisit)).getTime() ? 'today' : format(report.range.to, 'MMM d')}.` : `No last visit on record: the report covers the last ${DEFAULT_DAYS} days. Set the date of the last visit to cover everything since it.`}
            {' '}On iPhone, Print opens a preview: pinch it open to share it as a PDF.
          </p>
          <div className="row">
            <Button variant="primary" block onClick={() => window.print()}>
              Print or PDF
            </Button>
            <Button variant="secondary" block onClick={() => void share()}>
              Share as text
            </Button>
          </div>
          {status ? (
            <p className="small" role="status">
              {status}
            </p>
          ) : null}
        </div>

        <article className="report card card-pad" aria-label="Report for the pediatrician">
          <header className="report-head">
            <h1 className="report-title">{report.child.name}</h1>
            <p className="report-kicker">{report.range.visit ? `Pediatrician visit · ${format(report.range.visit.this, 'MMMM d, yyyy')}` : `Pediatrician report · ${format(now, 'MMMM d, yyyy')}`}</p>
            <p className="report-sub">
              born {report.child.birthDate} · {report.child.age}
              {report.child.sex ? ` · ${report.child.sex === 'male' ? 'boy' : 'girl'}` : ''}
            </p>
            <p className="report-sub">
              {report.range.visit ? `Since the last visit on ${format(report.range.visit.last, 'MMM d')}: ` : ''}
              {format(report.range.from, 'MMM d')} – {format(report.range.to, 'MMM d, yyyy')} · {report.range.days} days
            </p>
          </header>

          <div className="report-grid">
            <section className="report-section" data-testid="report-growth">
              <h2>Growth</h2>
              {report.chart ? (
                <figure className="report-chart">
                  <ReportWeightChart chart={report.chart} formatY={(v) => weightTick(v, wUnit)} steps={wUnit === 'lb' ? LB_STEPS : undefined} />
                  <figcaption className="report-note">
                    Weight
                    {report.chart.goal ? ` · dashed: the doctor's ${report.chart.goal.gramsPerDay} g/day from the first weighing` : ''}
                    {report.chart.curves.length ? ' · grey: WHO 2nd, 50th and 98th percentiles' : ''}
                  </figcaption>
                </figure>
              ) : null}
              <dl className="report-stats">
                {weight ? <Stat label="Weight" value={weight.value} note={[weight.date, weight.percentile].filter(Boolean).join(' · ')} /> : null}
                {g ? (
                  <Stat label="Since last visit" value={`${g.grams >= 0 ? '+' : ''}${g.grams} g`} note={`${g.perDay} g/day over ${g.days} days${g.vsGoal ? ` · ${g.vsGoal}` : ''}`} low={gainLow} />
                ) : report.gain ? (
                  <Stat label="Gain" value={report.gain.perDay ?? '–'} note={report.gain.verdict ?? report.gain.week ?? report.gain.sinceLast ?? ''} />
                ) : null}
                {length ? <Stat label="Length" value={length.value} note={[length.date, length.percentile, length.change].filter(Boolean).join(' · ')} /> : null}
                {head ? <Stat label="Head" value={head.value} note={[head.date, head.percentile, head.change].filter(Boolean).join(' · ')} /> : null}
                {!weight && !length && !head ? <Stat label="Weight" value="–" note="No measurements logged" /> : null}
              </dl>
            </section>

            <section className="report-section" data-testid="report-feeding">
              <h2>Feeding</h2>
              {intakeDays.length >= 2 && intakeDays.some((d) => d.bottle > 0) ? (
                <figure className="report-chart">
                  <ReportIntakeChart days={intakeDays} average={bottle ? intakeDays.filter((d) => d.bottle > 0).reduce((s, d) => s + d.bottle, 0) / Math.max(1, intakeDays.filter((d) => d.bottle > 0).length) : 0} formatY={(v) => formatVolume(v, vol)} label="Bottles a day" />
                  <figcaption className="report-note">By bottle, each day · dashed: the average over the days with bottles</figcaption>
                </figure>
              ) : null}
              <dl className="report-stats">
                <Stat label="Feeds a day" value={feeds?.value ?? '–'} note={typicalNote(feeds)} />
                {bottle ? <Stat label="By bottle a day" value={bottle.value} note={typicalNote(bottle)} /> : null}
                {kcalKg ? <Stat label="kcal per kg a day" value={kcalKg.value} note={[settings.calorieGoal ? `goal ${settings.calorieGoal}` : null, kcalKg.typical ? `typical ${kcalKg.typical}` : null].filter(Boolean).join(' · ')} low={kcalLow} /> : null}
                {nursing ? <Stat label="Nursing a day" value={nursing.value} note={typicalNote(nursing)} /> : null}
              </dl>
            </section>

            <section className="report-section" data-testid="report-diapers">
              <h2>Diapers &amp; sleep</h2>
              <dl className="report-stats">
                <Stat label="Wet diapers a day" value={wet?.value ?? '–'} note={typicalNote(wet)} />
                <Stat label="Dirty diapers a day" value={dirty?.value ?? '–'} note={typicalNote(dirty)} />
                <Stat label="Sleep a day" value={sleep?.value ?? '–'} note={typicalNote(sleep)} />
                {naps ? <Stat label="Naps a day" value={naps.value} note={typicalNote(naps)} /> : null}
                {pumped ? <Stat label="Pumped a day" value={pumped.value} note={typicalNote(pumped)} /> : null}
              </dl>
            </section>

            <section className="report-section" data-testid="report-health">
              <h2>Fevers &amp; medicines</h2>
              {report.temperatures.length || report.medicines.length ? (
                <ul className="report-list">
                  {report.temperatures.map((t, i) => (
                    <li key={`t${i}`} data-testid="report-temp">
                      {format(t.at, 'MMM d, h:mm a')} · <span className="strong">{t.value}</span> · {t.level}
                    </li>
                  ))}
                  {report.medicines.map((m, i) => (
                    <li key={`m${i}`} data-testid="report-med">
                      {format(m.at, 'MMM d, h:mm a')} · <span className="strong">{m.name}</span>
                      {m.dose ? ` ${m.dose}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="report-note">No temperatures or medicines logged in this period.</p>
              )}
            </section>

            {byWeek ? (
              <section className="report-section report-wide" data-testid="report-weeks">
                <h2>Week by week</h2>
                <div className="report-days-scroll">
                  <table className="report-table report-days">
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th>Feeds/day</th>
                        <th>Bottle/day</th>
                        {report.weeks.some((w) => w.kcalPerKg !== null) ? <th>kcal/kg</th> : null}
                        <th>Wet/dirty</th>
                        <th>Sleep</th>
                        {report.weeks.some((w) => w.pumped > 0) ? <th>Pumped</th> : null}
                        <th>Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.weeks.map((w) => (
                        <tr key={w.from.toISOString()}>
                          <th scope="row">
                            {format(w.from, 'MMM d')}–{format(w.to, 'MMM d')}
                          </th>
                          <td>{w.loggedDays ? oneDecimal(w.feeds) : '–'}</td>
                          <td>{w.bottle ? formatVolume(w.bottle, vol) : '–'}</td>
                          {report.weeks.some((x) => x.kcalPerKg !== null) ? <td>{w.kcalPerKg ? Math.round(w.kcalPerKg) : '–'}</td> : null}
                          <td>{w.loggedDays ? `${oneDecimal(w.wet)} / ${oneDecimal(w.dirty)}` : '–'}</td>
                          <td>{w.sleepHours ? formatDurationShort(w.sleepHours * 3600) : '–'}</td>
                          {report.weeks.some((x) => x.pumped > 0) ? <td>{w.pumped ? formatVolume(w.pumped, vol) : '–'}</td> : null}
                          <td>{w.weight ? `${w.weight.value} (${format(w.weight.at, 'MMM d')})` : '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : (
              <section className="report-section report-wide" data-testid="report-days">
                <h2>Day by day</h2>
                <DayTable report={report} vol={vol} />
              </section>
            )}
          </div>

          <p className="report-foot">
            Averages are over the {report.range.wholeDays} full days before today, over the days each kind was logged. Logged by the family in Bramble; generated {format(now, 'MMM d, yyyy, h:mm a')}.
          </p>
        </article>
      </main>
    </>
  )
}

const oneDecimal = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

function Stat({ label, value, note, low = false }: { label: string; value: string; note: string; low?: boolean }) {
  return (
    <div className={low ? 'report-stat is-low' : 'report-stat'}>
      <dt>{label}</dt>
      <dd>
        {value}
        {note ? <span className="report-note">{note}</span> : null}
      </dd>
    </div>
  )
}

/** One row per day: for a short window (two weeks or less), where the weeks would be one or two rows. */
function DayTable({ report, vol }: { report: DoctorReport; vol: 'ml' | 'oz' }) {
  const kcalCol = report.days.some((d) => d.kcalPerKg !== null)
  return (
    <div className="report-days-scroll">
      <table className="report-table report-days">
        <thead>
          <tr>
            <th>Date</th>
            <th>Feeds</th>
            <th>Bottle</th>
            {kcalCol ? <th>kcal/kg</th> : null}
            <th>Wet/dirty</th>
            <th>Sleep</th>
            <th>Pumped</th>
          </tr>
        </thead>
        <tbody>
          {report.days.map((d) => (
            <tr key={d.date.toISOString()}>
              <th scope="row">{format(d.date, 'EEE MMM d')}</th>
              <td>{d.feeds || '–'}</td>
              <td>{d.bottle ? formatVolume(d.bottle, vol) : '–'}</td>
              {kcalCol ? <td>{d.kcalPerKg ? Math.round(d.kcalPerKg) : '–'}</td> : null}
              <td>
                {d.wet} / {d.dirty}
              </td>
              <td>{d.sleepHours ? formatDurationShort(d.sleepHours * 3600) : '–'}</td>
              <td>{d.pumped ? formatVolume(d.pumped, vol) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
