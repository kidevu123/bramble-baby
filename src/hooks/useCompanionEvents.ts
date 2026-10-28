import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { companion, type Activity, type Contraction, type Milestone } from '../lib/api/companion'
import type { Id } from '../lib/api/types'

export const ck = {
  contractions: (child: Id) => ['companion', child, 'contractions'] as const,
  activities: (child: Id) => ['companion', child, 'activities'] as const,
  milestones: (child: Id) => ['companion', child, 'milestones'] as const,
  reminders: (child: Id) => ['companion', child, 'reminders'] as const,
  all: (child: Id) => ['companion', child] as const,
}

const swallow = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
  try {
    const r = await fn()
    return Array.isArray(r) ? r : []
  } catch {
    return []
  }
}

/** Companion-service data (things Baby Buddy has no model for). Empty lists if the service is down. */
export function useCompanionEvents(child: Id | null, sinceIso?: string) {
  const id = child ?? 0
  const enabled = child !== null
  const [c, a, m] = useQueries({
    queries: [
      { queryKey: [...ck.contractions(id), sinceIso], queryFn: () => swallow<Contraction>(() => companion.contractions.list(id, sinceIso)), enabled },
      { queryKey: [...ck.activities(id), sinceIso], queryFn: () => swallow<Activity>(() => companion.activities.list(id, sinceIso)), enabled },
      { queryKey: ck.milestones(id), queryFn: () => swallow<Milestone>(() => companion.milestones.list(id)), enabled },
    ],
  })
  return useMemo(
    () => ({ contractions: c.data ?? [], activities: a.data ?? [], milestones: m.data ?? [], isLoading: c.isLoading || a.isLoading || m.isLoading }),
    [c.data, a.data, m.data, c.isLoading, a.isLoading, m.isLoading],
  )
}

export function useInvalidateCompanion() {
  const qc = useQueryClient()
  return (child: Id) => void qc.invalidateQueries({ queryKey: ck.all(child) })
}
