import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { FieldGroup, TextField, TimeField } from '../../components/ui/Field'
import { TrashIcon } from '../../components/icons'
import { ck, useInvalidateCompanion } from '../../hooks/useCompanionEvents'
import { companion } from '../../lib/api/companion'
import type { Child, EventKind } from '../../lib/api/types'
import { KIND_LABEL } from '../../lib/events'
import { formatWhen, toIso } from '../../lib/time'
import { NotificationStatus } from '../notifications/NotificationStatus'
import { SheetFooter } from './SheetFooter'
import { useSaver } from './useSaver'
import './activity.css'

const PRESETS = [1, 2, 3, 4]

/** "Remind me" for a tile. Delivered as a push notification to every caregiver. */
export function ReminderSheet({ child, kind }: { child: Child; kind: EventKind | null }) {
  const label = kind ? KIND_LABEL[kind] : 'Reminder'
  const [at, setAt] = useState<Date>(() => new Date(Date.now() + 3 * 3600_000))
  const [title, setTitle] = useState(`${label} time`)
  const [body, setBody] = useState(`Time for ${child.first_name}'s next ${label.toLowerCase()}.`)
  const invalidate = useInvalidateCompanion()
  // The sheet stays open (the Upcoming list is the confirmation), so the reminder just set is remembered:
  // Set reminder stays off until the time or the title changes, and a second tap cannot schedule it twice.
  const [justSet, setJustSet] = useState<{ at: number; title: string } | null>(null)
  const { run, busy, error } = useSaver(child.id, () => invalidate(child.id))
  const sameAsSet = justSet !== null && justSet.at === at.getTime() && justSet.title === title.trim()
  const [preset, setPreset] = useState<number | null>(3)
  const reminders = useQuery({ queryKey: ck.reminders(child.id), queryFn: () => companion.reminders.list(child.id).catch(() => []) })
  const mine = (reminders.data ?? []).filter((r) => !r.sent && (!kind || r.tag === `reminder:${kind}`))

  return (
    <>
      <NotificationStatus child={child.id} compact />
      <FieldGroup title="Remind me in">
        <div className="ago-chips reminder-presets" role="group" aria-label="Remind me in">
          {PRESETS.map((h) => (
            <button
              key={h}
              type="button"
              className={preset === h ? 'ago-chip active' : 'ago-chip'}
              aria-pressed={preset === h}
              onClick={() => {
                setPreset(h)
                setAt(new Date(Date.now() + h * 3600_000))
              }}
            >
              {h} h
            </button>
          ))}
        </div>
        <TimeField
          future
          label="At:"
          value={at}
          onChange={(d) => {
            setPreset(null)
            setAt(d)
          }}
        />
      </FieldGroup>
      <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <TextField label="Message" value={body} onChange={(e) => setBody(e.target.value)} />
      <SheetFooter
        busy={busy}
        error={error}
        disabled={at.getTime() < Date.now() || !title.trim() || sameAsSet}
        label={sameAsSet ? 'Reminder set' : 'Set reminder'}
        note={
          sameAsSet ? (
            <p className="reminder-set" role="status">
              Reminder set for {formatWhen(at)}. It is in Upcoming below; pick another time to add a second one.
            </p>
          ) : null
        }
        onSave={() =>
          run(async () => {
            const sent = { at: at.getTime(), title: title.trim() }
            await companion.reminders.create({ child: child.id, at: toIso(at), title: sent.title, body: body.trim(), tag: `reminder:${kind ?? 'general'}` })
            setJustSet(sent)
          })
        }
      />
      {mine.length ? (
        <FieldGroup title="Upcoming">
          <ul className="reminder-list">
            {mine.map((r) => (
              <li key={r.id} className="reminder-item">
                <span className="grow">
                  <span className="strong">{r.title}</span>
                  <span className="xs muted" style={{ display: 'block' }}>
                    {formatWhen(r.at)}
                  </span>
                </span>
                <button type="button" className="sheet-icon-btn" aria-label="Delete reminder" onClick={() => run(() => companion.reminders.remove(r.id))}>
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        </FieldGroup>
      ) : null}
    </>
  )
}
