import { useCallback, useRef, useState } from 'react'
import { useInvalidateChild } from '../../hooks/useEvents'
import { describeApiError } from '../../lib/api/client'

/** Runs a save/delete, refreshes the child's data, reports errors in plain language. */
export function useSaver(childId: number, onDone: () => void) {
  const invalidate = useInvalidateChild()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `busy` disables Save on the next render; a second tap inside the same frame would still get through.
  const inFlight = useRef(false)
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      if (inFlight.current) return
      inFlight.current = true
      setBusy(true)
      setError(null)
      try {
        await fn()
        invalidate(childId)
        onDone()
      } catch (err) {
        setError(describeApiError(err))
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    },
    [childId, invalidate, onDone],
  )
  return { run, busy, error }
}
