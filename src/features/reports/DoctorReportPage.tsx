import { addDays, differenceInCalendarDays, endOfDay, format, parseISO, startOfDay } from 'date-fns'
import { useEffect, useMemo, useRef, useState } from 'react'
import { TopBar } from '../../components/nav/TopBar'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Field'
import { useChildren } from '../../hooks/useChildren'
import { useChildSettings } from '../../hooks/useChildSettings'
import { useChildEvents, useGrowth } from '../../hooks/useEvents'
import { useNow } from '../../hooks/useNow'
import { usePrefs } from '../../hooks/usePrefs'
import { buildDoctorReport, MAX_VISIT_DAYS, reportText, type ReportAverage, type ReportWindow } from '../../lib/doctor-report'
import { ageBasis, judgedMonths } from '../../lib/preterm'
import { calorieTracking } from '../../lib/calories'
import { isStandalone } from '../../lib/push'
import { deliverPdf, loadPaperFonts, reportToPdf } from '../../lib/report-pdf'
import { formatDurationShort } from '../../lib/time'
import { convertVolume, convertWeight, formatVolume } from '../../lib/units'
import { checklistsFor, checkpointProgress, loggedByTitle } from '../../lib/milestones'
import { useLoggedMilestones } from '../../hooks/useCompanionEvents'
import { LB_STEPS, weightTick } from './format'
import { RangeBar, ReportIntakeChart, ReportPattern, ReportWeightChart } from './ReportCharts'
import './summary.css'
import './report.css'

/** Without a last visit on record, the report covers the last two weeks. */
const DEFAULT_DAYS = 14

/**
 * The report for the pediatrician: one page, from the last visit to this one, saved as a PDF (drawn in the app and
 * handed to the share sheet: a Home Screen app on iOS has no print dialog, so `window.print()` is only offered in a
 * browser) or shared as plain text into a message or a patient portal. Growth with the weight
 * chart against the WHO curves and the doctor's goal, feeding with the bottles a day, diapers and sleep, the weeks
 * side by side, fevers and medicines. The two visit dates are typed here and remembered for the child.
 * Reached from Reports › Summary › Overview; Back returns there.
 */
