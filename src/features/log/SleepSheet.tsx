import { useState } from 'react'
import { Segmented } from '../../components/ui/Segmented'
import { NoteField, TimePair } from './LogFields'
import { useChildSettings } from '../../hooks/useChildSettings'
import { sleep as sleepApi } from '../../lib/api/endpoints'
import type { Child, Sleep } from '../../lib/api/types'
import { sessionEndingAt } from '../../lib/quick-log'
import type { QuickPrefill } from '../../lib/quick-text'
import { isDaytime, parseDate, toIso } from '../../lib/time'
import { SheetFooter } from './SheetFooter'
import { useSaver } from './useSaver'
import { TimerLaunch } from './TimerLaunch'

export function SleepSheet({ child, editing, prefill, onClose }: { child: Child; editing: Sleep | null; prefill?: Extract<QuickPrefill, { kind: 'sleep' }>; onClose: () => void }) {
  const { settings } = useChildSettings(child.id)
  // A Type it line can name a wake time still to come ("slept 1pm for 2h" at 2 PM): capped at now, and said so.
  const [prefillCapped, setPrefillCapped] = useState(() => !editing && prefill?.end !== undefined && prefill.end.getTime() > Date.now() + 60_000)
  const [end, setEnd] = useState<Date>(() => (editing ? parseDate(editing.end) : prefill?.end && !prefillCapped ? prefill.end : new Date()))
  const [start, setStart] = useState<Date>(() => (editing ? parseDate(editing.start) : prefill?.start ?? new Date(end.getTime() - 30 * 60_000)))
  // Nap vs night follows the child's day/night cut-offs from the profile, not a fixed 6–19.
  // Nap or night follows the fall-asleep time (a night typed in by hand is not a nap) until it is picked by hand.
  const [picked, setPicked] = useState<'nap' | 'night' | null>(() => (editing ? (editing.nap ? 'nap' : 'night') : prefill?.nap !== undefined ? (prefill.nap ? 'nap' : 'night') : null))
  const kind = picked ?? (isDaytime(start, settings.dayStart, settings.dayEnd) ? 'nap' : 'night')
  const [notes, setNotes] = useState(editing?.notes ?? prefill?.notes ?? '')
  const { run, busy, error } = useSaver(child.id, onClose)
  const invalid = end.getTime() <= start.getTime()
  /** "Woke up 30 min ago": the whole sleep moves, its length stays. */
  const wokeAt = (at: Date) => {
    const moved = sessionEndingAt(start, end, at)
    setPrefillCapped(false)
    setStart(moved.start)
    setEnd(moved.end)
  }

  const body = { child: child.id, start: toIso(start), end: toIso(end), nap: kind === 'nap', notes }
  return (
    <>
      {!editing ? <TimerLaunch child={child} name="sleep" tone="sleep" label="Start sleep timer" /> : null}
      <Segmented label="Sleep type" options={[{ value: 'nap', label: 'Nap' }, { value: 'night', label: 'Night sleep' }]} value={kind} onChange={setPicked} />
      <TimePair startLabel="Fell asleep:" endLabel="Woke up:" start={start} end={end} onStart={setStart} onEnd={(d) => { setPrefillCapped(false); setEnd(d) }} quick={editing ? undefined : wokeAt}>
        {prefillCapped ? <span className="time-field-note" role="status">That wake time was still to come · set to now</span> : null}
        {invalid ? <p className="small text-health">Wake time must be after fall-asleep time.</p> : null}
      </TimePair>
      <NoteField value={notes} onChange={setNotes} placeholder="Fussy going down, woke once…" />
      <SheetFooter
        busy={busy}
        error={error}
        disabled={invalid}
        onSave={() => run(() => (editing ? sleepApi.update(editing.id, body) : sleepApi.create(body)))}
        onDelete={editing ? () => run(() => sleepApi.remove(editing.id)) : undefined}
      />
    </>
  )
}
