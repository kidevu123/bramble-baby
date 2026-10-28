import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Segmented } from '../../components/ui/Segmented'
import type { Pumping } from '../../lib/api/types'
import { morningNote, pumpCaution, type PumpComparison } from '../../lib/pumps'
import { About } from '../../components/ui/About'
import { formatVolume, volumeLabel, type VolumeUnit } from '../../lib/units'
import { niceTicks } from './format'
import { ChartTip } from './charts'
import { usePick } from './usePick'
import { TagPumpsSheet } from './TagPumpsSheet'

type Metric = 'session' | 'minute'
const W = 320
const H = 190
const PAD_L = 34
const PAD_R = 8
const PAD_T = 22 // room for the value above the tallest bar
const AXIS_H = 34 // name + session count under the bars
const GAP = 14

/**
 * Which pump does best: one bar per pump, the number on top, the name and session count underneath.
 * Per session (the default) or per minute of pumping. The best pump is the full-colour bar; the rest are
 * lighter. Sessions logged without a pump are counted under the chart with a way to tag them, since the
 * comparison is only as good as the share of sessions that name their pump.
 */
export function PumpChart({ compared, unit, untagged, child }: { compared: PumpComparison; unit: VolumeUnit; untagged: Pumping[]; child: number }) {
  const [metric, setMetric] = useState<Metric>('session')
  const [tagging, setTagging] = useState(false)
  const pumps = [...compared.pumps].sort((a, b) => (metric === 'session' ? b.avgAmount - a.avgAmount : b.perMinute - a.perMinute))
  const value = (p: PumpComparison['pumps'][number]) => (metric === 'session' ? p.avgAmount : p.perMinute)
  const label = (v: number) => (metric === 'session' ? formatVolume(v, unit) : `${v.toFixed(unit === 'oz' ? 2 : 1)}`)
  // The yardstick: the average over every session in the range, the untagged ones included.
  const everyPoint = [...compared.pumps.flatMap((p) => p.points), ...compared.untrackedPoints]
  const overall = everyPoint.length
    ? metric === 'session'
      ? everyPoint.reduce((s, p) => s + p.amount, 0) / everyPoint.length
      : everyPoint.reduce((s, p) => s + p.amount, 0) / everyPoint.reduce((s, p) => s + p.minutes, 0)
    : 0
  const caution = pumpCaution(compared)
  const morning = pumps.length > 1 ? pumps.map((p) => ({ p, note: morningNote(p) })).filter((x) => x.note) : []

  return (
    <div className="stack pc" data-metric={metric}>
      <Segmented
        label="Compare pumps by"
        size="sm"
        value={metric}
        onChange={setMetric}
        options={[
          { value: 'session', label: `${volumeLabel(unit)} per session` },
          { value: 'minute', label: `${volumeLabel(unit)} per minute` },
        ]}
      />
      {pumps.length ? <PumpBars key={metric} pumps={pumps} metric={metric} unit={unit} overall={overall} value={value} label={label} /> : null}
      {pumps.length && overall > 0 ? (
        // The average's label lives in this key under the chart, never on the plot where the bar values are.
        <p className="xs muted pc-legend">
          <svg className="pc-avg-key" viewBox="0 0 24 8" aria-hidden>
            <line x1="0" x2="24" y1="4" y2="4" className="pc-avg-keyline" />
          </svg>
          <span className="pc-avg-label">All sessions avg {label(overall)}</span>
        </p>
      ) : null}
      {caution ? (
        <p className="small" style={{ margin: 0 }}>
          {caution}
        </p>
      ) : null}

      {untagged.length ? (
        <div className="pc-untagged">
          <span className="small">
            {untagged.length} session{untagged.length === 1 ? '' : 's'} without a pump recorded
          </span>
          <Button variant="secondary" onClick={() => setTagging(true)}>
            Tag them
          </Button>
        </div>
      ) : null}
      {pumps.length ? (
        <About>
          {overall > 0 ? <p>The dashed line is the average over every session in the range{untagged.length ? ', the untagged ones included' : ''}. A pump above it does better than usual.</p> : null}
          {morning.length ? <p data-testid="pump-morning">{morning.map((m) => `${m.p.name}: ${m.note}`).join(' · ')}. The first pump of the morning gets more whatever the brand.</p> : null}
          <p>A longer session also gets more, so compare per minute too.</p>
        </About>
      ) : null}
      <TagPumpsSheet open={tagging} onClose={() => setTagging(false)} sessions={untagged} child={child} unit={unit} />
    </div>
  )
}

