import { useQuery, useQueryClient } from '@tanstack/react-query'
import { companion, type MilkBag, type PrinterStatus, type PrintJob } from '../lib/api/companion'
import type { Id } from '../lib/api/types'
import { usePrefs } from './usePrefs'
import type { MilkWindows } from '../lib/api/companion'

export const mk = {
  stash: (child: Id) => ['milk', child] as const,
  printer: ['printer-status'] as const,
}

/** Every bag for a child (stored first, then used/discarded), refreshed once a minute so expiry states move. */
export function useMilkStash(child: Id | null) {
  const id = child ?? 0
  return useQuery<MilkBag[]>({
    queryKey: mk.stash(id),
    enabled: child !== null,
    queryFn: () => companion.milk.list(id),
    refetchInterval: 60_000,
  })
}

export function useInvalidateMilk() {
  const qc = useQueryClient()
  return (child: Id) => void qc.invalidateQueries({ queryKey: mk.stash(child) }).then(() => qc.invalidateQueries({ queryKey: ['milk-feeding'] }))
}

/** The stash bag a bottle feeding was poured from (editing or deleting that feeding adjusts its take). */
export function useBagForFeeding(feedingId: Id | null) {
  const id = feedingId ?? 0
  return useQuery({
    queryKey: ['milk-feeding', id],
    enabled: feedingId !== null,
    queryFn: () => companion.milk.forFeeding(id),
    staleTime: 30_000,
  })
}

/** Is a label printer attached to the server (direct printing, no phone app)? Cached for the session. */
export function usePrinterStatus() {
  // An error stays an error (retried, asked again on the next mount) rather than five minutes of "no printer".
  return useQuery<PrinterStatus>({ queryKey: mk.printer, queryFn: () => companion.print.status(), staleTime: 5 * 60_000, retry: 2 })
}

/** The phone stops asking after this long even if the companion is still listening to the printer. */
export const PRINT_JOB_POLL_LIMIT_MS = 15_000
const PRINT_JOB_POLL_EVERY_MS = 800

/**
 * Follows one print request after it was sent: the companion keeps asking the Zebra how it is doing for a
 * few seconds, and this polls `print.job` while the answer is still to come (`checking`), bounded in time.
 * `job` is the record the print request answered with, which seeds the data so nothing flashes.
 */
export function usePrintJob(job: PrintJob | null) {
  const id = job?.id ?? 0
  return useQuery<PrintJob>({
    queryKey: ['print-job', id],
    enabled: job !== null && job.checking,
    queryFn: () => companion.print.job(id),
    initialData: job ?? undefined,
    staleTime: 0,
    refetchInterval: (query) => {
      const latest = query.state.data
      if (!latest?.checking) return false
      return Date.now() - new Date(latest.sent_at).getTime() > PRINT_JOB_POLL_LIMIT_MS ? false : PRINT_JOB_POLL_EVERY_MS
    },
    retry: 1,
  })
}

/** The household storage windows from this phone's label settings, in the shape the server wants. */
export function useMilkWindows(): MilkWindows {
  const { prefs } = usePrefs()
  return { roomHours: prefs.labels.roomHours, fridgeDays: prefs.labels.fridgeDays, freezerMonths: prefs.labels.freezerMonths }
}
