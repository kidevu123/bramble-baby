import { addDays, format, isSameDay, startOfDay } from 'date-fns'
import type { EventSets } from '../../lib/events'
import { parseDate } from '../../lib/time'
import { hourTick } from './format'
import './calendar.css'

const HOURS = 24
const W = 340
const H = 520
const PAD_L = 28
const PAD_T = 22
const innerW = W - PAD_L - 4
const innerH = H - PAD_T - 4

function y(date: Date, dayStart: Date): number {
  const mins = (date.getTime() - dayStart.getTime()) / 60_000
  return PAD_T + (Math.min(Math.max(mins, 0), HOURS * 60) / (HOURS * 60)) * innerH
}

/** The Calendar view: one column per day, 24h tall, sleep as solid bars, other events as marks. */
export function CalendarView({ events, endDay, days = 7 }: { events: EventSets; endDay: Date; days?: number }) {
  const first = startOfDay(addDays(endDay, -(days - 1)))
  const cols = Array.from({ length: days }, (_, i) => addDays(first, i))
  const colW = innerW / days
  const today = new Date()

  return (
    <div className="cal-wrap card">
      <svg viewBox={`0 0 ${W} ${H}`} className="cal" role="img" aria-label={`${days}-day calendar of sleep, feeds and diapers`}>
        {Array.from({ length: HOURS / 2 + 1 }, (_, i) => i * 2).map((h) => {
          const yy = PAD_T + (h / HOURS) * innerH
          return (
            <g key={h}>
              <line x1={PAD_L} x2={W - 4} y1={yy} y2={yy} className="cal-grid" />
              <text x={PAD_L - 4} y={yy + 3} className="cal-tick" textAnchor="end">
                {hourTick(h)}
              </text>
            </g>
          )
        })}
        {cols.map((day, i) => {
          const x = PAD_L + i * colW
          const dayEnd = addDays(day, 1)
          const isToday = isSameDay(day, today)
          return (
            <g key={i}>
              <text x={x + colW / 2} y={9} className={isToday ? 'cal-day cal-day-today' : 'cal-day'} textAnchor="middle">
                {format(day, 'EEE')}
              </text>
              <text x={x + colW / 2} y={18} className="cal-tick" textAnchor="middle">
                {format(day, 'd')}
              </text>
              {events.sleep.map((s) => {
                const st = parseDate(s.start)
                const en = parseDate(s.end)
                if (en <= day || st >= dayEnd) return null
                const y1 = y(st < day ? day : st, day)
                const y2 = y(en > dayEnd ? dayEnd : en, day)
                return <rect key={s.id} x={x + 3} y={y1} width={colW - 6} height={Math.max(2, y2 - y1)} rx="2" className={s.nap ? 'cal-nap' : 'cal-night'} />
              })}
              {events.feedings.map((f) => {
                const st = parseDate(f.start)
                if (!isSameDay(st, day)) return null
                return <rect key={`f${f.id}`} x={x + 3} y={y(st, day) - 1.5} width={colW - 6} height="3" rx="1.5" className={f.type === 'solid food' ? 'cal-solid' : 'cal-feed'} />
              })}
              {events.changes.map((d) => {
                const t = parseDate(d.time)
                if (!isSameDay(t, day)) return null
                return <circle key={`d${d.id}`} cx={x + colW - 6} cy={y(t, day)} r="2.4" className={d.solid ? 'cal-poo' : 'cal-pee'} />
              })}
              {events.pumping.map((p) => {
                const t = parseDate(p.start)
                if (!isSameDay(t, day)) return null
                return <circle key={`p${p.id}`} cx={x + 6} cy={y(t, day)} r="2.4" className="cal-pump" />
              })}
              {isToday ? <line x1={x} x2={x + colW} y1={y(today, day)} y2={y(today, day)} className="cal-now" /> : null}
            </g>
          )
        })}
      </svg>
      <div className="cal-legend">
        <span>
          <i className="cal-night-dot" /> Night
        </span>
        <span>
          <i className="cal-nap-dot" /> Nap
        </span>
        <span>
          <i className="cal-feed-dot" /> Feed
        </span>
        <span>
          <i className="cal-solid-dot" /> Solids
        </span>
        <span>
          <i className="cal-pee-dot" /> Wet
        </span>
        <span>
          <i className="cal-poo-dot" /> Poo
        </span>
        <span>
          <i className="cal-pump-dot" /> Pump
        </span>
      </div>
    </div>
  )
}
