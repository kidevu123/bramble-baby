import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { timers as timersApi } from '../../lib/api/endpoints'
import { qk } from '../../lib/api/keys'
import type { Id } from '../../lib/api/types'

export type TimerKind = 'sleep' | 'pumping' | 'tummy' | 'nursing' | 'other'

export function timerKind(name: string | null | undefined): TimerKind {
  if (!name) return 'other'
  if (name === 'sleep' || name === 'pumping' || name === 'tummy') return name
  if (name.startsWith('nursing:')) return 'nursing'
  return 'other'
}

export function useTimerActions() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const create = useMutation({
    mutationFn: ({ child, name }: { child: Id; name: string }) => timersApi.create({ child, name }),
    onSuccess: async (timer) => {
      await qc.invalidateQueries({ queryKey: qk.timers })
      navigate(`/timer/${timer.id}`)
    },
  })
  return {
    // Errors are exposed via `error` (rendered by the launch buttons) rather than thrown into onClick.
    start: (child: Id, name: string) => create.mutateAsync({ child, name }).then(() => undefined, () => undefined),
    isStarting: create.isPending,
    error: create.error,
  }
}
