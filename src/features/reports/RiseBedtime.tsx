import { addDays, format, startOfDay } from 'date-fns'
import type { Sleep } from '../../lib/api/types'
import { observedWakeWindows, ageWakeWindow } from '../../lib/nap-window'
import { formatDurationShort, parseDate } from '../../lib/time'
import { hourTick } from './format'
import './charts.css'

/**
 * A "Rise and Bedtime" report: wake-up and bedtime per day,
 * wake window averages, and how the child's windows compare with the age-based nap window range.
 */
export function RiseBedtime({ sleeps, days, now, ageMonths }: { sleeps: Sleep[]; days: Date[]; now: Date; ageMonths: number }) {
  const rows = days.map((d) => {
    const dayStart = startOfDay(d)
    const dayEnd = addDays(dayStart, 1)
    // Wake-up: end of the night sleep that ends this morning (before noon).
    const noon = new Date(dayStart.getTime() + 12 * 3_600_000)
    const wake = sleeps.filter((s) => !s.nap && parseDate(s.end) >= dayStart && parseDate(s.end) <= noon).sort((a, b) => parseDate(b.end).getTime() - parseDate(a.end).getTime())[0]
    // Bedtime: start of the night sleep that begins this evening (after 4pm).
    const four = new Date(dayStart.getTime() + 16 * 3_600_000)
    const bed = sleeps.filter((s) => !s.nap && parseDate(s.start) >= four && parseDate(s.start) < dayEnd).sort((a, b) => parseDate(a.start).getTime() - parseDate(b.start).getTime())[0]
    return { day: d, wake: wake ? parseDate(wake.end) : null, bed: bed ? parseDate(bed.start) : null }
  })
  const minutes = (d: Date) => d.getHours() * 60 + d.getMinutes()
  const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null)
  const avgWake = avg(rows.filter((r) => r.wake).map((r) => minutes(r.wake!)))
  const avgBed = avg(rows.filter((r) => r.bed).map((r) => minutes(r.bed!)))
  const fmtMin = (m: number | null) => (m === null ? '—' : `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(Math.round(m % 60)).padStart(2, '0')} ${m >= 720 ? 'PM' : 'AM'}`)

  const windows = observedWakeWindows(sleeps, now, days.length)
  const avgWindow = avg(windows)
  const age = ageWakeWindow(ageMonths)

  // Chart: y from 5am (300) to 10pm (1320)
  const W = 320
  const H = 200
  const padL = 36
  const top = 300
  const bottom = 22 * 60
  const sy = (m: number) => 8 + ((m - top) / (bottom - top)) * (H - 30)
  const colW = (W - padL - 8) / rows.length

  return (
    <section className="card card-pad stack">
      <h3>Rise and Bedtime</h3>
      <div className="stat-grid">
        <div className="stat">
          <span className="stat-name">Typical wake-up</span>
          <span className="stat-value">{fmtMin(avgWake)}</span>
        </div>
        <div className="stat">
          <span className="stat-name">Typical bedtime</span>
          <span className="stat-value">{fmtMin(avgBed)}</span>
        </div>
        <div className="stat">
          <span className="stat-name">Avg wake window</span>
          <span className="stat-value">{avgWindow ? formatDurationShort(avgWindow * 60) : '—'}</span>
        </div>
        <div className="stat">
          <span className="stat-name">Wake window for age</span>
          <span className="stat-value">
            {formatDurationShort(age.minMinutes * 60)}–{formatDurationShort(age.maxMinutes * 60)}
          </span>
        </div>
      </div>
      <svg className="bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Wake-up and bedtime by day">
        {[6, 8, 10, 12, 14, 16, 18, 20].map((h) => (
          <g key={h}>
            <line x1={padL} x2={W - 8} y1={sy(h * 60)} y2={sy(h * 60)} className="bars-grid" />
            <text x={padL - 6} y={sy(h * 60) + 3} className="bars-tick" textAnchor="end">
              {hourTick(h)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = padL + i * colW + colW / 2
          return (
            <g key={i}>
              {r.wake && r.bed ? <line x1={x} x2={x} y1={sy(minutes(r.wake))} y2={sy(minutes(r.bed))} stroke="var(--teal-light)" strokeWidth="6" strokeLinecap="round" /> : null}
              {r.wake ? <circle cx={x} cy={sy(minutes(r.wake))} r="5" fill="var(--yellow)" /> : null}
              {r.bed ? <circle cx={x} cy={sy(minutes(r.bed))} r="5" fill="var(--purple)" /> : null}
              <text x={x} y={H - 6} className="bars-tick" textAnchor="middle">
                {format(r.day, rows.length > 14 ? 'd' : 'EEEEE')}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="cal-legend">
        <span>
          <i style={{ background: 'var(--yellow)', borderRadius: '50%' }} /> Wake-up
        </span>
        <span>
          <i style={{ background: 'var(--purple)', borderRadius: '50%' }} /> Bedtime
        </span>
        <span>
          <i style={{ background: 'var(--teal-light)' }} /> Awake day
        </span>
      </div>
      {avgWindow ? (
        <p className="small muted">
          {avgWindow < age.minMinutes
            ? 'Wake windows run shorter than typical for this age. If naps are short, try stretching each window by 10–15 minutes.'
            : avgWindow > age.maxMinutes
              ? 'Wake windows run longer than typical for this age. Watch for overtiredness at bedtime.'
              : 'Wake windows sit inside the typical range for this age. The nap prediction is well calibrated.'}
        </p>
      ) : null}
    </section>
  )
}
