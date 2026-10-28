import { format } from 'date-fns'
import { useEffect, useRef } from 'react'
import { PillChoice, TimeField } from '../../components/ui/Field'
import { ValueField } from './LogFields'
import { Toggle } from '../../components/ui/Toggle'
import type { MilkBag, MilkLocation, MilkWindows } from '../../lib/api/companion'
import { bagState, bagVolume, formatTimeLeft, intakeExpiry, intakeProblem, THAWED_HOURS, windowLabel, type IntakeDraft } from '../../lib/milk'
import { formatAgo } from '../../lib/time'
import { volumeLabel, type VolumeUnit } from '../../lib/units'
import './log.css'
import './milk-label.css'

interface Props {
  draft: IntakeDraft
  onChange: (next: IntakeDraft) => void
  unit: VolumeUnit
  windows: MilkWindows
  now: Date
  /** Containers added since the sheet was opened, oldest first. */
  added: MilkBag[]
  /** What the container before this one held, offered as a one-tap fill. */
  lastAmountText: string | null
  /** The draft is a container whose save never came back; `onStartFresh` drops it for a blank one. */
  restored: boolean
  onStartFresh: () => void
  disabled: boolean
}

const LOCATIONS: { value: MilkLocation; label: string }[] = [
  { value: 'fridge', label: 'Fridge' },
  { value: 'freezer', label: 'Freezer' },
  { value: 'room', label: 'Room temp' },
]

/**
 * The fields the label sheet asks for when milk already exists and has no pumping entry: how much, when
 * it was pumped, where it is now and, for milk that was frozen, when it thawed. It only collects them;
 * the label sheet registers the bag (the one creation path) and shows the label.
 */
export function MilkIntakeForm({ draft, onChange, unit, windows, now, added, lastAmountText, restored, onStartFresh, disabled }: Props) {
  const set = (patch: Partial<IntakeDraft>) => onChange({ ...draft, ...patch })
  const setLocation = (location: MilkLocation) => set(location === 'freezer' ? { location, thawed: false, thawedAt: null } : { location })
  const canFillLast = lastAmountText !== null && draft.amountText === ''
  const formRef = useRef<HTMLElement>(null)
  const thawRef = useRef<HTMLDivElement>(null)
  // Each container starts at the top with the volume ready to type. The sheet does this itself when it
  // opens (the dialog is not open yet when this runs); the next containers start here, mid-sheet.
  useEffect(() => {
    const form = formRef.current
    if (!form?.closest('dialog')?.open) return
    form.closest('.sheet-body')?.scrollTo({ top: 0 })
    form.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
  }, [])
  const setThawed = (thawed: boolean) => {
    set(thawed ? { thawed } : { thawed, thawedAt: null })
    // The thaw time appears below the fold on a phone; bring it up so the next step is in view.
    if (thawed) requestAnimationFrame(() => thawRef.current?.scrollIntoView({ block: 'center' }))
  }
  return (
    <section ref={formRef} className="stack intake-form" aria-label="Milk you already have">
      {added.length === 0 ? (
        <p className="small muted">
          For milk that was pumped earlier, like bottles sent home from the hospital. Each container gets its own code and label, and its time left counts from when it was pumped.
        </p>
      ) : null}
      {restored ? (
        <p className="intake-note small" role="status">
          The last container did not finish saving, so it is filled in again here. Tap Add to stash to finish it.{' '}
          <button type="button" className="link-btn" onClick={onStartFresh}>
            Start a new one instead
          </button>
        </p>
      ) : null}
      {added.length ? (
        <div className="intake-added" role="status">
          <span className="xs strong">
            {added.length} added so far
          </span>
          <ul>
            {added.map((bag) => (
              <li key={bag.id} className="xs">
                {bagVolume(bag, unit)} <span className="muted">· {bag.code}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card card-pad stack stash-card">
        {/* "Volume [ 120 ] mL" in one box, as on the pumping sheet and the pumping timer. */}
        <ValueField
          label="Volume"
          unit={volumeLabel(unit)}
          name={`Volume in ${volumeLabel(unit)}`}
          type="number"
          inputMode="decimal"
          step="0.25"
          min={0}
          value={draft.amountText}
          onChange={(e) => set({ amountText: e.target.value })}
          placeholder="0"
          disabled={disabled}
          data-autofocus=""
        />
        {canFillLast ? (
          <button type="button" className="intake-same" onClick={() => set({ amountText: lastAmountText })} disabled={disabled}>
            Same as the last one: {lastAmountText} {volumeLabel(unit)}
          </button>
        ) : null}

        <TimeField label="Pumped:" value={draft.pumpedAt} max={now} onChange={(pumpedAt) => set({ pumpedAt })} />

        <div className="stack intake-where">
          <span className="text-field-label">Where is it now?</span>
          <PillChoice tone="teal" value={draft.location} onChange={setLocation} options={LOCATIONS} />
        </div>

        {draft.location !== 'freezer' ? (
          <div className="intake-thawed">
            <span>
              It was frozen and has thawed
              <span className="xs muted intake-thawed-hint">Thawed milk keeps {THAWED_HOURS.fridge} hours in the fridge and is never refrozen.</span>
            </span>
            <Toggle label="It was frozen and has thawed" checked={draft.thawed} onChange={setThawed} />
          </div>
        ) : null}
        <div ref={thawRef} className="stack">
          {draft.thawed ? <TimeField label="Thawed:" value={draft.thawedAt} min={draft.pumpedAt} max={now} onChange={(thawedAt) => set({ thawedAt })} placeholder="Choose when" /> : null}
          <IntakeOutlook draft={draft} windows={windows} now={now} />
        </div>
      </div>
    </section>
  )
}

/** How long this container keeps, said before it is saved: good until, expiring soon, or already past its window. */
function IntakeOutlook({ draft, windows, now }: { draft: IntakeDraft; windows: MilkWindows; now: Date }) {
  // While a time is missing or impossible there is nothing true to say here; the sheet's footer names the problem.
  if (intakeProblem({ ...draft, amountText: '1' }, now)) return null
  const expires = intakeExpiry(draft, windows)
  if (!expires) return null
  const state = bagState({ expires_at: expires.toISOString(), location: draft.location }, now)
  const rule = windowLabel(draft.location, draft.thawed, windows)
  const until = format(expires, 'EEE MMM d, h:mm a')
  if (state === 'expired') {
    return (
      <p className="intake-outlook small state-expired" role="alert">
        <span className="strong">Already past its storage window.</span> It expired {until} ({formatAgo(expires, now)}), counted from when it was {draft.thawed ? 'thawed' : 'pumped'}: {rule}.
      </p>
    )
  }
  return (
    <p className={`intake-outlook small state-${state}`} role="status">
      <span className="strong">
        Good until {until} · {formatTimeLeft(expires.getTime() - now.getTime())}
      </span>
      <span className="xs intake-outlook-why">
        {state === 'soon' ? 'Expiring soon: use it first. ' : ''}
        Counted from when it was {draft.thawed ? 'thawed' : 'pumped'}: {rule}.
      </span>
    </p>
  )
}
