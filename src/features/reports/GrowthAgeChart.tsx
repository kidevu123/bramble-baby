import { useEffect, useId, useRef, useState } from 'react'
import { valueAtPercentile, type GrowthMetric, type Sex } from '../../lib/science'
import type { PointText } from './charts'
import { CollapseIcon, ExpandIcon } from '../../components/icons'
import { ageTicks, ageWindowEnd, fullWindow, linesAround } from './age-chart'
import { lineDomain } from './format'

const MONTH_MS = 30.4375 * 86_400_000
/**
 * The lines on the WHO charts as CDC prints them for children under 2: the outer two are 2 SD from the median
 * (the 2.3rd and 97.7th percentiles), labelled 2 and 98, and they are the cut-offs for low and high.
 */
const AGE_CHART_LINES: { p: number; label: string; strong: boolean }[] = [
  { p: 2.3, label: '2', strong: true },
  { p: 5, label: '5', strong: false },
  { p: 10, label: '10', strong: false },
  { p: 25, label: '25', strong: true },
  { p: 50, label: '50', strong: true },
  { p: 75, label: '75', strong: true },
  { p: 90, label: '90', strong: false },
  { p: 95, label: '95', strong: false },
  { p: 97.7, label: '98', strong: true },
]

export interface AgePoint {
  x: Date
  y: number
}

/**
 * A growth chart the way the pediatrician's card draws it: age along the bottom from birth, the WHO percentile
 * curves for the child's sex with the bands between them shaded (25th–75th green, out to the 2nd and 98th
 * yellow, beyond them red), and the child's measurements as dots on top. A tap reads a dot, as on the other chart.
 * It opens on the whole chart (birth to 3, 6, 12 or 24 months, the 2nd to the 98th), like the card; the arrows
 * button at its top zooms in to the child: the age runs a little past the latest one and the height fits the
 * measurements and the lines around them (`linesAround`), so a month of ounces is not lost in a 5–16 lb box.
 */
