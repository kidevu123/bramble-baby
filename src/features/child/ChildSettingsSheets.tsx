import { format } from 'date-fns'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FieldGroup, TextField } from '../../components/ui/Field'
import { PillChoice } from '../../components/ui/Field'
import { Sheet } from '../../components/ui/Sheet'
import { Toggle } from '../../components/ui/Toggle'
import { useChildSettings } from '../../hooks/useChildSettings'
import type { Child } from '../../lib/api/types'
import { ageBasis, judgedMonths } from '../../lib/preterm'
import { formatDurationShort } from '../../lib/time'
import { ageWakeWindow } from '../../lib/nap-window'
import { buildSchedule, ageStageLabel } from '../../lib/schedule'
import { NotificationStatus } from '../notifications/NotificationStatus'
import { clock12 } from '../reports/format'
import '../plans/plans.css'
import './child.css'

/** Nap window settings: notifications lead time, wake-window nudge, naps override. */
export function NapSettingsSheet({ open, child, onClose }: { open: boolean; child: Child; onClose: () => void }) {
  const { settings, update } = useChildSettings(child.id)
  const ss = settings.sweetSpot
  const set = (patch: Partial<typeof ss>) => update((latest) => ({ sweetSpot: { ...ss, ...latest.sweetSpot, ...patch } }))
  const months = judgedMonths(ageBasis(child, settings)) // corrected age for a baby born early
  const age = ageWakeWindow(months)
  return (
    <Sheet
      open={open}
      title="Nap window settings"
      onClose={onClose}
      footer={
        <Button size="lg" block onClick={onClose}>
          Done
        </Button>
      }
    >
      <NotificationStatus child={child.id} />
      <div className="customize-row" style={{ borderBottom: 0 }}>
        <span>
          <span className="strong">Nap window alerts</span>
          <span className="small muted" style={{ display: 'block' }}>
            Notify before and at the predicted nap time
          </span>
        </span>
        <Toggle checked={ss.notify} onChange={(v) => set({ notify: v })} label="Nap window alerts" />
      </div>
      {/* Five choices per row, one row each: no orphan chip on a second line. */}
      <div className="stack ss-pills">
      <FieldGroup title="Heads-up before the nap window">
        <PillChoice tone="teal" value={String(ss.leadMinutes) as '5' | '10' | '15' | '20' | '30'} onChange={(v) => set({ leadMinutes: Number(v) })} options={[{ value: '5', label: '5 min' }, { value: '10', label: '10 min' }, { value: '15', label: '15 min' }, { value: '20', label: '20 min' }, { value: '30', label: '30 min' }]} />
      </FieldGroup>
      <FieldGroup title="Wake window nudge" hint={`Typical for ${ageStageLabel(months)}: ${formatDurationShort(age.minMinutes * 60)} – ${formatDurationShort(age.maxMinutes * 60)}. Shift the prediction if ${child.first_name} runs shorter or longer.`}>
        <PillChoice tone="teal" value={String(ss.wakeWindowAdjustMinutes) as '-30' | '-15' | '0' | '15' | '30'} onChange={(v) => set({ wakeWindowAdjustMinutes: Number(v) })} options={[{ value: '-30', label: '−30m' }, { value: '-15', label: '−15m' }, { value: '0', label: 'Auto' }, { value: '15', label: '+15m' }, { value: '30', label: '+30m' }]} />
      </FieldGroup>
      <FieldGroup title="Naps per day" hint="Used by the Schedule Creator. Auto follows age.">
        <PillChoice tone="teal" value={ss.napsPerDayOverride === null ? 'auto' : String(ss.napsPerDayOverride)} onChange={(v) => set({ napsPerDayOverride: v === 'auto' ? null : Number(v) })} options={[{ value: 'auto', label: `Auto (${age.napsPerDay})` }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }]} />
      </FieldGroup>
      </div>
    </Sheet>
  )
}

