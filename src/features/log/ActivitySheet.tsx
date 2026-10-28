import { withCaregiverTag } from '../../lib/caregiver'
import { useState } from 'react'
import type { QuickPrefill } from '../../lib/quick-text'
import { FieldGroup } from '../../components/ui/Field'
import { NoteField, TimePair, ValueField } from './LogFields'
import { BathIcon, BookIcon, PlayBlocksIcon, ScreenIcon, SkinIcon, TreeIcon, TummyIcon, HeartIcon } from '../../components/icons'
import { useInvalidateCompanion } from '../../hooks/useCompanionEvents'
import { companion, type Activity, type ActivityType } from '../../lib/api/companion'
import { tummyTimes as tummyApi } from '../../lib/api/endpoints'
import type { Child, TummyTime } from '../../lib/api/types'
import { parseDate, secondsBetween, toIso } from '../../lib/time'
import { SheetFooter } from './SheetFooter'
import { TimerLaunch } from './TimerLaunch'
import { useSaver } from './useSaver'
import './activity.css'

type Kind = ActivityType | 'tummy'

const TYPES: { value: Kind; label: string; Icon: typeof BathIcon }[] = [
  { value: 'bath', label: 'Bath', Icon: BathIcon },
  { value: 'tummy', label: 'Tummy time', Icon: TummyIcon },
  { value: 'story', label: 'Story time', Icon: BookIcon },
  { value: 'screen', label: 'Screen time', Icon: ScreenIcon },
  { value: 'skin', label: 'Skin to skin', Icon: SkinIcon },
  { value: 'play', label: 'Play', Icon: PlayBlocksIcon },
  { value: 'outdoors', label: 'Outdoors', Icon: TreeIcon },
  { value: 'massage', label: 'Massage', Icon: HeartIcon },
]

type Editing = { kind: 'activity'; entry: Activity } | { kind: 'tummy'; entry: TummyTime } | null

export function ActivitySheet({ child, editing, tummyPrefill, onClose }: { child: Child; editing: Editing; tummyPrefill?: Extract<QuickPrefill, { kind: 'tummy' }>; onClose: () => void }) {
  const [type, setType] = useState<Kind>(() => (editing ? (editing.kind === 'tummy' ? 'tummy' : editing.entry.type) : tummyPrefill ? 'tummy' : 'bath'))
  const [start, setStart] = useState<Date>(() => (editing ? parseDate(editing.entry.start) : new Date((tummyPrefill?.end ?? new Date()).getTime() - (tummyPrefill?.minutes ?? 10) * 60_000)))
  const [minutes, setMinutes] = useState<string>(() => (editing ? (editing.entry.end ? String(Math.round(secondsBetween(editing.entry.start, editing.entry.end) / 60)) : '0') : String(tummyPrefill?.minutes ?? 10)))
  const [notes, setNotes] = useState(() => (editing ? (editing.kind === 'tummy' ? editing.entry.milestone : editing.entry.notes) : ''))
  const invalidateCompanion = useInvalidateCompanion()
  const { run, busy, error } = useSaver(child.id, () => {
    invalidateCompanion(child.id)
    onClose()
  })

  const mins = Number(minutes)
  const length = Math.max(0, Number.isFinite(mins) ? mins : 0) * 60_000
  const end = new Date(start.getTime() + length)
  /** "Finished 15 min ago": the whole session moves and keeps its length (Baby Buddy refuses a tummy time ending in the future). */
  const finishedAt = (at: Date) => setStart(new Date(at.getTime() - length))
  const endsInFuture = end.getTime() > Date.now() + 60_000

  async function save() {
    if (type === 'tummy') {
      const body = { child: child.id, start: toIso(start), end: toIso(end), milestone: notes }
      return editing?.kind === 'tummy' ? tummyApi.update(editing.entry.id, body) : tummyApi.create(body)
    }
    const body = { child: child.id, type, start: toIso(start), end: mins > 0 ? toIso(end) : null, notes }
    // A new activity carries who logged it, like every Baby Buddy entry; an edit leaves the tags alone.
    return editing?.kind === 'activity' ? companion.activities.update(editing.entry.id, body) : companion.activities.create(withCaregiverTag(body) as typeof body & { tags?: string[] })
  }

  async function remove() {
    if (!editing) return
    return editing.kind === 'tummy' ? tummyApi.remove(editing.entry.id) : companion.activities.remove(editing.entry.id)
  }

  return (
    <>
      <FieldGroup title="What did you do?">
        <div className="activity-grid" role="radiogroup" aria-label="What did you do?">
          {TYPES.map(({ value, label, Icon }) => (
            <button key={value} type="button" role="radio" aria-checked={type === value} aria-disabled={editing ? true : undefined} className={type === value ? 'activity-opt active' : 'activity-opt'} onClick={() => !editing && setType(value)}>
              <span className="activity-icon">
                <Icon />
              </span>
              <span className="activity-label">{label}</span>
            </button>
          ))}
        </div>
      </FieldGroup>
      <ValueField label="Duration" unit="min" name="Duration (minutes)" type="number" inputMode="numeric" min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="0" />
      {/* The duration is typed above, so the pair shows no length of its own; Finished moves the whole session. */}
      <TimePair startLabel="Started:" endLabel="Finished:" start={start} end={end} onStart={setStart} onEnd={finishedAt} quick={editing ? undefined : finishedAt} showLength={false}>
        {endsInFuture ? <p className="small text-health">That would end in the future. Move the start back, or tap when it finished.</p> : null}
      </TimePair>
      {/* Below the times, so choosing Tummy time does not push the fields you are about to fill. */}
      {type === 'tummy' && !editing ? <TimerLaunch child={child} name="tummy" tone="tummy" label="Start tummy time timer" /> : null}
      <NoteField label={type === 'tummy' ? 'Milestone / notes' : 'Notes'} addLabel={type === 'tummy' ? 'Add a milestone or note' : 'Add a note'} value={notes} onChange={setNotes} />
      <SheetFooter busy={busy} error={error} disabled={(type === 'tummy' && !(mins > 0)) || endsInFuture} onSave={() => run(save)} onDelete={editing ? () => run(remove) : undefined} />
    </>
  )
}
