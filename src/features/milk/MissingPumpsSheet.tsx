import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Button } from '../../components/ui/Button'
import { FieldGroup, PillChoice } from '../../components/ui/Field'
import { Sheet } from '../../components/ui/Sheet'
import { useInvalidateMilk, useMilkWindows } from '../../hooks/useMilk'
import { describeApiError } from '../../lib/api/client'
import { companion, type MilkLocation } from '../../lib/api/companion'
import type { Id, Pumping } from '../../lib/api/types'
import { expectedExpiry, formatMl, toMl } from '../../lib/milk'
import { pumpOf } from '../../lib/pumps'
import { parseDate, toIso } from '../../lib/time'
import type { VolumeUnit } from '../../lib/units'
import './milk.css'

/**
 * Pumping sessions whose milk never went into the stash (saved away from the printer, or backfilled, before a saved
 * session put its own milk in): tick the ones whose milk is still there, say where it is, and each becomes a bag
 * linked to its session, dated from when it was pumped. The same idempotent call the label sheet makes, so a session
 * is never added twice. Milk already fed or mixed without the stash is left unticked: adding it would count it twice.
 */
export function MissingPumpsSheet({ open, child, sessions, unit, now, onClose }: { open: boolean; child: Id; /** `pumpsNotInStash`: amounts in the phone's unit. */ sessions: Pumping[]; unit: VolumeUnit; now: Date; onClose: () => void }) {
  const invalidate = useInvalidateMilk()
  const windows = useMilkWindows()
  const [off, setOff] = useState<Set<Id>>(() => new Set())
  const [place, setPlace] = useState<MilkLocation>('fridge')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setOff(new Set())
    setPlace('fridge')
    setError(null)
  }, [open])
  const picked = sessions.filter((p) => !off.has(p.id))
  const ml = picked.reduce((sum, p) => sum + toMl(p.amount ?? 0, unit), 0)
  const toggle = (id: Id) =>
    setOff((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const add = async () => {
    setBusy(true)
    setError(null)
    try {
      // One at a time, oldest first: a failure part-way leaves the earlier ones in the stash and the rest listed.
      for (const p of [...picked].reverse()) {
        await companion.milk.create({ child, pumped_at: toIso(parseDate(p.start)), volume_ml: toMl(p.amount ?? 0, unit), location: place, pumping_id: p.id, notes: p.notes ?? '', windows })
      }
      invalidate(child)
      onClose()
    } catch (err) {
      invalidate(child)
      setError(describeApiError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open={open}
      title="Pumped, not in the stash"
      onClose={onClose}
      footer={
        <Button size="lg" block onClick={() => void add()} loading={busy} disabled={!picked.length}>
          {picked.length ? `Add ${picked.length} to the stash · ${formatMl(ml, unit)}` : 'Add to the stash'}
        </Button>
      }
    >
      <p className="small muted">These sessions were saved without their milk going into the stash. Leave ticked the ones whose milk is still there; untick milk already fed, mixed or thrown away.</p>
      <ul className="night-sources" aria-label="Pumping sessions not in the stash" data-testid="missing-list">
        {sessions.map((p) => {
          const out = off.has(p.id)
          const pump = pumpOf(p.tags)
          const until = expectedExpiry({ pumpedAt: parseDate(p.start), location: place, thawedAt: null }, windows)
          return (
            <li key={p.id}>
              <button type="button" className={`night-source${out ? ' is-out' : ''}`} aria-pressed={!out} onClick={() => toggle(p.id)} aria-label={`${format(parseDate(p.start), 'EEE h:mm a')}, ${formatMl(toMl(p.amount ?? 0, unit), unit)}${pump ? `, ${pump}` : ''}${out ? ', left out' : ''}`}>
                <span className="strong">{formatMl(toMl(p.amount ?? 0, unit), unit)}</span>
                <span className="grow small muted">
                  {format(parseDate(p.start), 'EEE h:mm a')}
                  {pump ? ` · ${pump}` : ''}
                </span>
                <span className="xs night-source-use">{out ? 'left out' : until.getTime() <= now.getTime() ? 'past its time there' : `until ${format(until, place === 'freezer' ? 'MMM d' : 'EEE h:mm a')}`}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <FieldGroup title="The milk is in" hint="For all the ticked ones. A bag that is somewhere else is moved from its own sheet afterwards.">
        <PillChoice
          tone="teal"
          value={place}
          onChange={setPlace}
          options={[
            { value: 'fridge', label: 'Fridge' },
            { value: 'freezer', label: 'Freezer' },
          ]}
        />
      </FieldGroup>
      {error ? (
        <p className="log-error" role="alert">
          {error}
        </p>
      ) : null}
    </Sheet>
  )
}
