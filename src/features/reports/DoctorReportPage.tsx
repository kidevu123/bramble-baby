import { format } from 'date-fns'
import { useMemo, useState } from 'react'
import { TopBar } from '../../components/nav/TopBar'
import { Button } from '../../components/ui/Button'
import { useChildren } from '../../hooks/useChildren'
import { useChildSettings } from '../../hooks/useChildSettings'
import { rangeDays, useChildEvents, useGrowth } from '../../hooks/useEvents'
import { useNow } from '../../hooks/useNow'
import { usePrefs } from '../../hooks/usePrefs'
import { buildDoctorReport, reportText } from '../../lib/doctor-report'
import { ageBasis } from '../../lib/preterm'
import { formatDurationShort } from '../../lib/time'
import { formatVolume } from '../../lib/units'
import './summary.css'
import './report.css'

type Days = '7' | '14' | '30'

/**
 * The report for the pediatrician: one page over the last 7, 14 or 30 days that prints (iOS: Print, then
 * pinch the preview to save a PDF) or shares as plain text into a message or a patient portal.
 * Reached from Reports › Summary › Overview; Back returns there.
 */
export function DoctorReportPage() {
  const { child } = useChildren()
  const { prefs } = usePrefs()
  const { settings } = useChildSettings(child?.id ?? null)
  const [days, setDays] = useState<Days>('14')
  const [status, setStatus] = useState<string | null>(null)
  const now = useNow(60_000)
  const nowKey = now.toDateString()
  const range = useMemo(() => rangeDays(31, now), [nowKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const events = useChildEvents(child?.id ?? null, range)
  const growth = useGrowth(child?.id ?? null)
  const { bornAtDays, nicu } = settings
  const report = useMemo(
    () => (child ? buildDoctorReport(events, growth.data, child, prefs.units, settings.sex ?? null, settings.weightGoalGPerDay, Number(days), now, settings.weightGoalSince, ageBasis(child, { bornAtDays, nicu }), { goal: settings.calorieGoal ?? null, fortify: settings.fortify ?? null }) : null),
    [events, growth.data, child, prefs.units, settings.sex, settings.weightGoalGPerDay, settings.weightGoalSince, settings.calorieGoal, settings.fortify, bornAtDays, nicu, days, now],
  )
  if (!child || !report) return null
  const text = reportText(report)
  const vol = prefs.units.volume
  const kcalCol = report.days.some((d) => d.kcalPerKg !== null)

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

  return (
    <>
      <TopBar title="Pediatrician report" back right="none" />
      <main className="page stack report-page">
        <div className="report-actions stack">
          {/* The same pills as Summary's range: here the range is part of the report itself. */}
          <div className="range-pills" role="group" aria-label="Report range">
            {(['7', '14', '30'] as Days[]).map((d) => (
              <button key={d} type="button" aria-pressed={days === d} className={days === d ? 'range-pill active' : 'range-pill'} onClick={() => setDays(d)}>
                {d} days
              </button>
            ))}
          </div>
          <div className="row">
            <Button variant="primary" block onClick={() => window.print()}>
              Print or PDF
            </Button>
            <Button variant="secondary" block onClick={() => void share()}>
              Share as text
            </Button>
          </div>
          <p className="xs muted" style={{ margin: 0 }}>
            On iPhone, Print opens a preview: pinch it open to share it as a PDF.
          </p>
          {status ? (
            <p className="small" role="status">
              {status}
            </p>
          ) : null}
        </div>

        <article className="report card card-pad" aria-label="Report for the pediatrician">
          <header className="report-head">
            <h1 className="report-title">{report.child.name}</h1>
            <p className="report-sub">
              born {report.child.birthDate} · {report.child.age}
              {report.child.sex ? ` · ${report.child.sex === 'male' ? 'boy' : 'girl'}` : ''}
            </p>
            <p className="report-sub">
              {format(report.range.from, 'MMM d')} – {format(report.range.to, 'MMM d, yyyy')} · {report.range.days} days · from Bramble
            </p>
          </header>

          {report.growth.length ? (
            <section className="report-section" data-testid="report-growth">
              <h2>Growth</h2>
              <table className="report-table">
                <tbody>
                  {report.growth.map((g) => (
                    <tr key={g.key}>
                      <th scope="row">{g.label}</th>
                      <td>
                        <span className="strong">{g.value}</span>
                        <span className="report-note">
                          {g.date}
                          {g.percentile ? ` · ${g.percentile}` : ''}
                          {g.change ? ` · ${g.change}` : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {report.gain ? (
                    <tr>
                      <th scope="row">Gain</th>
                      <td>
                        <span className="strong">{report.gain.perDay}</span>
                        <span className="report-note">
                          {report.gain.verdict ?? report.gain.week ?? report.gain.sinceLast}
                        </span>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>
          ) : null}

          {report.averages.length ? (
            <section className="report-section" data-testid="report-averages">
              <h2>Daily averages</h2>
              <p className="report-note">Over the {report.range.wholeDays} full days before today; today is still in progress.</p>
              <table className="report-table">
                <tbody>
                  {report.averages.map((a) => (
                    <tr key={a.key}>
                      <th scope="row">{a.label}</th>
                      <td>
                        <span className="strong">{a.value}</span>
                        <span className="report-note">
                          {a.typical ? `typical ${a.typical}` : ''}
                          {a.loggedDays < report.range.wholeDays ? `${a.typical ? ' · ' : ''}${a.loggedDays} of ${report.range.wholeDays} days logged` : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <section className="report-section" data-testid="report-days">
            <h2>Day by day</h2>
            {/* kcal per kg by bottle, only when there is any (a weighing and bottles with volume). */}
            {/* Six columns do not fit a 320 px phone: the table scrolls inside its own box, never the page. */}
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
          </section>

          {report.temperatures.length ? (
            <section className="report-section" data-testid="report-temps">
              <h2>Temperatures</h2>
              <ul className="report-list">
                {report.temperatures.map((t, i) => (
                  <li key={i}>
                    {format(t.at, 'MMM d, h:mm a')} · <span className="strong">{t.value}</span> · {t.level}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {report.medicines.length ? (
            <section className="report-section" data-testid="report-meds">
              <h2>Medicines</h2>
              <ul className="report-list">
                {report.medicines.map((m, i) => (
                  <li key={i}>
                    {format(m.at, 'MMM d, h:mm a')} · <span className="strong">{m.name}</span>
                    {m.dose ? ` ${m.dose}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </article>
      </main>
    </>
  )
}