export function GrowthAgeChart({
  points,
  birth,
  startLabel = 'Birth',
  sex,
  metric,
  fromMetric,
  formatY,
  steps,
  describe,
  noun,
}: {
  points: AgePoint[]
  birth: Date
  /** The first tick: 'Due' when the chart counts from the due date (Settings › Born early). */
  startLabel?: string
  sex: Sex
  metric: GrowthMetric
  /** kg or cm → the phone's unit. */
  fromMetric: (v: number) => number
  formatY: (v: number) => string
  steps?: number[]
  describe: (i: number) => PointText
  noun: string
}) {
  const [sel, setSel] = useState<number | null>(null)
  const [zoom, setZoom] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  const clipId = `ga-clip-${useId().replace(/:/g, '')}`
  useEffect(() => {
    if (sel === null) return
    const away = (e: PointerEvent) => {
      if (!svgRef.current?.contains(e.target as Node)) setSel(null)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [sel])

  const ageOf = (d: Date) => (d.getTime() - birth.getTime()) / MONTH_MS
  const shown = points.map((p, i) => ({ ...p, i, age: ageOf(p.x) })).filter((p) => p.age >= 0 && p.age <= 24)
  const lastAge = Math.max(ageOf(new Date()), ...shown.map((p) => p.age), 0)
  const win = zoom ? ageWindowEnd(lastAge) : fullWindow(lastAge)
  const lineAt = (k: number, m: number) => fromMetric(valueAtPercentile(metric, sex, m, AGE_CHART_LINES[k].p))
  // The WHO table has one row a month: the curves pass through those exact values and are drawn smooth between
  // them (straight joins put a visible corner at every month), on past the window's end and clipped there.
  const N = Math.ceil(win)
  const curves = AGE_CHART_LINES.map((l, k) => ({
    ...l,
    pts: Array.from({ length: N + 1 }, (_, m) => ({ m, v: lineAt(k, m) })),
  }))
  const low = curves[0].pts
  const high = curves[curves.length - 1].pts
  const fitted = linesAround(
    shown.map((p) => p.y),
    (k, i) => lineAt(k, shown[i].age),
    curves.length,
  )
  const samples = Array.from({ length: 9 }, (_, j) => (win * j) / 8)
  const ys = zoom ? [...shown.map((p) => p.y), ...fitted.flatMap((k) => samples.map((m) => lineAt(k, m)))] : [lineAt(0, 0), lineAt(curves.length - 1, win), ...shown.map((p) => p.y)]
  const dom = lineDomain(ys, 0, steps, 6)

  const W = 320
  const H = 230
  const top = 8
  const padB = 22
  const padR = 22
  const innerH = H - top - padB
  const padL = Math.max(40, Math.max(...dom.ticks.map((t) => formatY(t).length)) * 5.6 + 10)
  const innerW = W - padL - padR
  const sx = (m: number) => padL + (m / win) * innerW
  const sy = (v: number) => top + innerH - ((v - dom.min) / (dom.max - dom.min)) * innerH
  const xy = (q: { m: number; v: number }) => `${sx(q.m).toFixed(1)},${sy(q.v).toFixed(1)}`
  // Catmull-Rom through the points as cubic Béziers (the segments after the first point's M).
  const smooth = (pts: { m: number; v: number }[]) =>
    pts
      .slice(1)
      .map((q, k) => {
        const p0 = pts[Math.max(0, k - 1)]
        const p1 = pts[k]
        const p2 = q
        const p3 = pts[Math.min(pts.length - 1, k + 2)]
        const c1 = { m: p1.m + (p2.m - p0.m) / 6, v: p1.v + (p2.v - p0.v) / 6 }
        const c2 = { m: p2.m - (p3.m - p1.m) / 6, v: p2.v - (p3.v - p1.v) / 6 }
        return `C${xy(c1)} ${xy(c2)} ${xy(p2)}`
      })
      .join(' ')
  const line = (pts: { m: number; v: number }[]) => `M${xy(pts[0])} ${smooth(pts)}`
  // A band between two curves: along the lower one, back along the upper one.
  const band = (a: { m: number; v: number }[], b: { m: number; v: number }[]) => {
    const back = [...b].reverse()
    return `${line(a)} L${xy(back[0])} ${smooth(back)} Z`
  }
  const floor = low.map((q) => ({ m: q.m, v: dom.min }))
  const ceil = high.map((q) => ({ m: q.m, v: dom.max }))
  const at = (p: number) => curves.find((c) => c.p === p)!.pts
  // Labels: in the right margin for a line still in view at the end, from the bottom up, skipping one that would
  // sit on the last; a line that leaves through the top is labelled just under the top edge where it leaves.
  const labels: { label: string; x: number; y: number; inside: boolean }[] = []
  curves.forEach((c, k) => {
    const end = lineAt(k, win)
    if (end >= dom.min && end <= dom.max) {
      const y = sy(end)
      const last = labels.filter((l) => !l.inside).at(-1)
      if (!last || Math.abs(last.y - y) >= 9) labels.push({ label: c.label, x: W - padR + 4, y, inside: false })
      return
    }
    if (end < dom.min) return
    // Leaves through the top: the latest age at which it is still in view.
    let m = -1
    for (let j = 60; j >= 0; j--) {
      const a = (win * j) / 60
      if (lineAt(k, a) <= dom.max) {
        m = a
        break
      }
    }
    if (m < 0) return
    const x = Math.min(W - padR - 12, sx(m) + 2)
    if (labels.some((l) => l.inside && Math.abs(l.x - x) < 14)) return
    labels.push({ label: c.label, x, y: top + 9, inside: true })
  })
  const ticks = ageTicks(win, !zoom, startLabel)

  const picked = sel !== null && shown.some((p) => p.i === sel) ? sel : null
  const pickAt = (clientX: number, toggle = false) => {
    const box = svgRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || shown.length === 0) return
    const vx = ((clientX - box.left) / box.width) * W
    let best = shown[0]
    for (const p of shown) if (Math.abs(sx(p.age) - vx) < Math.abs(sx(best.age) - vx)) best = p
    setSel((was) => (toggle && was === best.i ? null : best.i))
  }
  const pk = picked !== null ? shown.find((p) => p.i === picked)! : null
  const text = pk ? describe(pk.i) : null
  const px = pk ? sx(pk.age) : 0
  const py = pk ? sy(pk.y) : 0
  const side = px < W * 0.3 ? 'left' : px > W * 0.7 ? 'right' : 'mid'
  const below = py < H * 0.4
  const order = shown.map((p) => p.i)
  const pos = picked === null ? -1 : order.indexOf(picked)

  return (
    <div className="line-chart age-chart" data-testid="age-chart">
      <div className="ga-tools">
        <button type="button" className="ga-zoom" aria-pressed={zoom} onClick={() => setZoom((z) => !z)} data-testid="age-zoom">
          {zoom ? <CollapseIcon /> : <ExpandIcon />}
          {zoom ? 'Whole chart' : 'Zoom in'}
        </button>
      </div>
      <svg
        ref={svgRef}
        className="bars lc-live"
        viewBox={`0 0 ${W} ${H}`}
        role="slider"
        tabIndex={0}
        aria-label={`Pick a ${noun} on the growth chart`}
        aria-valuemin={1}
        aria-valuemax={Math.max(1, shown.length)}
        aria-valuenow={(pos >= 0 ? pos : shown.length - 1) + 1}
        aria-valuetext={text ? `${text.value}, ${text.when}${text.change ? `, ${text.change}` : ''}` : `${shown.length} ${noun}s`}
        onPointerDown={(e) => {
          e.preventDefault()
          dragging.current = true
          pickAt(e.clientX, true)
        }}
        onPointerMove={(e) => {
          if (dragging.current) pickAt(e.clientX)
        }}
        onPointerUp={() => {
          dragging.current = false
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
        onKeyDown={(e) => {
          if (!order.length) return
          const at = pos < 0 ? order.length : pos
          if (e.key === 'ArrowLeft') setSel(order[Math.max(0, at - 1)])
          else if (e.key === 'ArrowRight') setSel(order[pos < 0 ? order.length - 1 : Math.min(order.length - 1, at + 1)])
          else if (e.key === 'Home') setSel(order[0])
          else if (e.key === 'End') setSel(order[order.length - 1])
          else if (e.key === 'Escape') setSel(null)
          else return
          e.preventDefault()
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={padL} y={top} width={innerW} height={innerH} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <path d={band(floor, low)} className="ga-band ga-out" />
          <path d={band(low, at(25))} className="ga-band ga-edge" />
          <path d={band(at(25), at(75))} className="ga-band ga-mid" />
          <path d={band(at(75), high)} className="ga-band ga-edge" />
          <path d={band(high, ceil)} className="ga-band ga-out" />
          {curves.map((c) => (
            <path key={c.p} d={line(c.pts)} fill="none" className={c.p === 50 ? 'ga-line ga-line-50' : c.strong ? 'ga-line ga-line-strong' : 'ga-line'} />
          ))}
        </g>
        {dom.ticks.map((t) => (
          <text key={t} x={padL - 6} y={sy(t) + 3} className="bars-tick" textAnchor="end">
            {formatY(t)}
          </text>
        ))}
        {labels.map((l) => (
          <text key={l.label} x={l.x} y={l.y + 3} className={`bars-tick ga-label${l.inside ? ' ga-label-in' : ''}`}>
            {l.label}
          </text>
        ))}
        {ticks.map((t, k) => (
          <text key={t.label} x={sx(t.m)} y={H - 6} className="bars-tick" textAnchor={k === 0 ? 'start' : k === ticks.length - 1 && sx(t.m) > W - padR - 20 ? 'end' : 'middle'}>
            {t.label}
          </text>
        ))}
        {pk ? <line x1={px} x2={px} y1={top} y2={top + innerH} className="lc-cursor" /> : null}
        {shown.length > 1 ? <path d={shown.map((p, k) => `${k ? 'L' : 'M'}${sx(p.age).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')} fill="none" className="ga-child-line" /> : null}
        {shown.map((p) => (
          <circle key={p.i} cx={sx(p.age)} cy={sy(p.y)} r={p.i === picked ? 6 : 3.5} className={`ga-dot${p.i === picked ? ' lc-dot-on' : ''}`} />
        ))}
      </svg>
      {text ? (
        <div className={`lc-tip lc-tip-${side}${below ? ' lc-tip-below' : ''}`} style={{ left: `${(px / W) * 100}%`, top: `${(py / H) * 100}%` }} role="status" data-testid="chart-tip">
          <span className="lc-tip-value">{text.value}</span>
          <span className="lc-tip-when">{text.when}</span>
          {text.change ? <span className="lc-tip-change">{text.change}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
