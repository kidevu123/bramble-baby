import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '../../components/ui/Button'
import { QrScanner } from '../../components/ui/QrScanner'
import { Sheet } from '../../components/ui/Sheet'
import { QrIcon } from '../../components/icons'
import { useMilkStash } from '../../hooks/useMilk'
import { useNow } from '../../hooks/useNow'
import { describeApiError } from '../../lib/api/client'
import { companion, type MilkBag } from '../../lib/api/companion'
import type { Id } from '../../lib/api/types'
import { bagState, parseQrPayload, stashOrder } from '../../lib/milk'
import type { VolumeUnit } from '../../lib/units'
import { BagRow } from './BagRow'
import './milk.css'

/**
 * Milk from the stash for a bottle. A tap (or a scan) picks the bag and returns to the bottle; with
 * `selected`, the bags already in the bottle are marked, a tap on one of them takes it out, and the bottle
 * sheet's "Add another bag" comes back here for the next one.
 */
export function StashPicker({ open, child, unit, onPick, onClose, selected }: { open: boolean; child: Id; unit: VolumeUnit; onPick: (bag: MilkBag) => void; onClose: () => void; selected?: Id[] }) {
  const multi = selected !== undefined
  const now = useNow(60_000)
  const stash = useMilkStash(open ? child : null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A failed lookup leaves the camera stopped on its last frame; a new key starts it again.
  const [attempt, setAttempt] = useState(0)
  // Closing (X, Escape or a pick) ends the scan: the next open starts on the list, without the last error.
  useEffect(() => {
    if (!open) {
      setScanning(false)
      setError(null)
    }
  }, [open])
  const stored = useMemo(() => stashOrder(stash.data ?? [], now), [stash.data, now])
  const lookup = useMutation({
    mutationFn: (code: string) => companion.milk.byCode(code),
    onSuccess: (bag) => {
      if (bag.status !== 'stored') {
        setError(`Bag ${bag.code} was already ${bag.status}.`)
        setAttempt((n) => n + 1)
        return
      }
      // The same rule as the list, where an expired bag cannot be tapped.
      if (bagState(bag, new Date()) === 'expired') {
        setError(`Bag ${bag.code} has expired. Discard it from the stash; it cannot go into a bottle.`)
        setAttempt((n) => n + 1)
        return
      }
      setScanning(false)
      // Scanning the bag in your hand again keeps it in the bottle (a tap on its row is how one comes out).
      if (selected?.includes(bag.id)) {
        setError(`Bag ${bag.code} is already in this bottle.`)
        return
      }
      onPick(bag)
      onClose()
    },
    onError: (err) => {
      setError(describeApiError(err))
      setAttempt((n) => n + 1)
    },
  })
  // `mutate` is stable; the mutation result object is new every render and would restart the camera each time.
  const { mutate: lookupCode } = lookup
  const onDecode = useCallback((code: string) => lookupCode(code), [lookupCode])
  const accept = useCallback((text: string) => parseQrPayload(text), [])
  return (
    <Sheet open={open} title="Milk from the stash" onClose={onClose}>
      {scanning ? (
        <div className="stack">
          <QrScanner key={attempt} onDecode={onDecode} accept={accept} onCancel={() => setScanning(false)} />
          {error ? (
            <p className="log-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="stack">
          <Button size="lg" block onClick={() => { setError(null); setScanning(true) }}>
            <QrIcon className="btn-icon" /> Scan the bag's QR code
          </Button>
          {error ? (
            <p className="log-error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="small muted" style={{ margin: 0 }}>{multi && selected.length ? 'Or pick another bag. Soonest to expire on top; tap a marked bag to take it out.' : 'Or pick one. Soonest to expire on top.'}</p>
          {stash.isLoading ? <p className="small muted">Loading…</p> : null}
          {!stash.isLoading && stored.length === 0 ? <p className="small muted">The stash is empty. Print a milk label from a pumping session to add a bag.</p> : null}
          <ul className="bag-list">
            {stored.map((bag) => (
              <BagRow key={bag.id} bag={bag} unit={unit} now={now} disabledWhenExpired picked={multi ? selected.includes(bag.id) : undefined} onOpen={() => { onPick(bag); onClose() }} />
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  )
}
