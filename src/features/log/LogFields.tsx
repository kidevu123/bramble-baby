import { useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { TimeField } from '../../components/ui/Field'
import { PlayIcon } from '../../components/icons'
import { formatDurationShort } from '../../lib/time'

/**
 * The log sheets' shared field shapes, so the same kind of field looks the same in every sheet:
 * - `ValueField`: the number someone types (volume, weight, minutes), its label, the number and its unit on one row.
 * - `TimePair`: a session's start and end side by side, its length between them, the one-tap chips under both.
 * - `NoteField`: notes behind one quiet "Add a note" line until there is something in them.
 * - `LaunchRow`: a tappable card with an icon (start a live timer, open a running one).
 */

/** "Volume [ 90 ] mL" in one box. `label` is what shows; `name` is the accessible name ("Volume in mL"). */
export function ValueField({ label, unit, name, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; unit?: string; name: string }) {
  return (
    <label className="value-field">
      <span className="value-field-label" aria-hidden>
        {label}
      </span>
      <input className="value-field-input" aria-label={name} {...rest} />
      {unit ? (
        <span className="value-field-unit" aria-hidden>
          {unit}
        </span>
      ) : null}
    </label>
  )
}

/**
 * Started | length | Finished on one row. Each half is the whole tap target of its time picker; the chips
 * (`quick`, a new entry only) move the whole session and keep its length. `hint` is one quiet line under it.
 */
export function TimePair({
  startLabel,
  endLabel,
  start,
  end,
  onStart,
  onEnd,
  quick,
  showLength = true,
  hint,
  children,
}: {
  startLabel: string
  endLabel: string
  start: Date
  end: Date
  onStart: (d: Date) => void
  onEnd: (d: Date) => void
  quick?: (d: Date) => void
  /** The length between the two times; off where a typed duration field already says it. */
  showLength?: boolean
  hint?: string | null
  /** Notes about the times (a refused or capped time), under the chips. */
  children?: ReactNode
}) {
  const seconds = (end.getTime() - start.getTime()) / 1000
  return (
    <section className="time-pair-group" aria-label="Time">
      <div className="time-pair">
        <TimeField label={startLabel} value={start} onChange={onStart} />
        <TimeField label={endLabel} value={end} onChange={onEnd} quick={quick} />
        {showLength && seconds > 0 ? (
          <span className="time-pair-length">
            {formatDurationShort(seconds)}
          </span>
        ) : null}
      </div>
      {hint ? <p className="log-hint">{hint}</p> : null}
      {children}
    </section>
  )
}

/** Notes: a quiet "Add a note" until opened; open from the start when there already is one. */
export function NoteField({ label = 'Notes', addLabel = 'Add a note', value, onChange, placeholder }: { label?: string; addLabel?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(() => value.trim() !== '')
  if (!open && value.trim() === '')
    return (
      <button type="button" className="note-add" onClick={() => setOpen(true)}>
        + {addLabel}
      </button>
    )
  return (
    <label className="text-field">
      <span className="text-field-label">{label}</span>
      {/* Opened by a tap: the field takes the focus at once (the dialog is already open). */}
      <textarea className="text-input text-area" rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoFocus={!value} />
    </label>
  )
}

/** A tappable card: an icon, a strong line and a short muted one under it. */
export function LaunchRow({ tone, icon = <PlayIcon />, title, sub, onClick, disabled, className = '' }: { tone: string; icon?: ReactNode; title: string; sub?: ReactNode; onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button type="button" className={`launch-row soft-${tone} ${className}`.trim()} onClick={onClick} disabled={disabled}>
      <span className={`icon-circle sm tone-${tone}`} aria-hidden>
        {icon}
      </span>
      <span className="launch-row-text">
        <span className={`strong text-${tone}`}>{title}</span>
        {sub ? <span className="launch-row-sub">{sub}</span> : null}
      </span>
    </button>
  )
}
