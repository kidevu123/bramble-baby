import { format } from 'date-fns'
import type { ChartPoint, ReportChart, ReportDay, ReportPatternDay } from '../../lib/doctor-report'
import { niceTicks } from './format'

/**
 * The pediatrician report's charts: still pictures that print on paper the way they show on the phone (no taps, no
 * readouts; the interactive charts live in Reports › Summary). Both scale with their box through the viewBox.
 */

const W = 320

/** Weight across the visit window: the weighings as dots on a line, the WHO 2nd/50th/98th as thin grey curves, and
 *  the doctor's goal as a dashed line from the first weighing. */
export function ReportWeightChart({ chart, formatY, steps }: { chart: ReportChart; formatY: (v: number) => string; /** Allowed tick steps (ounces on a pounds axis). */ steps?: number[] }) {
  const H = 128
  const padL = 44
  const padR = 30
  const padT = 8
  const padB = 20
  const all = [...chart.weights, ...(chart.goal ? [chart.goal.from, chart.goal.to] : [])]
  // The y axis fits the weighings and the goal; a curve that lies far outside is clipped, never stretches the axis.
  let lo = Math.min(...all.map((p) => p.value))
  let hi = Math.max(...all.map((p) => p.value))
  const room = Math.max((hi - lo) * 0.15, (hi || 1) * 0.02)
  lo -= room
  hi += room
  const ticks = yTicks(lo, hi, steps)
  const x0 = chart.from.getTime()
  const x1 = Math.max(chart.to.getTime(), x0 + 86_400_000)
  const x = (d: Date) => padL + ((d.getTime() - x0) / (x1 - x0)) * (W - padL - padR)
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)
  const path = (pts: ChartPoint[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const dates = dateTicks(chart.from, chart.to)
  // The WHO range (2nd to 98th percentile) as one soft band behind everything, when both edges are known.
  const lowEdge = chart.curves.find((c) => c.label === '2nd')
  const highEdge = chart.curves.find((c) => c.label === '98th')
  const band = lowEdge && highEdge ? `${path(highEdge.points)} ${[...lowEdge.points].reverse().map((p) => `L${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')} Z` : null
  return (
    <svg className="rc rc-weight" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weight chart" data-testid="report-weight-chart">
      <defs>
        <clipPath id="rc-plot">
          <rect x={padL} y={0} width={W - padL - padR} height={H - padB} />
        </clipPath>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line className="rc-grid" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
          <text className="rc-tick" x={padL - 4} y={y(t) + 3} textAnchor="end">
            {formatY(t)}
          </text>
        </g>
      ))}
      <g clipPath="url(#rc-plot)">
        {band ? <path className="rc-band" d={band} /> : null}
        {chart.curves.map((c) => (
          <path key={c.label} className={c.label === '50th' ? 'rc-curve rc-curve-mid' : 'rc-curve'} d={path(c.points)} />
        ))}
        {chart.goal ? <path className="rc-goal" d={path([chart.goal.from, chart.goal.to])} /> : null}
        <path className="rc-line" d={path(chart.weights)} />
      </g>
      {chart.curves.map((c) => {
        const last = c.points[c.points.length - 1]
        const yy = y(last.value)
        if (yy < padT - 2 || yy > H - padB + 2) return null
        return (
          <text key={c.label} className="rc-curve-label" x={W - padR + 3} y={yy + 3}>
            {c.label}
          </text>
        )
      })}
      {chart.weights.map((p, i) => (
        <circle key={i} className="rc-dot" cx={x(p.at)} cy={y(p.value)} r={3} />
      ))}
      {dates.map((d) => (
        <text key={d.getTime()} className="rc-tick" x={x(d)} y={H - 5} textAnchor="middle">
          {format(d, 'MMM d')}
        </text>
      ))}
    </svg>
  )
}

/** Bottles a day across the window (every day a bar, today included), with the average as a dashed line. */
export function ReportIntakeChart({ days, average, formatY, label, target }: { days: ReportDay[]; average: number; formatY: (v: number) => string; label: string; /** A band to read the bars against (what her weight suggests a day), in the bars' unit. */ target?: [number, number] | null }) {
  const H = 112
  const padL = 44
  const padR = 8
  const padT = 8
  const padB = 20
  const top = Math.max(...days.map((d) => d.bottle), average, target ? target[1] : 0, 1)
  const { top: max, ticks } = niceTicks(top, 3)
  const n = days.length
  const slot = (W - padL - padR) / n
  const bw = Math.max(1, Math.min(10, slot * 0.7))
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB)
  const dates = dateTicks(days[0].date, days[n - 1].date)
  const x = (d: Date) => padL + ((d.getTime() - days[0].date.getTime()) / Math.max(1, days[n - 1].date.getTime() - days[0].date.getTime())) * (W - padL - padR - slot) + slot / 2
  return (
    <svg className="rc rc-intake" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} data-testid="report-intake-chart">
      {ticks.map((t) => (
        <g key={t}>
          <line className="rc-grid" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
          <text className="rc-tick" x={padL - 4} y={y(t) + 3} textAnchor="end">
            {formatY(t)}
          </text>
        </g>
      ))}
      {target ? <rect className="rc-target" x={padL} width={W - padL - padR} y={y(target[1])} height={Math.max(1, y(target[0]) - y(target[1]))} /> : null}
      {days.map((d, i) => (
        <rect key={i} className="rc-bar" x={padL + i * slot + (slot - bw) / 2} y={y(d.bottle)} width={bw} height={Math.max(0, y(0) - y(d.bottle))} />
      ))}
      {average > 0 ? (
        <>
          <line className="rc-avg" x1={padL} x2={W - padR} y1={y(average)} y2={y(average)} />
          <text className="rc-avg-label" x={padL + 3} y={y(average) - 3}>
            avg {formatY(average)}
          </text>
        </>
      ) : null}
      {dates.map((d) => (
        <text key={d.getTime()} className="rc-tick" x={x(d)} y={H - 5} textAnchor="middle">
          {format(d, 'MMM d')}
        </text>
      ))}
    </svg>
  )
}

