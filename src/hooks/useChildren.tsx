import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { children as childrenApi } from '../lib/api/endpoints'
import { qk } from '../lib/api/keys'
import type { Child } from '../lib/api/types'
import { usePrefs } from './usePrefs'

interface ChildContextValue {
  children: Child[]
  child: Child | null
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => Promise<unknown>
  select: (id: number) => void
}

const ChildContext = createContext<ChildContextValue | null>(null)

export function ChildProvider({ children: nodes }: { children: ReactNode }) {
  const { prefs, update } = usePrefs()
  const query = useQuery({ queryKey: qk.children, queryFn: childrenApi.list, staleTime: 60_000 })
  const list = useMemo(() => query.data ?? [], [query.data])
  const child = useMemo(
    () => list.find((c) => c.id === prefs.selectedChild) ?? list[0] ?? null,
    [list, prefs.selectedChild],
  )

  // Persist a default selection only when none is stored. A freshly created child may not be in the
  // cached list yet, so never overwrite an explicit selection just because it isn't found this render.
  useEffect(() => {
    if (child && prefs.selectedChild === null) update({ selectedChild: child.id })
  }, [child, prefs.selectedChild, update])

  const value = useMemo<ChildContextValue>(
    () => ({ children: list, child, isLoading: query.isLoading, isError: query.isError, error: query.error, refetch: query.refetch, select: (id) => update({ selectedChild: id }) }),
    [list, child, query.isLoading, query.isError, query.error, query.refetch, update],
  )
  return <ChildContext.Provider value={value}>{nodes}</ChildContext.Provider>
}

export function useChildren(): ChildContextValue {
  const ctx = useContext(ChildContext)
  if (!ctx) throw new Error('useChildren must be used inside ChildProvider')
  return ctx
}
