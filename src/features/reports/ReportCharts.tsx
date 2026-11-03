import { format } from 'date-fns'
import type { ChartPoint, ReportChart, ReportDay } from '../../lib/doctor-report'
import { niceTicks } from './format'

/**
 * The pediatrician report's charts: still pictures that print on paper the way they show on the phone (no taps, no
 * readouts; the interactive charts live in Reports › Summary). Both scale with their box through the viewBox.
 */

const W = 320

/** Weight across the visit window: the weighings as dots on a line, the WHO 2nd/50th/98th as thin grey curves, and
 *  the doctor's goal as a dashed line from the first weighing. */
export function ReportWeightChart({ chart, formatY, steps }: { chart: ReportChart; formatY: (v: number) => string; /** Allowed tick steps (ounces on a pounds axis). */ steps?: number[] }) {
  const H = 150
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
        {chart.curves.map((c) => (
          <path key={c.label} className="rc-curve" d={path(c.points)} />
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
export function ReportIntakeChart({ days, average, formatY, label }: { days: ReportDay[]; average: number; formatY: (v: number) => string; label: string }) {
  const H = 110
  const padL = 44
  const padR = 8
  const padT = 8
  const padB = 20
  const top = Math.max(...days.map((d) => d.bottle), average, 1)
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
