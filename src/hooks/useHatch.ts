import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { companion, type HatchStatus } from '../lib/api/companion'
import type { Id } from '../lib/api/types'

const HATCH_KEY = ['hatch'] as const
const WHILE_SYNCING_MS = 1_000
const WHILE_OPEN_MS = 60_000

/**
 * The Hatch Grow connection as the companion sees it, plus the four things the owner can do with it.
 * `watch` is true while the sheet is open: the status then follows a running sync closely.
 * Weights the companion imported are Baby Buddy entries like any other, so when the imported count
 * moves, the growth and timeline queries are refreshed and the new weights simply appear.
 */
export function useHatch(watch: boolean) {
  const qc = useQueryClient()
  const query = useQuery<HatchStatus>({
    queryKey: HATCH_KEY,
    queryFn: companion.hatch.status,
    staleTime: 30_000,
    retry: false,
    refetchInterval: (q) => (q.state.data?.syncing ? WHILE_SYNCING_MS : watch ? WHILE_OPEN_MS : false),
  })

  const imported = query.data?.imported
  const seen = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (imported === undefined) return
    if (seen.current !== undefined && seen.current !== imported) {
      void qc.invalidateQueries({ queryKey: ['growth'] })
      void qc.invalidateQueries({ queryKey: ['events'] })
    }
    seen.current = imported
  }, [imported, qc])

  const put = (status: HatchStatus) => qc.setQueryData(HATCH_KEY, status)
  const connect = useMutation({ mutationFn: (v: { email: string; password: string }) => companion.hatch.connect(v.email, v.password), onSuccess: put })
  const disconnect = useMutation({ mutationFn: companion.hatch.disconnect, onSuccess: put })
  const sync = useMutation({ mutationFn: companion.hatch.sync, onSuccess: put })
  const mapBabies = useMutation({ mutationFn: (babies: { id: number; child: Id }[]) => companion.hatch.mapBabies(babies), onSuccess: put })

  return { status: query.data, isLoading: query.isLoading, error: query.error, connect, disconnect, sync, mapBabies }
}
