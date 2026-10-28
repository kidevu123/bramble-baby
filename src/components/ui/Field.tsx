import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { AGO_OPTIONS, agoChoice, minutesAgo } from '../../lib/quick-log'
import { fromLocalInput, toLocalInput, formatWhen } from '../../lib/time'
import './field.css'

/**
 * A "Start time:  Today, 9:41 AM" row with the value underlined in teal.
 * A null value shows `placeholder` instead: for a time that must be chosen and has no safe default.
 * With `quick`, a row of one-tap chips (Just now · 15 min ago · 30 min ago · 1 h ago) sits under it and
 * hands the chosen time to that callback, so something logged after the fact needs no date picker.
 */
export function TimeField({
  label,
  value,
  onChange,
  max,
  min,
  placeholder = 'Choose a time',
  quick,
  future = false,
}: {
  label: string
  value: Date | null
  onChange: (d: Date) => void
  max?: Date
  min?: Date
  placeholder?: string
  quick?: (d: Date) => void
  /** Only a reminder is set for later: every logged moment is capped at now (set to now, with a note). */
  future?: boolean
}) {
  const [capped, setCapped] = useState(false)
  const pick = (d: Date) => {
    const cap = max ?? (future ? null : new Date())
    if (cap && d.getTime() > cap.getTime() + 60_000) {
      setCapped(true)
      onChange(cap)
    } else {
      setCapped(false)
      onChange(d)
    }
  }
  const row = (
    <label className="time-field">
      <span className="time-field-label">{label}</span>
      <span className="time-field-value">
        {value ? formatWhen(value) : placeholder}
        <input
          type="datetime-local"
          value={value ? toLocalInput(value) : ''}
          min={min ? toLocalInput(min) : undefined}
          max={max ? toLocalInput(max) : undefined}
          onChange={(e) => e.target.value && pick(fromLocalInput(e.target.value))}
          aria-label={label}
        />
      </span>
    </label>
  )
  const note = capped ? (
    <span className="time-field-note" role="status">
      That was in the future · set to now
    </span>
  ) : null
  if (!quick)
    return (
      <>
        {row}
        {note}
      </>
    )
  return (
    <div className="time-field-quick">
      {row}
      {note}
      <AgoChips
        value={value}
        onPick={(d) => {
          // A chip is always in the past: the "set to now" note from an earlier hand-set time no longer applies.
          setCapped(false)
          quick(d)
        }}
        label={`${label.replace(/:\s*$/, '')} shortcuts`}
      />
    </div>
  )
}

/** One-tap "when" chips; the one the current time came from reads as chosen. */
export function AgoChips({ value, onPick, label }: { value: Date | null; onPick: (d: Date) => void; label: string }) {
  const active = agoChoice(value)
  return (
    <div className="ago-chips" role="group" aria-label={label}>
      {AGO_OPTIONS.map((o) => (
        <button key={o.minutes} type="button" className={active === o.minutes ? 'ago-chip active' : 'ago-chip'} aria-pressed={active === o.minutes} onClick={() => onPick(minutesAgo(o.minutes))}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The FieldGroup a field sits in: its title (which may already name the value) and the title's id. */
const GroupContext = createContext<{ title: string; titleId: string } | null>(null)

const firstWord = (s: string) => s.trim().split(/[\s(]/)[0].toLowerCase()

/**
 * A field inside a FieldGroup whose title already names the value ("Weight (lb)" over "Weight in lb",
 * "Temperature (°F)" over "Temperature") says it once: the field's own label stays for screen readers only.
 * `hideLabel` forces that anywhere; `hideLabel={false}` keeps a label the group title happens to echo.
 */
function useLabelShown(label: string, hideLabel: boolean | undefined) {
  const group = useContext(GroupContext)
  if (hideLabel !== undefined) return !hideLabel
  return !(group && firstWord(group.title) === firstWord(label))
}

export function TextField({ label, hint, hideLabel, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; hideLabel?: boolean }) {
  const shown = useLabelShown(label, hideLabel)
  return (
    <label className="text-field">
      <span className={shown ? 'text-field-label' : 'sr-only'}>{label}</span>
      <input className="text-input" {...rest} />
      {hint ? <span className="xs muted">{hint}</span> : null}
    </label>
  )
}

export function TextArea({ label, value, onChange, placeholder, hideLabel }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hideLabel?: boolean }) {
  const shown = useLabelShown(label, hideLabel)
  return (
    <label className="text-field">
      <span className={shown ? 'text-field-label' : 'sr-only'}>{label}</span>
      <textarea className="text-input text-area" rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export function FieldGroup({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  const titleId = useId()
  return (
    <section className="field-group" aria-labelledby={titleId}>
      <h3 className="field-group-title" id={titleId}>
        {title}
      </h3>
      {hint ? <p className="field-group-hint">{hint}</p> : null}
      <GroupContext.Provider value={{ title, titleId }}>{children}</GroupContext.Provider>
    </section>
  )
}

/** A choice row is named by the FieldGroup it sits in (VoiceOver reads "Reaction, radio group"). */
function useGroupName(label: string | undefined) {
  const group = useContext(GroupContext)
  return label ? { 'aria-label': label } : group ? { 'aria-labelledby': group.titleId } : {}
}

/**
 * True while a horizontally scrolling row has more to show to the right: only then does its edge fade
 * (a fade on a row that fits made the last option look cut off).
 */
function useMoreToRight<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [more, setMore] = useState(false)
  const check = useCallback(() => {
    const el = ref.current
    if (el) setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 2)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    check()
    // Older WebKit and the test DOM have no ResizeObserver: the row is then measured once, which is enough there.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [check])
  return { ref, more, check }
}

/** Circular option chips (Pee / Poo / Mixed / Dry). */
export function CircleChoice<T extends string>({
  options,
  value,
  onChange,
  toneClass,
  label,
}: {
  options: { value: T; label: string; icon: ReactNode; toneClass?: string }[]
  value: T | null
  onChange: (v: T) => void
  toneClass: string
  /** Accessible name; inside a FieldGroup the group's title names it. */
  label?: string
}) {
  const name = useGroupName(label)
  const { ref, more, check } = useMoreToRight<HTMLDivElement>()
  return (
    <div ref={ref} className={more ? 'circle-choice more' : 'circle-choice'} role="radiogroup" {...name} onScroll={check}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={active ? `circle-opt active ${o.toneClass ?? toneClass}` : 'circle-opt'}
            onClick={() => onChange(o.value)}
          >
            <span className="circle-opt-icon">{o.icon}</span>
            <span className="circle-opt-label">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Rectangular pill choices (Breast milk / Formula …). */
export function PillChoice<T extends string>({
  options,
  value,
  onChange,
  tone = 'teal',
  label,
}: {
  options: { value: T; label: string }[]
  value: T | null
  onChange: (v: T) => void
  tone?: 'teal' | 'orange' | 'green' | 'purple'
  /** Accessible name; inside a FieldGroup the group's title names it. */
  label?: string
}) {
  const name = useGroupName(label)
  return (
    <div className="pill-choice" role="radiogroup" {...name}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? `pill-opt active pill-${tone}` : 'pill-opt'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