export function DoctorReportPage() {
  const { child } = useChildren()
  const { prefs } = usePrefs()
  const { settings, update } = useChildSettings(child?.id ?? null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [paper, setPaper] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const articleRef = useRef<HTMLElement>(null)
  // While the browser prints, the article wears the paper layout (the PDF draws an off-screen copy wearing it).
  useEffect(() => {
    const on = () => setPaper(true)
    const off = () => setPaper(false)
    window.addEventListener('beforeprint', on)
    window.addEventListener('afterprint', off)
    const mq = window.matchMedia?.('print')
    const onMq = (e: MediaQueryListEvent) => setPaper(e.matches)
    mq?.addEventListener?.('change', onMq)
    return () => {
      window.removeEventListener('beforeprint', on)
      window.removeEventListener('afterprint', off)
      mq?.removeEventListener?.('change', onMq)
    }
  }, [])
  // The paper is set in Inter: fetch it when the page opens, so a print or a PDF does not start with a fallback font.
  useEffect(() => {
    void loadPaperFonts()
  }, [])
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
  const loggedMilestones = useLoggedMilestones(child?.id ?? null)
  const { bornAtDays, nicu } = settings
  const report = useMemo(
    () => (child ? buildDoctorReport(events, growth.data, child, prefs.units, settings.sex ?? null, settings.weightGoalGPerDay, win, now, settings.weightGoalSince, ageBasis(child, { bornAtDays, nicu }), calorieTracking(settings)) : null),
    [events, growth.data, child, prefs.units, settings.sex, settings.weightGoalGPerDay, settings.weightGoalSince, settings, bornAtDays, nicu, win, now],
  )
  if (!child || !report) return null
  const text = reportText(report)
  const vol = prefs.units.volume
  const wUnit = prefs.units.weight

  const setVisits = (patch: { last?: string | null; this?: string | null; questions?: string | null }) => update((latest) => ({ visits: { ...(latest.visits ?? {}), ...patch } }))

  async function savePdf() {
    if (!articleRef.current || busy) return
    setStatus(null)
    setBusy(true)
    try {
      const title = `${child!.first_name}: pediatrician report, ${format(report!.range.to, 'MMM d, yyyy')}`
      const blob = await reportToPdf(articleRef.current, title)
      const how = await deliverPdf(blob, `${child!.first_name.toLowerCase()}-pediatrician-${format(report!.range.to, 'yyyy-MM-dd')}.pdf`, title)
      setStatus(how === 'shared' ? null : 'The PDF was downloaded.')
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return
      setStatus('Could not make the PDF. Share as text instead, or open the report in Safari and print from there.')
    } finally {
      setBusy(false)
    }
  }

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
  const g = report.visitGain
  const gainLow = g?.vsGoal?.includes('short') ?? false
  const kcalLow = Boolean(kcalKg && report.averages.length && settings.calorieGoal && Number(kcalKg.value) < settings.calorieGoal * 0.95)
  const mlkg = avg('mlkg')
  // Under its age-typical range (never said while held: the report carries no range then).
  const below = (a: ReportAverage | null) => Boolean(a && a.band && a.loggedDays > 0 && a.num < a.band[0])
  const basis = ageBasis(child, { bornAtDays, nicu })
  const loggedDays = report.days.filter((d) => d.date < startOfDay(now) && (d.feeds > 0 || d.diaperCount > 0 || d.sleepHours > 0 || d.pumped > 0)).length
  const withBottles = intakeDays.filter((d) => d.bottle > 0)
  const bottleAvg = bottle && withBottles.length ? withBottles.reduce((sum, d) => sum + d.bottle, 0) / withBottles.length : 0
  // What her latest weight suggests a day (150–180 mL/kg), as a band behind the bars: only where that range applies.
  const lastWeight = report.chart?.weights.length ? report.chart.weights[report.chart.weights.length - 1].value : null
  const kg = lastWeight === null ? null : convertWeight(lastWeight, wUnit, 'kg')
  const target: [number, number] | null = mlkg?.band && kg ? [convertVolume(mlkg.band[0] * kg, 'ml', vol), convertVolume(mlkg.band[1] * kg, 'ml', vol)] : null
  // The headline row: the six figures a visit starts from, each against its range or goal where it has one.
  const gainPerDay = g ? g.perDay : null
  const kpis: { id: string; label: string; value: string; num: number; band: [number, number] | null; goal?: number | null; note: string; flag: boolean }[] = [
    { id: 'weight', label: 'Weight', value: weight?.value ?? '–', num: 0, band: null, note: weight ? [pct(weight.percentile), weight.date.replace(/, \d{4}$/, '')].filter(Boolean).join(' · ') : 'no weighing yet', flag: false },
    {
      id: 'gain',
      label: 'Gain per day',
      value: gainPerDay !== null ? `${gainPerDay >= 0 ? '+' : '−'}${Math.abs(gainPerDay)} g` : (report.gain?.perDay ?? '–'),
      num: gainPerDay ?? 0,
      band: null,
      goal: gainPerDay !== null ? (settings.weightGoalGPerDay ?? null) : null,
      note: g ? (settings.weightGoalGPerDay ? `goal ${settings.weightGoalGPerDay} g · ${Math.round(g.days)} days` : `over ${Math.round(g.days)} days`) : report.gain ? 'latest weighings' : 'needs two weighings',
      flag: gainLow,
    },
    mlkg
      ? { id: 'intake', label: 'Intake per kg', value: `${Math.round(mlkg.num)} mL`, num: mlkg.num, band: mlkg.band, note: mlkg.band ? 'typical 150–180 a day' : 'a day, by bottle', flag: below(mlkg) }
      : { id: 'intake', label: 'By bottle', value: bottle?.value ?? '–', num: bottle?.num ?? 0, band: bottle?.band ?? null, note: bottle?.typical ? `typical ${bottle.typical} a day` : 'a day', flag: false },
    { id: 'feeds', label: 'Feeds', value: feeds?.value ?? '–', num: feeds?.num ?? 0, band: feeds?.band ?? null, note: feeds?.typical ? `typical ${feeds.typical} a day` : 'a day', flag: below(feeds) },
    { id: 'wet', label: 'Wet diapers', value: wet?.value ?? '–', num: wet?.num ?? 0, band: wet?.band ?? null, note: wet?.typical ? `typical ${wet.typical} a day` : 'a day', flag: below(wet) },
    { id: 'sleep', label: 'Sleep', value: sleep?.value ?? '–', num: sleep?.num ?? 0, band: sleep?.band ?? null, note: sleep?.typical ? `typical ${sleep.typical} a day` : 'a day', flag: false },
  ]
  // Medicines by name: a daily vitamin is one line with its count, not thirty.
  const medicines = [...report.medicines.reduce((map, m) => map.set(m.name, { name: m.name, dose: m.dose, count: (map.get(m.name)?.count ?? 0) + 1, last: m.at }), new Map<string, { name: string; dose: string; count: number; last: Date }>()).values()]
  // Development: CDC's list for her age as the family has marked it, and what was first seen since the last visit.
  const months = judgedMonths(basis, now)
  // The list her age has reached; before the first one (a 2-month visit often falls at 8 weeks), the one coming.
  const lists = checklistsFor(months)
  const list = lists.due ?? lists.next
  const progress = list ? checkpointProgress(list, loggedByTitle(loggedMilestones)) : null
  const sinceVisit = loggedMilestones
    .filter((m) => m.date >= format(report.range.from, 'yyyy-MM-dd') && m.date <= format(report.range.to, 'yyyy-MM-dd'))
    .sort((x, y) => x.date.localeCompare(y.date))
    .map((m) => m.title)
  const checklist = list && progress ? { list, seen: progress.seen, total: progress.total, since: sinceVisit.slice(0, 3), open: progress.missing.slice(0, 3).map((i) => i.text) } : null
  // Typed here, saved when the field is left (not on every key), and printed as typed.
  const questions = draft ?? settings.visits?.questions ?? ''

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
            {' '}Save PDF opens the share sheet: print it, AirDrop or mail it to the office, or save it to Files.
          </p>
          <label className="report-questions-field">
            <span className="field-label">Questions for the doctor</span>
            <textarea className="text-input text-area" rows={2} value={questions} placeholder="Printed in a box at the foot of the report" onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== null && setVisits({ questions: draft.trim() || null })} />
          </label>
          <div className="row">
            <Button variant="primary" block loading={busy} onClick={() => void savePdf()}>
              Save PDF
            </Button>
            <Button variant="secondary" block onClick={() => void share()}>
              Share as text
            </Button>
          </div>
          {/* A browser has a print dialog of its own; a Home Screen app on iOS does not, so the button is not offered there. */}
          {!isStandalone() ? (
            <button type="button" className="link-btn" onClick={() => window.print()}>
              Print from this browser
            </button>
          ) : null}
          {status ? (
            <p className="small" role="status">
              {status}
            </p>
          ) : null}
        </div>

        <article ref={articleRef} className={paper ? 'report card card-pad paper' : 'report card card-pad'} aria-label="Report for the pediatrician">
          <header className="rd-head">
            <div className="rd-id">
              <p className="rd-kicker">Pediatric visit summary</p>
              <h1 className="rd-name report-title">{report.child.name}</h1>
              <p className="rd-who">
                {report.child.sex ? `${report.child.sex === 'male' ? 'Boy' : 'Girl'} · ` : ''}born {report.child.birthDate} · {report.child.age}
              </p>
            </div>
            <dl className="rd-meta" data-testid="report-meta">
              <div>
                <dt>{report.range.visit ? 'Visit' : 'Report'}</dt>
                <dd>{format(report.range.visit ? report.range.visit.this : now, 'MMMM d, yyyy')}</dd>
              </div>
              <div>
                <dt>{report.range.visit ? 'Since last visit' : 'Period'}</dt>
                <dd>
                  {format(report.range.from, 'MMM d')} – {format(report.range.to, 'MMM d')} · {report.range.days} days
                </dd>
              </div>
              <div>
                <dt>Days with entries</dt>
                <dd>
                  {loggedDays} of {report.range.wholeDays}
                </dd>
              </div>
            </dl>
          </header>

          <section className="rd-kpis" data-testid="report-summary" aria-label="Summary">
            {kpis.map((k) => (
              <div key={k.label} className={k.flag ? 'rd-kpi is-flag' : 'rd-kpi'} data-testid={`kpi-${k.id}`}>
                <span className="rd-kpi-label">{k.label}</span>
                <span className="rd-kpi-value">{k.value}</span>
                <RangeBar value={k.num} band={k.band} goal={k.goal} flag={k.flag} />
                <span className="rd-kpi-note">{k.note}</span>
              </div>
            ))}
          </section>

          <div className="rd-cols">
            <section className="rd-card report-section" data-testid="report-growth">
              <h2>Growth</h2>
              {report.chart ? (
                <figure className="report-chart">
                  <ReportWeightChart chart={report.chart} formatY={(v) => weightTick(v, wUnit)} steps={wUnit === 'lb' ? LB_STEPS : undefined} />
                  <figcaption className="rd-key">
                    <span className="rd-key-item">
                      <i className="rd-swatch is-dot" />
                      Weighings
                    </span>
                    {report.chart.goal ? (
                      <span className="rd-key-item">
                        <i className="rd-swatch is-dash" />
                        Doctor&rsquo;s {report.chart.goal.gramsPerDay} g/day
                      </span>
                    ) : null}
                    {report.chart.curves.length ? (
                      <span className="rd-key-item">
                        <i className="rd-swatch is-band" />
                        WHO 2nd–98th percentile, 50th
                      </span>
                    ) : null}
                  </figcaption>
                </figure>
              ) : (
                <p className="report-note">No weighings in this period.</p>
              )}
              {report.weighings.length ? (
                <table className="report-table rd-weighings" data-testid="report-weighings">
                  <thead>
                    <tr>
                      <th>Weighed</th>
                      <th>Weight</th>
                      <th>Change</th>
                      <th>Per day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.weighings.slice(-WEIGHING_ROWS).map((w) => (
                      <tr key={w.at.getTime()}>
                        <th scope="row">{format(w.at, w.timed ? 'MMM d, h:mm a' : 'MMM d')}</th>
                        <td>{w.value}</td>
                        <td>{w.grams === null ? '–' : `${w.grams >= 0 ? '+' : '−'}${Math.abs(w.grams)} g`}</td>
                        <td>{w.perDay === null ? '–' : `${w.perDay >= 0 ? '+' : '−'}${Math.abs(w.perDay)} g`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {report.weighings.length > WEIGHING_ROWS ? <p className="report-note">The latest {WEIGHING_ROWS} of {report.weighings.length} weighings; the chart has them all.</p> : null}
              <dl className="rd-facts">
                {g ? <Fact label="Since last visit" value={`${g.grams >= 0 ? '+' : '−'}${Math.abs(g.grams)} g`} note={`in ${Math.round(g.days)} days · ${g.vsGoal ?? `${g.perDay} g/day`}`} flag={gainLow} /> : report.gain?.verdict ? <Fact label="Gain" value={report.gain.perDay ?? '–'} note={report.gain.verdict} /> : null}
                {length ? <Fact label="Length" value={length.value} note={[pct(length.percentile), length.change].filter(Boolean).join(' · ')} /> : null}
                {head ? <Fact label="Head" value={head.value} note={[pct(head.percentile), head.change].filter(Boolean).join(' · ')} /> : null}
              </dl>
            </section>

            <section className="rd-card report-section" data-testid="report-feeding">
              <h2>Feeding</h2>
              {intakeDays.length >= 2 && intakeDays.some((d) => d.bottle > 0) ? (
                <figure className="report-chart">
                  <ReportIntakeChart days={intakeDays} average={bottleAvg} formatY={(v) => formatVolume(v, vol)} label="Bottles a day" target={target} />
                  <figcaption className="rd-key">
                    <span className="rd-key-item">
                      <i className="rd-swatch is-bar" />
                      By bottle, each day
                    </span>
                    <span className="rd-key-item">
                      <i className="rd-swatch is-avg" />
                      Average
                    </span>
                    {target ? (
                      <span className="rd-key-item">
                        <i className="rd-swatch is-target" />
                        150–180 mL/kg at her weight
                      </span>
                    ) : null}
                  </figcaption>
                </figure>
              ) : (
                <p className="report-note">No bottles logged in this period.</p>
              )}
              <dl className="rd-facts">
                <Fact label="Feeds a day" value={feeds?.value ?? '–'} note={typicalNote(feeds)} flag={below(feeds)} />
                {bottle ? <Fact label="By bottle a day" value={bottle.value} note={typicalNote(bottle)} /> : null}
                {mlkg ? <Fact label="Per kg a day" value={mlkg.value} note={mlkg.typical ? (mlkg.band ? `typical ${mlkg.typical}` : mlkg.typical) : ''} flag={below(mlkg)} /> : null}
                {kcalKg ? <Fact label="kcal per kg a day" value={kcalKg.value} note={[settings.calorieGoal ? `goal ${settings.calorieGoal}` : null, kcalKg.typical ? `typical ${kcalKg.typical}` : null].filter(Boolean).join(' · ')} flag={kcalLow} /> : null}
                {nursing ? <Fact label="Nursing a day" value={nursing.value} note={typicalNote(nursing)} /> : null}
                {pumped ? <Fact label="Pumped a day" value={pumped.value} note={typicalNote(pumped)} /> : null}
              </dl>
            </section>
          </div>

          <section className="rd-card rd-wide report-section" data-testid="report-pattern-card">
            <h2>Daily pattern · {report.pattern.length < report.range.days ? `last ${report.pattern.length} days` : `${report.pattern.length} days`}, midnight to midnight</h2>
            <figure className="report-chart rd-scroll">
              <ReportPattern days={report.pattern} />
              <figcaption className="rd-key">
                <span className="rd-key-item">
                  <i className="rd-swatch is-sleep" />
                  Sleep
                </span>
                <span className="rd-key-item">
                  <i className="rd-swatch is-feed" />
                  Feed
                </span>
                <span className="rd-key-item">
                  <i className="rd-swatch is-wet" />
                  Wet diaper
                </span>
                <span className="rd-key-item">
                  <i className="rd-swatch is-dirty" />
                  Dirty diaper
                </span>
              </figcaption>
            </figure>
            <dl className="rd-facts rd-facts-row" data-testid="report-diapers">
              <Fact label="Wet diapers a day" value={wet?.value ?? '–'} note={typicalNote(wet)} flag={below(wet)} />
              <Fact label="Dirty diapers a day" value={dirty?.value ?? '–'} note={typicalNote(dirty)} />
              <Fact label="Sleep a day" value={sleep?.value ?? '–'} note={typicalNote(sleep)} />
              {naps ? <Fact label="Naps a day" value={naps.value} note={typicalNote(naps)} /> : null}
            </dl>
          </section>

          <div className="rd-cols">
            <section className="rd-card report-section" data-testid="report-weeks">
              <h2>Week by week · daily averages</h2>
              <div className="report-days-scroll">
                <table className="report-table report-days">
                  <thead>
                    <tr>
                      <th>Week of</th>
                      <th>Feeds</th>
                      <th>Bottle</th>
                      {report.weeks.some((w) => w.kcalPerKg !== null) ? <th>kcal/kg</th> : null}
                      <th>Wet/dirty</th>
                      <th>Sleep</th>
                      <th>Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.weeks.map((w) => (
                      <tr key={w.from.toISOString()}>
                        <th scope="row">{format(w.from, 'MMM d')}</th>
                        <td>{w.loggedDays ? oneDecimal(w.feeds) : '–'}</td>
                        <td>{w.bottle ? formatVolume(w.bottle, vol) : '–'}</td>
                        {report.weeks.some((x) => x.kcalPerKg !== null) ? <td>{w.kcalPerKg ? Math.round(w.kcalPerKg) : '–'}</td> : null}
                        <td>{w.loggedDays ? `${oneDecimal(w.wet)} / ${oneDecimal(w.dirty)}` : '–'}</td>
                        <td>{w.sleepHours ? formatDurationShort(w.sleepHours * 3600) : '–'}</td>
                        <td>{w.weight ? w.weight.value : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rd-card report-section" data-testid="report-health">
              <h2>Health &amp; development</h2>
              {report.temperatures.length || report.medicines.length ? (
                <ul className="report-list">
                  {report.temperatures.slice(-HEALTH_ROWS).map((t, i) => (
                    <li key={`t${i}`} data-testid="report-temp" className={t.level === 'normal' ? undefined : 'is-flag'}>
                      <span className="rd-when">{format(t.at, 'MMM d, h:mm a')}</span>
                      <span>
                        <span className="strong">{t.value}</span> {t.level}
                      </span>
                    </li>
                  ))}
                  {report.temperatures.length > HEALTH_ROWS ? (
                    <li className="report-note">
                      <span />
                      <span>and {report.temperatures.length - HEALTH_ROWS} earlier readings</span>
                    </li>
                  ) : null}
                  {medicines.map((m) => (
                    <li key={m.name} data-testid="report-med">
                      <span className="rd-when">{m.count > 1 ? `${m.count} doses, last ${format(m.last, 'MMM d')}` : format(m.last, 'MMM d, h:mm a')}</span>
                      <span>
                        <span className="strong">{m.name}</span>
                        {m.dose ? ` ${m.dose}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="report-note">No temperatures or medicines logged in this period.</p>
              )}
              {checklist ? (
                <p className="rd-dev" data-testid="report-milestones">
                  <span className="strong">
                    CDC {checklist.list.adjective} checklist: {checklist.seen} of {checklist.total} marked as seen
                  </span>
                  {checklist.since.length ? ` · since the last visit: ${checklist.since.join('; ')}` : ''}
                  {checklist.open.length ? ` · not marked yet: ${checklist.open.join('; ')}` : ''}
                </p>
              ) : null}
            </section>
          </div>

          {questions.trim() ? (
            <section className="rd-card rd-wide rd-questions report-section" data-testid="report-questions">
              <h2>Questions for this visit</h2>
              <p>{questions.trim()}</p>
            </section>
          ) : null}

          <p className="report-foot">
            Recorded by the family in Bramble; not a medical record. Averages are over the {report.range.wholeDays} full days before today and count only the days each kind was logged. Percentiles: WHO Child Growth Standards
            {basis.due ? ', by corrected age' : ''}. Typical ranges by age: AAP and CDC. Generated {format(now, 'MMM d, yyyy, h:mm a')}.
          </p>
        </article>
      </main>
    </>
  )
}

/** A percentile as the doctor reads it: "11th percentile", without the parent-facing advice Reports adds after it. */
const pct = (p: string | null) => (p ? p.split(' · ')[0].replace(' (WHO)', '') : null)

const oneDecimal = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** The weighings listed under the chart (the latest), and the temperatures listed before "and N earlier". */
const WEIGHING_ROWS = 5
const HEALTH_ROWS = 4

/** A labelled figure with the note it is read against; orange when it is under its range or short of the goal. */
function Fact({ label, value, note, flag = false }: { label: string; value: string; note?: string; flag?: boolean }) {
  return (
    <div className={flag ? 'rd-fact report-stat is-low' : 'rd-fact report-stat'}>
      <dt>{label}</dt>
      <dd>
        {value}
        {note ? <span className="report-note">{note}</span> : null}
      </dd>
    </div>
  )
}
