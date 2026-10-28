import { format } from 'date-fns'
import { useState } from 'react'
import { PillChoice } from '../../components/ui/Field'
import { Sheet } from '../../components/ui/Sheet'
import { useChildSettings } from '../../hooks/useChildSettings'
import { useInvalidateChild } from '../../hooks/useEvents'
import * as ep from '../../lib/api/endpoints'
import type { Pumping } from '../../lib/api/types'
import { describeApiError } from '../../lib/api/client'
import { DEFAULT_PUMPS, withPumpTag } from '../../lib/pumps'
import { parseDate } from '../../lib/time'
import { formatVolume, type VolumeUnit } from '../../lib/units'

/**
 * The sessions in the range that name no pump, each with the household's pumps as one tap. A tap writes
 * the `pump:<name>` tag onto that entry (the full tag list, so the caregiver tag stays) and the comparison
 * picks it up. Only the tags change: amounts and times are never rewritten here.
 */
export function TagPumpsSheet({ open, onClose, sessions, child, unit }: { open: boolean; onClose: () => void; sessions: Pumping[]; child: number; unit: VolumeUnit }) {
  const { settings } = useChildSettings(child || null)
  const pumps = settings.pumps ?? DEFAULT_PUMPS
  const invalidate = useInvalidateChild()
  const [chosen, setChosen] = useState<Record<number, string>>({})
  const [errors, setErrors] = useState<Record<number, string>>({})
  const rows = [...sessions].sort((a, b) => parseDate(b.start).getTime() - parseDate(a.start).getTime())
  const left = rows.filter((r) => !chosen[r.id]).length

  async function tag(entry: Pumping, name: string) {
    setChosen((c) => ({ ...c, [entry.id]: name }))
    setErrors((e) => ({ ...e, [entry.id]: '' }))
    try {
      await ep.pumping.update(entry.id, { tags: withPumpTag(entry.tags, name) })
      invalidate(child)
    } catch (err) {
      setChosen((c) => {
        const { [entry.id]: _dropped, ...rest } = c
        return rest
      })
      setErrors((e) => ({ ...e, [entry.id]: describeApiError(err) }))
    }
  }

  return (
    <Sheet open={open} title="Which pump was it?" onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {left ? `${left} session${left === 1 ? '' : 's'} in this range ${left === 1 ? 'has' : 'have'} no pump. Tap the pump on each; the comparison counts it at once.` : 'Every session in this range names its pump.'}
        </p>
        <ul className="tag-list" aria-label="Sessions without a pump">
          {rows.map((r) => (
            <li key={r.id} className="tag-row" data-session={r.id}>
              <span className="tag-when">
                <span>{format(parseDate(r.start), 'EEE MMM d · h:mm a')}</span>
                <span>{r.amount !== null && r.amount !== undefined ? formatVolume(r.amount, unit) : ''}</span>
              </span>
              <PillChoice tone="purple" options={pumps.map((p) => ({ value: p.name, label: p.name }))} value={chosen[r.id] ?? null} onChange={(name) => void tag(r, name)} />
              {errors[r.id] ? (
                <span className="xs text-health" role="alert">
                  {errors[r.id]}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  )
}