/** Three or four dates along the bottom: the first, the last, and one or two between. */
function dateTicks(from: Date, to: Date): Date[] {
  const span = to.getTime() - from.getTime()
  if (span <= 0) return [from]
  const n = span > 20 * 86_400_000 ? 4 : 3
  return Array.from({ length: n }, (_, i) => new Date(from.getTime() + (span * i) / (n - 1)))
}

/** Two to four round y ticks inside the range (ounce steps on a pounds axis when given). */
function yTicks(lo: number, hi: number, steps?: number[]): number[] {
  const span = hi - lo
  const candidates = steps ?? [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5]
  const step = candidates.find((s) => span / s <= 4) ?? candidates[candidates.length - 1]
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000)
  return out
}

/**
 * A number against its typical range: a thin track, the range as a band, the value as a mark, and optionally a goal
 * as a tick. The scale runs from zero to a little past whichever is largest, so a value far under its range sits
 * visibly to the left of it. Drawn only when there is a range or a goal to read against.
 */
export function RangeBar({ value, band, goal, flag = false }: { value: number; band: [number, number] | null; goal?: number | null; flag?: boolean }) {
  if (!band && !goal) return null
  const W2 = 120
  const H = 12
  const top = Math.max(value, band ? band[1] : 0, goal ?? 0) * 1.25 || 1
  const x = (v: number) => Math.max(1.5, Math.min(W2 - 1.5, (Math.max(0, v) / top) * W2))
  return (
    <svg className={flag ? 'rb is-flag' : 'rb'} viewBox={`0 0 ${W2} ${H}`} preserveAspectRatio="none" aria-hidden data-testid="range-bar">
      <rect className="rb-track" x={0} y={5} width={W2} height={2} rx={1} />
      {band ? <rect className="rb-band" x={x(band[0])} y={3} width={Math.max(2, x(band[1]) - x(band[0]))} height={6} rx={1.5} /> : null}
      {goal ? <rect className="rb-goal" x={x(goal) - 0.6} y={1} width={1.2} height={10} /> : null}
      <circle className="rb-mark" cx={x(value)} cy={6} r={3.2} />
    </svg>
  )
}

/**
 * The daily pattern: each day a row of 24 hours, midnight to midnight, the newest at the bottom. Sleep is a block,
 * a feed a tick, a diaper a dot (hollow wet, filled dirty). What a table of averages cannot show is plain here: the
 * long stretch at night, feeds bunching in the evening, a day with nothing logged.
 */
export function ReportPattern({ days }: { days: ReportPatternDay[] }) {
  const WP = 720
  const padL = 44
  const padR = 6
  const padT = 14
  const rowH = days.length <= 14 ? 8 : days.length <= 21 ? 6 : 4.6
  const H = padT + days.length * rowH + 4
  const x = (h: number) => padL + (Math.max(0, Math.min(24, h)) / 24) * (WP - padL - padR)
  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24]
  const hourLabel = (h: number) => (h === 0 || h === 24 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`)
  // A date label on the first row, the last, and each Monday between (every row would be a smear at this size).
  const labelled = (i: number) => i === 0 || i === days.length - 1 || (days[i].date.getDay() === 1 && i > 1 && i < days.length - 2)
  return (
    <svg className="rc rp" viewBox={`0 0 ${WP} ${H}`} role="img" aria-label="Sleep, feeds and diapers hour by hour, a row for each day" data-testid="report-pattern">
      {hours.map((h) => (
        <g key={h}>
          <line className="rp-hour" x1={x(h)} x2={x(h)} y1={padT - 2} y2={H - 2} />
          <text className="rc-tick" x={x(h)} y={8} textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>
            {hourLabel(h)}
          </text>
        </g>
      ))}
      {days.map((d, i) => {
        const y0 = padT + i * rowH
        const mid = y0 + rowH / 2
        const r = Math.min(1.7, rowH / 2 - 0.9)
        return (
          <g key={d.date.getTime()} className="rp-day">
            {i % 2 === 0 ? <rect className="rp-stripe" x={padL} y={y0} width={WP - padL - padR} height={rowH} /> : null}
            {labelled(i) ? (
              <text className="rc-tick" x={padL - 5} y={mid + 2.6} textAnchor="end">
                {format(d.date, 'MMM d')}
              </text>
            ) : null}
            {d.sleep.map(([a, b], k) => (
              <rect key={`s${k}`} className="rp-sleep" x={x(a)} y={y0 + 0.9} width={Math.max(0.8, x(b) - x(a))} height={rowH - 1.8} rx={1} />
            ))}
            {d.feeds.map((h, k) => (
              <rect key={`f${k}`} className="rp-feed" x={x(h) - 0.7} y={y0 + 0.3} width={1.4} height={rowH - 0.6} />
            ))}
            {d.wet.map((h, k) => (
              <circle key={`w${k}`} className="rp-wet" cx={x(h)} cy={mid} r={r} />
            ))}
            {d.dirty.map((h, k) => (
              <circle key={`d${k}`} className="rp-dirty" cx={x(h)} cy={mid} r={r} />
            ))}
          </g>
        )
      })}
    </svg>
  )
}
