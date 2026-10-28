import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Sheet } from '../../components/ui/Sheet'
import { useInvalidateMilk } from '../../hooks/useMilk'
import { describeApiError } from '../../lib/api/client'
import { companion, type MilkBag } from '../../lib/api/companion'
import type { Id } from '../../lib/api/types'
import { formatMl } from '../../lib/milk'
import { isColostrum, nicuDefaultPick } from '../../lib/nicu-stash'
import type { VolumeUnit } from '../../lib/units'
import { BagRow } from './BagRow'

/**
 * Stash › Take to the NICU: the bags going in on this trip leave the home stash in one tap. Colostrum first, then
 * the oldest; the fridge and the counter start picked (what was pumped since the last trip), the freezer only
 * when chosen.
 */
export function NicuTripSheet({ open, child, candidates, birth, unit, now, onClose }: { open: boolean; child: Id; candidates: MilkBag[]; birth: string; unit: VolumeUnit; now: Date; onClose: () => void }) {
  return (
    <Sheet open={open} title="Take to the NICU" onClose={onClose}>
      {open ? <Trip child={child} candidates={candidates} birth={birth} unit={unit} now={now} onClose={onClose} /> : null}
    </Sheet>
  )
}

function Trip({ child, candidates, birth, unit, now, onClose }: { child: Id; candidates: MilkBag[]; birth: string; unit: VolumeUnit; now: Date; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<number>>(() => nicuDefaultPick(candidates))
  const invalidate = useInvalidateMilk()
  const take = useMutation({
    mutationFn: (ids: number[]) => companion.milk.toNicu(child, ids),
    onSuccess: () => {
      invalidate(child)
      onClose()
    },
  })
  const chosen = candidates.filter((b) => picked.has(b.id))
  const ml = chosen.reduce((s, b) => s + b.remaining_ml, 0)
  const flip = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  if (!candidates.length) return <p className="small muted">Nothing at home to take in: every bag is in the NICU already, used or past its window.</p>
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        Tap a bag to leave it home. They leave the stash once taken in; Undo on a bag brings it back.
      </p>
      <ul className="bag-list" aria-label="Bags at home">
        {candidates.map((b) => (
          <BagRow key={b.id} bag={b} unit={unit} now={now} picked={picked.has(b.id)} colostrum={isColostrum(b.pumped_at, birth)} onOpen={() => flip(b.id)} />
        ))}
      </ul>
      {take.isError ? (
        <p className="log-error" role="alert">
          {describeApiError(take.error)}
        </p>
      ) : null}
      <Button size="lg" block disabled={!chosen.length || take.isPending} onClick={() => take.mutate(chosen.map((b) => b.id))}>
        {chosen.length ? `Taken in · ${chosen.length} ${chosen.length === 1 ? 'bag' : 'bags'} · ${formatMl(ml, unit)}` : 'Pick the bags going in'}
      </Button>
    </div>
  )
}
