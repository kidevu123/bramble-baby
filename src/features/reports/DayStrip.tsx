import { addDays, format } from 'date-fns'
import type { EventSets } from '../../lib/events'
import { parseDate } from '../../lib/time'
import { hourTick } from './format'
import './calendar.css'

const W = 340
const H = 88
const PAD_L = 6
const PAD_R = 6
const AXIS_Y = 80
const innerW = W - PAD_L - PAD_R

/**
 * One day as a horizontal strip: sleep as blocks, feeds and solids as ticks, diapers and pumps as dots,
 * the current time as a red line. The hour-by-hour picture the Week view gives, for one day, in the
 * height of a card header instead of a screen.
 */
export function DayStrip({ events, day, dayStartHour, filters, now }: { events: EventSets; day: Date; dayStartHour: number; filters: Record<string, boolean>; now: Date }) {
  const start = new Date(day)
  start.setHours(Math.floor(dayStartHour), Math.round((dayStartHour % 1) * 60), 0, 0)
  const end = addDays(start, 1)
  const x = (d: Date) => PAD_L + (Math.min(Math.max((d.getTime() - start.getTime()) / 3_600_000, 0), 24) / 24) * innerW
  const on = (k: string) => filters[k] !== false
  const inDay = (d: Date) => d >= start && d < end
  const showNow = now >= start && now < end
  const sleeps = on('sleep') ? events.sleep.filter((s) => parseDate(s.end) > start && parseDate(s.start) < end) : []
  const feeds = on('feeding') ? events.feedings.filter((f) => f.type !== 'solid food' && inDay(parseDate(f.start))) : []
  const solids = on('solids') ? events.feedings.filter((f) => f.type === 'solid food' && inDay(parseDate(f.start))) : []
  const diapers = on('diaper') ? events.changes.filter((d) => inDay(parseDate(d.time))) : []
  const pumps = on('pumping') ? events.pumping.filter((p) => inDay(parseDate(p.start))) : []
  const keys = (
    [
      ['cal-night', 'Night', sleeps.some((s) => !s.nap)],
      ['cal-nap', 'Nap', sleeps.some((s) => s.nap)],
      ['cal-feed', 'Feed', feeds.length > 0],
      ['cal-solid', 'Solids', solids.length > 0],
      ['cal-pee', 'Wet', diapers.some((d) => !d.solid)],
      ['cal-poo', 'Poo', diapers.some((d) => d.solid)],
      ['cal-pump', 'Pump', pumps.length > 0],
    ] as const
  )
    .filter(([, , has]) => has)
    .map(([cls, label]) => [cls, label] as const)
  return (
    <div className="card day-strip-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="cal day-strip" role="img" aria-label={`${format(day, 'MMM d')} hour by hour: sleep, feeds, diapers and pumping`}>
        {Array.from({ length: 7 }, (_, i) => i * 4).map((h) => {
          const hour = (Math.floor(dayStartHour) + h) % 24
          const xx = PAD_L + (h / 24) * innerW
          return (
            <g key={h}>
              <line x1={xx} x2={xx} y1={8} y2={AXIS_Y - 8} className="cal-grid" />
              <text x={xx} y={AXIS_Y + 2} className="cal-tick" textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>
                {hourTick(hour)}
              </text>
            </g>
          )
        })}
        {sleeps.map((s) => {
              const st = parseDate(s.start)
              const en = parseDate(s.end)
              const x1 = x(st < start ? start : st)
              const x2 = x(en > end ? end : en)
              return <rect key={s.id} x={x1} y={10} width={Math.max(2, x2 - x1)} height={22} rx="3" className={s.nap ? 'cal-nap' : 'cal-night'} />
            })}
        {feeds.map((f) => <rect key={`f${f.id}`} x={x(parseDate(f.start)) - 1.5} y={38} width="3" height="12" rx="1.5" className="cal-feed" />)}
        {solids.map((f) => <rect key={`s${f.id}`} x={x(parseDate(f.start)) - 1.5} y={38} width="3" height="12" rx="1.5" className="cal-solid" />)}
        {diapers.map((d) => <circle key={`d${d.id}`} cx={x(parseDate(d.time))} cy={58} r="3.2" className={d.solid ? 'cal-poo' : 'cal-pee'} />)}
        {pumps.map((p) => <circle key={`p${p.id}`} cx={x(parseDate(p.start))} cy={68} r="3.2" className="cal-pump" />)}
        {showNow ? <line x1={x(now)} x2={x(now)} y1={6} y2={AXIS_Y - 6} className="cal-now" /> : null}
      </svg>
      {/* Only the marks this day has: a full key of seven wrapped to two lines under a one-line strip. */}
      {keys.length ? (
        <div className="cal-legend">
          {keys.map(([cls, label]) => (
            <span key={cls}>
              <i className={`${cls}-dot`} /> {label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
