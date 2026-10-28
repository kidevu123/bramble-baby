import { barText, lineDomain, niceTicks } from './format'
import './charts.css'
import { usePick } from './usePick'

/** The small dark readout beside a picked point or above a picked bar; it flips side near the edges. */
export function ChartTip({ x, y, W, H, text }: { x: number; y: number; W: number; H: number; text: PointText }) {
  const side = x < W * 0.3 ? 'left' : x > W * 0.7 ? 'right' : 'mid'
  const below = y < H * 0.4
  return (
    <div className={`lc-tip lc-tip-${side}${below ? ' lc-tip-below' : ''}`} style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }} role="status" data-testid="chart-tip">
      <span className="lc-tip-value">{text.value}</span>
      <span className="lc-tip-when">{text.when}</span>
      {text.change ? <span className="lc-tip-change">{text.change}</span> : null}
      {text.check ? <span className={`lc-tip-check ${text.check.met ? 'is-met' : 'is-missed'}`}>{text.check.text}</span> : null}
    </div>
  )
}

/** Donut with a center label. Values are absolute; colors are CSS values. */
export function Donut({ segments, label, sub }: { segments: { value: number; color: string }[]; label: string; sub: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  const r = 42
  const circ = 2 * Math.PI * r
  const offsets = segments.reduce<number[]>((acc, _s, i) => [...acc, (acc[i - 1] ?? 0) + (segments[i - 1] ? (segments[i - 1].value / total) * circ : 0)], [])
  return (
    <div className="donut">
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r} className="donut-track" />
        {segments.map((s, i) => {
          const len = (s.value / total) * circ
          return <circle key={i} cx="50" cy="50" r={r} stroke={s.color} strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offsets[i]} className="donut-seg" />
        })}
      </svg>
      <div className="donut-center">
        <span className="donut-sub">{sub}</span>
        <span className="donut-label">{label}</span>
      </div>
    </div>
  )
}

export interface BarDay {
  label: string
  /** The day the bar is: the readout names it ("Thu, Oct 22"); without it the axis label stands in. */
  date?: Date
  /** Named parts are listed in the readout when a bar has more than one ("Night 8h · Naps 2h 10m"). */
  parts: { value: number; color: string; name?: string }[]
}

/**
 * Stacked bars, one per day, with a y-axis and an average line. The axis runs on round steps (1, 2, 5 × 10ⁿ)
 * so each gridline sits exactly at its label; `integer` keeps count axes on whole numbers. A tap on a bar (or a
 * slide along them, or the arrow keys) shows its value and day above it; a tap away puts it away.
 */
export function StackedBars({ days, unit, formatTick, average, integer = false, valueText, partText }: { days: BarDay[]; unit?: string; formatTick: (v: number) => string; average?: number; integer?: boolean; /** The readout's value ("9 feeds", "445 mL"); the axis format when absent. */ valueText?: (v: number) => string; /** A stacked bar's part in the readout ("Wet 2"); the value's format when absent. */ partText?: (v: number) => string }) {
  const { top: max, ticks } = niceTicks(Math.max(integer ? 1 : 0, ...days.map((d) => d.parts.reduce((s, p) => s + p.value, 0)), average ?? 0) || 1, 4, integer)
  const W = 320
  const H = 160
  const padL = 34
  const padB = 20
  const innerW = W - padL - 6
  const innerH = H - padB - 6
  const gap = 4
  const bw = Math.max(4, innerW / days.length - gap)
  const colX = (i: number) => padL + i * (bw + gap) + gap / 2
  const { ref: pickRef, picked, handlers } = usePick(days.length, (vx) => Math.min(days.length - 1, Math.max(0, Math.floor((vx - padL) / (bw + gap)))), W)
  const say = valueText ?? formatTick
  const text = picked !== null ? barText(days[picked], say, partText) : null
  const topOf = (i: number) => 6 + innerH - (days[i].parts.reduce((s, p) => s + p.value, 0) / max) * innerH
  return (
    <div className="bar-chart">
      <svg
        ref={pickRef}
        className={`bars bars-live${picked !== null ? ' has-pick' : ''}`}
        viewBox={`0 0 ${W} ${H}`}
        role="slider"
        tabIndex={0}
        aria-label={`Daily totals${unit ? ` in ${unit}` : ''}: pick a day`}
        aria-valuemin={1}
        aria-valuemax={days.length}
        aria-valuenow={(picked ?? days.length - 1) + 1}
        aria-valuetext={text ? `${text.value}, ${text.when}${text.change ? `, ${text.change}` : ''}` : `${days.length} days`}
        {...handlers}
      >
        {ticks.map((t, i) => {
          const y = 6 + innerH - (t / max) * innerH
          return (
            <g key={i}>
              <line x1={padL} x2={W - 6} y1={y} y2={y} className="bars-grid" />
              <text x={padL - 6} y={y + 3} className="bars-tick" textAnchor="end">
                {formatTick(t)}
              </text>
            </g>
          )
        })}
        {days.map((d, i) => {
          const x = colX(i)
          let y = 6 + innerH
          return (
            <g key={i} className={i === picked ? 'bar-col bar-on' : 'bar-col'}>
              {d.parts.map((p, j) => {
                const h = (p.value / max) * innerH
                y -= h
                return <rect key={j} x={x} y={y} width={bw} height={h} fill={p.color} rx={j === d.parts.length - 1 ? 3 : 0} />
              })}
              <text x={x + bw / 2} y={H - 6} className="bars-tick" textAnchor="middle">
                {d.label}
              </text>
            </g>
          )
        })}
        {average ? (
          <g className="bars-avg-group">
            <line x1={padL} x2={W - 6} y1={6 + innerH - (average / max) * innerH} y2={6 + innerH - (average / max) * innerH} className="bars-avg" />
            <text x={W - 6} y={Math.max(14, 6 + innerH - (average / max) * innerH - 4)} className="bars-avg-label" textAnchor="end">
              avg {formatTick(average)}
            </text>
          </g>
        ) : null}
      </svg>
      {text && picked !== null ? <ChartTip x={colX(picked) + bw / 2} y={topOf(picked)} W={W} H={H} text={text} /> : null}
    </div>
  )
}

