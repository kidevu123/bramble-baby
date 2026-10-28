import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { companion, type NudgeSettings, type NudgeStatus } from '../../lib/api/companion'
import type { Id } from '../../lib/api/types'
import { DEFAULT_NUDGE_SETTINGS } from '../../lib/nudges'

const key = (child: Id) => ['nudges', child] as const

/**
 * Settings › Notifications: the household's nudge settings and the server's plan for each one.
 * Reading the status also hands the server this phone's token, which is what lets its poll read Baby Buddy.
 */
export function useNudges(child: Id | null, enabled = true) {
  const qc = useQueryClient()
  const id = child ?? 0
  const status = useQuery<NudgeStatus>({
    queryKey: key(id),
    enabled: child !== null,
    queryFn: () => companion.nudges.status(id),
    // The Settings row reads the household settings with the sheet closed; the open sheet asks again at once
    // (the first answer may predate the server's plan) and then every minute.
    staleTime: enabled ? 0 : 30_000,
    refetchInterval: enabled ? 60_000 : false,
  })
  const save = useMutation({
    mutationFn: (patch: Partial<NudgeSettings>) => companion.nudges.update(id, patch),
    onMutate: (patch) => {
      const prev = qc.getQueryData<NudgeStatus>(key(id))
      if (prev) qc.setQueryData<NudgeStatus>(key(id), { ...prev, settings: { ...prev.settings, ...patch } })
    },
    onSuccess: (fresh) => qc.setQueryData(key(id), fresh),
    onError: () => void qc.invalidateQueries({ queryKey: key(id) }),
  })
  return {
    status: status.data ?? null,
    settings: status.data?.settings ?? DEFAULT_NUDGE_SETTINGS,
    isLoading: status.isPending && child !== null,
    isError: status.isError,
    error: status.error,
    update: (patch: Partial<NudgeSettings>) => save.mutate(patch),
    isSaving: save.isPending,
  }
}

/**
 * Home: whenever what was logged changes (a feed, a pump, a diaper), ask the server to recompute at once so a
 * pending "usually eats about now" vanishes the moment the bottle is saved, instead of at the next poll.
 */
export function useNudgeTouch(child: Id | null, signature: string, subscribed: boolean) {
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (child === null || !subscribed) return
    if (last.current === null) {
      last.current = signature // first paint: the server's own poll covers it
      return
    }
    if (last.current === signature) return
    last.current = signature
    const t = setTimeout(() => void companion.nudges.run(child).catch(() => undefined), 1500)
    return () => clearTimeout(t)
  }, [child, signature, subscribed])
}