type Pump = PumpComparison['pumps'][number]

/**
 * The bars themselves: one per pump, its number on top. A tap on a bar (or a slide, or the arrow keys) shows that
 * pump's sessions, best session and usual length above it; a tap away puts it away. Keyed on the metric, so a
 * switch (which re-ranks the bars) closes the readout instead of moving it to another pump.
 */
function PumpBars({ pumps, metric, unit, overall, value, label }: { pumps: Pump[]; metric: Metric; unit: VolumeUnit; overall: number; value: (p: Pump) => number; label: (v: number) => string }) {
  // Round axis steps, so each gridline sits at its label.
  const { top: max, ticks } = niceTicks(Math.max(...pumps.map(value), overall) || 1, 3)
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - AXIS_H
  const bw = Math.min(72, (innerW - GAP * (pumps.length + 1)) / Math.max(1, pumps.length))
  const x0 = PAD_L + (innerW - (bw * pumps.length + GAP * (pumps.length - 1))) / 2
  const y = (v: number) => PAD_T + innerH - (v / max) * innerH
  const tick = (v: number) => (metric === 'session' ? String(Math.round(v * 10) / 10) : String(Math.round(v * 100) / 100))
  const centre = (i: number) => x0 + i * (bw + GAP) + bw / 2
  const { ref: pickRef, picked, handlers } = usePick(
    pumps.length,
    (vx) => pumps.reduce((best, _p, i) => (Math.abs(centre(i) - vx) < Math.abs(centre(best) - vx) ? i : best), 0),
    W,
  )
  const per = metric === 'session' ? 'per session' : 'per minute'
  const p = picked !== null ? pumps[picked] : null
  const text = p
    ? {
        value: `${label(value(p))}${metric === 'minute' ? ` ${volumeLabel(unit)}` : ''} ${per}`,
        when: `${p.name} · ${p.sessions} session${p.sessions === 1 ? '' : 's'}`,
        change:
          metric === 'session'
            ? `Best ${formatVolume(p.bestAmount, unit)} · usually ${Math.round(p.avgMinutes)} min`
            : `${formatVolume(p.avgAmount, unit)} a session · usually ${Math.round(p.avgMinutes)} min`,
      }
    : null
  return (
    <div className="bar-chart">
      <svg
        ref={pickRef}
        className={`pc-svg bars-live${picked !== null ? ' has-pick' : ''}`}
        viewBox={`0 0 ${W} ${H}`}
        role="slider"
        tabIndex={0}
        aria-label={`Average ${volumeLabel(unit)} ${per} by pump: pick a pump`}
        aria-valuemin={1}
        aria-valuemax={pumps.length}
        aria-valuenow={(picked ?? 0) + 1}
        aria-valuetext={text ? `${text.value}, ${text.when}, ${text.change}` : `${pumps.length} pumps`}
        {...handlers}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} className="pc-grid" />
            <text x={PAD_L - 6} y={y(t) + 3} className="pc-tick" textAnchor="end">
              {tick(t)}
            </text>
          </g>
        ))}
        {overall > 0 ? <line x1={PAD_L} x2={W - PAD_R} y1={y(overall)} y2={y(overall)} className="pc-avg" /> : null}
        {pumps.map((pump, i) => {
          const x = x0 + i * (bw + GAP)
          const top = y(value(pump))
          return (
            <g key={pump.name} className={`pc-bar bar-col${i === 0 ? ' best' : ''}${i === picked ? ' bar-on' : ''}`} data-pump={pump.name}>
              <rect x={x} y={top} width={bw} height={PAD_T + innerH - top} rx={6} />
              <text x={x + bw / 2} y={top - 7} className="pc-value" textAnchor="middle">
                {label(value(pump))}
              </text>
              <text x={x + bw / 2} y={H - AXIS_H + 15} className="pc-name" textAnchor="middle">
                {pump.name}
              </text>
              <text x={x + bw / 2} y={H - AXIS_H + 28} className="pc-count" textAnchor="middle">
                {pump.sessions} session{pump.sessions === 1 ? '' : 's'}
              </text>
            </g>
          )
        })}
      </svg>
      {text && picked !== null ? <ChartTip x={centre(picked)} y={y(value(pumps[picked])) - 18} W={W} H={H} text={text} /> : null}
    </div>
  )
}