/** Simple line chart for growth points over time. */
export interface LinePoint {
  x: Date
  y: number
}

/** What a tapped point says: the value, when, and (optional) the change since the point before. */
export interface PointText {
  value: string
  when: string
  change?: string | null
  /** A weighing judged against the last check: "needed +17 g · met". */
  check?: { text: string; met: boolean } | null
}

/** A dashed step from the last check to where the rate would have put the next one. */
export interface TargetStep {
  from: LinePoint
  to: LinePoint
}

/**
 * A line over time. The y axis fits the line (and any target steps): a 4 oz gain must read as one. Percentile
 * curves live on the growth chart by age (`GrowthAgeChart`), not here. With `describe`, a tap or a slide along
 * the chart picks the nearest point and shows its value beside it; arrow keys do the same.
 */
export function LineChart({
  points,
  formatY,
  color,
  minSpan,
  steps,
  describe,
  noun = 'reading',
  targets = [],
  tones,
}: {
  points: LinePoint[]
  formatY: (v: number) => string
  color: string
  /** The narrowest y range shown, in the chart's unit. */
  minSpan?: number
  /** Allowed tick steps (ounces on a pounds axis). */
  steps?: number[]
  describe?: (i: number) => PointText
  /** What one point is called in the slider's label: "weighing". */
  noun?: string
  targets?: TargetStep[]
  /** Per point: a check met (the line's colour) or missed (red); null for a point that is not a check. */
  tones?: ('met' | 'missed' | null)[]
}) {
  const g = points.length ? lineGeometry(points, minSpan, steps, formatY, targets) : null
  const { ref: pickRef, picked, handlers } = usePick(
    points.length,
    (vx) => {
      let best = 0
      for (let i = 1; i < points.length; i++) if (g && Math.abs(g.sx(points[i].x.getTime()) - vx) < Math.abs(g.sx(points[best].x.getTime()) - vx)) best = i
      return best
    },
    g?.W ?? 1,
  )
  if (!g) return <p className="muted small" style={{ textAlign: 'center', padding: 16 }}>No measurements yet.</p>
  const { W, H, padL, sx, sy } = g
  const text = picked !== null && describe ? describe(picked) : null
  const px = picked !== null ? sx(points[picked].x.getTime()) : 0
  const py = picked !== null ? sy(points[picked].y) : 0
  return (
    <div className="line-chart">
      <svg
        ref={pickRef}
        className={`bars${describe ? ' lc-live' : ''}`}
        viewBox={`0 0 ${W} ${H}`}
        {...(describe
          ? {
              role: 'slider',
              tabIndex: 0,
              'aria-label': `Pick a ${noun}`,
              'aria-valuemin': 1,
              'aria-valuemax': points.length,
              'aria-valuenow': (picked ?? points.length - 1) + 1,
              'aria-valuetext': text ? `${text.value}, ${text.when}${text.change ? `, ${text.change}` : ''}${text.check ? `, ${text.check.text}` : ''}` : `${points.length} ${noun}s`,
              ...handlers,
            }
          : { role: 'img', 'aria-label': 'Over time' })}
      >
        {g.ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - 10} y1={sy(t)} y2={sy(t)} className="bars-grid" />
            <text x={padL - 6} y={sy(t) + 3} className="bars-tick" textAnchor="end">
              {formatY(t)}
            </text>
          </g>
        ))}
        {targets.map((t, i) => {
          const tx = sx(t.to.x.getTime())
          const ty = sy(t.to.y)
          return (
            <g key={i} className="lc-target-group">
              <path d={`M${sx(t.from.x.getTime()).toFixed(1)},${sy(t.from.y).toFixed(1)} L${tx.toFixed(1)},${ty.toFixed(1)}`} className="lc-target" fill="none" />
              <line x1={tx - 4} x2={tx + 4} y1={ty} y2={ty} className="lc-target-end" />
            </g>
          )
        })}
        {picked !== null ? <line x1={px} x2={px} y1={g.top} y2={g.top + g.innerH} className="lc-cursor" /> : null}
        <path d={pathOf(points, sx, sy)} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={sx(p.x.getTime())}
            cy={sy(p.y)}
            r={i === picked ? 6 : 4}
            fill={tones?.[i] === 'missed' ? 'var(--red)' : color}
            className={[i === picked ? 'lc-dot-on' : '', tones?.[i] ? `lc-dot-${tones[i]}` : ''].filter(Boolean).join(' ') || undefined}
          />
        ))}
        {g.dates.map((t, i) => (
          <text key={t} x={sx(t)} y={H - 6} className="bars-tick" textAnchor={i === 0 ? 'start' : i === g.dates.length - 1 ? 'end' : 'middle'}>
            {new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </text>
        ))}
      </svg>
      {text ? <ChartTip x={px} y={py} W={W} H={H} text={text} /> : null}
    </div>
  )
}