/** The Schedule Creator: a suggested day from wake time, wake windows and nap count. */
export function ScheduleCreatorSheet({ open, child, onClose }: { open: boolean; child: Child; onClose: () => void }) {
  const { settings } = useChildSettings(child.id)
  const months = judgedMonths(ageBasis(child, settings)) // corrected age for a baby born early
  const [wake, setWake] = useState('07:00')
  // Follows Nap window settings' "Naps per day" (also when it changes while this tab stays open) until a
  // count is picked here for this sample day.
  const [picked, setNaps] = useState<number | 'auto' | null>(null)
  const naps = picked === null ? (settings.sweetSpot.napsPerDayOverride ?? undefined) : picked === 'auto' ? undefined : picked
  const age = ageWakeWindow(months)
  const items = buildSchedule({ ageMonths: months, wakeTime: wake, napsPerDay: naps, wakeWindowMinutes: Math.round((age.minMinutes + age.maxMinutes) / 2 + settings.sweetSpot.wakeWindowAdjustMinutes), includeFeeds: months < 6 })
  return (
    <Sheet
      open={open}
      title="Schedule Creator"
      onClose={onClose}
      footer={
        <Button size="lg" block onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className="small muted">A sample day for {child.first_name}, {ageStageLabel(months)}. Adjust wake time and nap count; the nap prediction still adapts live during the day.</p>
      <div className="schedule-controls">
        <TextField label="Wake time" type="time" value={wake} onChange={(e) => setWake(e.target.value)} />
        <FieldGroup title="Naps">
          <PillChoice tone="teal" value={naps === undefined ? 'auto' : String(naps)} onChange={(v) => setNaps(v === 'auto' ? 'auto' : Number(v))} options={[{ value: 'auto', label: 'Auto' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }]} />
        </FieldGroup>
      </div>
      <ul className="plan-schedule">
        {items.map((s, i) => (
          <li key={i} className={`plan-slot kind-${s.kind}`}>
            <span className="plan-slot-time">
              {clock12(s.start)}
              {s.end ? ` – ${clock12(s.end)}` : ''}
            </span>
            <span className="grow">
              <span className="strong">{s.label}</span>
              {s.note ? <span className="xs muted" style={{ display: 'block' }}>{s.note}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

/** Day vs night cut-offs, with a timeline bar. */
export function DayNightCard({ child }: { child: Child }) {
  const { settings, update } = useChildSettings(child.id)
  const toMin = (t: string) => Number(t.split(':')[0]) * 60 + Number(t.split(':')[1] ?? 0)
  const startMin = toMin(settings.dayStart)
  const endMin = toMin(settings.dayEnd)
  const left = ((startMin - 6 * 60) / (16 * 60)) * 100
  const width = ((endMin - startMin) / (16 * 60)) * 100
  const fmt = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
  }
  return (
    <section className="card card-pad stack">
      <h3>Day and night</h3>
      <p className="small muted">Events between these times count as day, the rest as night.</p>
      <div className="dn-row">
        <label className="dn-box">
          <span className="dn-value">{fmt(settings.dayStart)}</span>
          <span className="dn-label">START</span>
          <input type="time" value={settings.dayStart} onChange={(e) => e.target.value && update({ dayStart: e.target.value })} aria-label="Day start" />
        </label>
        <span className="dn-arrow">→</span>
        <label className="dn-box">
          <span className="dn-value">{fmt(settings.dayEnd)}</span>
          <span className="dn-label">END</span>
          <input type="time" value={settings.dayEnd} onChange={(e) => e.target.value && update({ dayEnd: e.target.value })} aria-label="Day end" />
        </label>
      </div>
      <div className="dn-track">
        <div className="dn-fill" style={{ left: `${Math.max(0, left)}%`, width: `${Math.max(4, Math.min(100 - Math.max(0, left), width))}%` }}>
          ☀ Day Sleep
        </div>
      </div>
      <div className="dn-scale">
        {['6AM', '8AM', '10AM', '12PM', '2PM', '4PM', '6PM', '8PM', '10PM'].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </section>
  )
}

/**
 * The pediatrician's weight-gain goal in grams a day, and the day it was given. Reports › Summary › Growth
 * measures the gain since that day against it, in grams with the ounce beside it, so "20 g a day" is checkable
 * from a phone that shows pounds; weeks before it (the NICU, the regain of birth weight) do not count. Empty
 * goal means the age-typical band is used instead.
 */
export function WeightGoalCard({ child }: { child: Child }) {
  const { settings, update } = useChildSettings(child.id)
  const goal = settings.weightGoalGPerDay ?? null
  const since = settings.weightGoalSince ?? ''
  const today = format(new Date(), 'yyyy-MM-dd')
  // Typing "20" is one save, not two: the field keeps its own text and commits when it loses focus, on
  // Enter, or after a short pause (so leaving the app mid-edit still keeps the number).
  const [text, setText] = useState(goal === null ? '' : String(goal))
  const editing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!editing.current) setText(goal === null ? '' : String(goal))
  }, [goal])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const commit = (value: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = parseGoal(value)
    if (next === goal) return
    // A goal entered for the first time starts today unless a day is already set.
    update(goal === null && next !== null && !since ? { weightGoalGPerDay: next, weightGoalSince: today } : { weightGoalGPerDay: next })
  }
  return (
    <section className="card card-pad stack" data-testid="weight-goal">
      <h3>Weight gain goal</h3>
      <label className="goal-row">
        <input
          className="text-input goal-input"
          type="number"
          inputMode="numeric"
          min={1}
          max={200}
          placeholder="e.g. 20"
          value={text}
          aria-label="Weight gain goal in grams a day"
          onFocus={() => {
            editing.current = true
          }}
          onChange={(e) => {
            const value = e.target.value
            setText(value)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => commit(value), 1200)
          }}
          onBlur={(e) => {
            editing.current = false
            commit(e.target.value)
            const next = parseGoal(e.target.value)
            setText(next === null ? '' : String(next))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        <span className="small">g a day</span>
      </label>
      {goal !== null ? (
        <label className="goal-row">
          <span className="small">Since</span>
          <input
            className="text-input goal-date"
            type="date"
            max={today}
            value={since}
            aria-label="Day the doctor gave the goal"
            onChange={(e) => {
              const v = e.target.value
              if (v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today)) update({ weightGoalSince: v || null })
            }}
          />
        </label>
      ) : null}
      <p className="small muted">The pediatrician's grams a day and the day they gave it. Reports › Growth counts the gain from that day; the weeks before it (the NICU) don't count. Empty: the typical range for the age.</p>
    </section>
  )
}

/** The goal field text as grams a day: empty or nonsense is no goal, the rest is rounded and capped at 200. */
function parseGoal(value: string): number | null {
  const n = Number(value)
  return value.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : Math.min(200, Math.round(n))
}