/**
 * The time axis: the first reading to the last. Readings closer than a day apart are padded half a day each
 * side so a single dot sits mid-chart. (It used to stretch to 14 days after the first reading, so two readings
 * from this week sat in the left eighth under dates two weeks ahead.)
 */
function xDomain(xs: number[]): { minX: number; maxX: number } {
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  return hi - lo >= 86_400_000 ? { minX: lo, maxX: hi } : { minX: (lo + hi) / 2 - 43_200_000, maxX: (lo + hi) / 2 + 43_200_000 }
}

function pathOf(pts: LinePoint[], sx: (x: number) => number, sy: (y: number) => number): string {
  return pts.map((q, i) => `${i ? 'L' : 'M'}${sx(q.x.getTime()).toFixed(1)},${sy(q.y).toFixed(1)}`).join(' ')
}

/** Where everything sits. */
function lineGeometry(points: LinePoint[], minSpan: number | undefined, steps: number[] | undefined, formatY: (v: number) => string, targets: TargetStep[] = []) {
  const W = 320
  const H = 190
  const top = 10
  const padB = 22
  const innerH = H - padB - top
  const xs = points.map((p) => p.x.getTime())
  const { minX, maxX } = xDomain(xs)
  const ys = [...points.map((p) => p.y), ...targets.map((t) => t.to.y)]
  const dom = lineDomain(ys, minSpan ?? Math.max(...ys.map(Math.abs)) * 0.05, steps)
  const padL = Math.max(44, Math.max(...dom.ticks.map((t) => formatY(t).length)) * 5.6 + 10)
  const innerW = W - padL - 10
  const sx = (x: number) => padL + ((x - minX) / (maxX - minX)) * innerW
  const sy = (y: number) => top + innerH - ((y - dom.min) / (dom.max - dom.min)) * innerH
  // Two to four dates along the bottom, evenly spaced, so the eye can place a dot in time.
  const days = (maxX - minX) / 86_400_000
  const n = days >= 21 ? 4 : days >= 7 ? 3 : 2
  const dates = Array.from({ length: n }, (_, i) => Math.round(minX + ((maxX - minX) * i) / (n - 1)))
  return { W, H, top, innerH, innerW, padL, sx, sy, ticks: dom.ticks, dates }
}

/** One entry in a chart's key: a short line or swatch drawn like the mark on the chart, and a word or two. */
export interface KeyItem {
  label: string
  /** `line` is a solid line in `color`, `dot` a point, `swatch` a filled band, `target` a check's dashed step. */
  mark: 'line' | 'swatch' | 'dot' | 'target'
  color?: string
}

/** A chart's key in one row under it, in place of a sentence explaining each line. */
export function ChartKey({ items }: { items: KeyItem[] }) {
  return (
    <div className="chart-key" data-testid="chart-key">
      {items.map((it) => (
        <span key={it.label} className="chart-key-item">
          <svg viewBox="0 0 20 10" className="chart-key-mark" aria-hidden>
            {it.mark === 'dot' ? (
              <circle cx="10" cy="5" r="4" fill={it.color} />
            ) : it.mark === 'target' ? (
              <>
                <line x1="1" x2="15" y1="8" y2="3" className="lc-target" />
                <line x1="12" x2="19" y1="3" y2="3" className="lc-target-end" />
              </>
            ) : it.mark === 'swatch' ? (
              <rect x="4" y="1" width="12" height="8" rx="2" fill={it.color} />
            ) : (
              <line x1="2" x2="18" y1="5" y2="5" stroke={it.color} strokeWidth="2.5" strokeLinecap="round" />
            )}
          </svg>
          {it.label}
        </span>
      ))}
    </div>
  )
}

/** A row of tiny bars, one per day, for an overview row; the last day stands out. */
export function Spark({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1e-9, ...values)
  const W = 96
  const H = 28
  const gap = values.length > 14 ? 1 : 2
  const bw = Math.max(1, (W - gap * (values.length - 1)) / values.length)
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      {values.map((v, i) => {
        const h = v > 0 ? Math.max(2, (v / max) * H) : 1.5
        return <rect key={i} x={i * (bw + gap)} y={H - h} width={bw} height={h} rx={bw > 3 ? 1.5 : 0} fill={color} opacity={v > 0 ? (i === values.length - 1 ? 1 : 0.55) : 0.25} />
      })}
    </svg>
  )
}
