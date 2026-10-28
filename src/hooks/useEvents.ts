import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { subDays, startOfDay, endOfDay } from 'date-fns'
import { useMemo } from 'react'
import * as ep from '../lib/api/endpoints'
import { qk } from '../lib/api/keys'
import type { Id } from '../lib/api/types'
import { useCompanionEvents } from './useCompanionEvents'
import { usePrefs } from './usePrefs'
import { useStorageUnits } from './useStorageUnits'
import { listToDisplay } from '../lib/storage-units'
import { pumpOf } from '../lib/pumps'
import { parseDate } from '../lib/time'
import { lastSessionSeconds } from '../lib/quick-log'

export function rangeDays(days: number, now: Date = new Date()): ep.Range {
  return { from: startOfDay(subDays(now, days - 1)), to: endOfDay(now) }
}

const rangeKey = (r: ep.Range) => `${r.from.toISOString()}|${r.to.toISOString()}`

/** All day-to-day event types for one child over a range, fetched in parallel. */
export function useChildEvents(child: Id | null, range: ep.Range) {
  const key = rangeKey(range)
  const enabled = child !== null
  const id = child ?? 0
  const results = useQueries({
    queries: [
      { queryKey: qk.events(id, 'sleep', key), queryFn: () => ep.sleep.list(id, range), enabled },
      { queryKey: qk.events(id, 'feedings', key), queryFn: () => ep.feedings.list(id, range), enabled },
      { queryKey: qk.events(id, 'changes', key), queryFn: () => ep.changes.list(id, range), enabled },
      { queryKey: qk.events(id, 'pumping', key), queryFn: () => ep.pumping.list(id, range), enabled },
      { queryKey: qk.events(id, 'tummy', key), queryFn: () => ep.tummyTimes.list(id, range), enabled },
      { queryKey: qk.events(id, 'temperature', key), queryFn: () => ep.temperature.list(id, range), enabled },
      { queryKey: qk.events(id, 'medication', key), queryFn: () => ep.medication.list(id, range), enabled },
      { queryKey: qk.events(id, 'notes', key), queryFn: () => ep.notes.list(id, range), enabled },
    ],
  })
  const [sleep, feedings, changes, pumping, tummy, temperature, medication, notes] = results
  const extra = useCompanionEvents(child, range.from.toISOString())
  // Rows are cached exactly as Baby Buddy stores them and converted to this phone's units here, so a
  // unit change in Settings re-renders everything converted without a refetch or a rewrite.
  const storage = useStorageUnits(child)
  const display = usePrefs().prefs.units
  const unitsReady = storage !== null
  const isLoading = results.some((r) => r.isLoading) || (enabled && !unitsReady)
  const isError = results.some((r) => r.isError)
  const error = results.find((r) => r.error)?.error
  // Depend on the data arrays, not the result objects: useQueries hands out fresh result objects every
  // render, which made every consumer (timeline, insights, norms) recompute on each 30 s tick.
  return useMemo(
    () => ({
      activities: extra.activities,
      milestones: extra.milestones,
      contractions: extra.contractions,
      sleep: sleep.data ?? [],
      feedings: storage ? listToDisplay('feeding', feedings.data ?? [], storage, display) : [],
      changes: changes.data ?? [],
      pumping: storage ? listToDisplay('pumping', pumping.data ?? [], storage, display) : [],
      tummy: tummy.data ?? [],
      temperature: storage ? listToDisplay('temperature', temperature.data ?? [], storage, display) : [],
      medication: medication.data ?? [],
      notes: notes.data ?? [],
      isLoading,
      isError,
      error,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sleep.data, feedings.data, changes.data, pumping.data, tummy.data, temperature.data, medication.data, notes.data, extra.activities, extra.milestones, extra.contractions, isLoading, isError, error, storage, display],
  )
}

export function useGrowth(child: Id | null) {
  const id = child ?? 0
  const query = useQuery({
    queryKey: qk.growth(id),
    enabled: child !== null,
    queryFn: async () => {
      const [weights, heights, heads] = await Promise.all([ep.weight.list(id), ep.height.list(id), ep.headCircumference.list(id)])
      return { weights, heights, heads }
    },
  })
  const storage = useStorageUnits(child)
  const display = usePrefs().prefs.units
  const raw = query.data
  const data = useMemo(() => {
    if (!raw || !storage) return undefined
    return {
      weights: listToDisplay('weight', raw.weights, storage, display),
      heights: listToDisplay('height', raw.heights, storage, display),
      heads: listToDisplay('head', raw.heads, storage, display),
    }
  }, [raw, storage, display])
  return { ...query, data, isLoading: query.isLoading || (child !== null && storage === null) }
}

export function useTimers() {
  return useQuery({ queryKey: qk.timers, queryFn: ep.timers.list, refetchInterval: 15_000, staleTime: 5_000 })
}

/**
 * How long the child's most recent pumping session lasted (seconds), to prefill the next one; null until
 * known or when there is none. Reads the same 14-day query Home keeps warm, so it is usually instant.
 */
export function useLastPumpingSeconds(child: Id | null): number | null {
  return useLastPumping(child).seconds
}

/** The last session's length and the pump it named (`pump:<name>` tag), so the next sheet opens like it. */
export function useLastPumping(child: Id | null): { seconds: number | null; pump: string | null; ready: boolean } {
  const id = child ?? 0
  const range = useMemo(() => rangeDays(14), [])
  const query = useQuery({ queryKey: qk.events(id, 'pumping', rangeKey(range)), queryFn: () => ep.pumping.list(id, range), enabled: child !== null })
  return useMemo(() => {
    if (!query.data) return { seconds: null, pump: null, ready: false }
    const latest = [...query.data].sort((a, b) => parseDate(b.start).getTime() - parseDate(a.start).getTime())[0]
    return { seconds: lastSessionSeconds(query.data), pump: latest ? pumpOf(latest.tags) : null, ready: true }
  }, [query.data])
}

/** Start time of a running "sleep" timer for this child, or null. Shares the timers query with ActiveTimers. */
export function useRunningSleep(child: Id | null): Date | null {
  const timers = useTimers()
  const t = child === null ? undefined : timers.data?.find((x) => x.child === child && x.name === 'sleep')
  return useMemo(() => (t ? new Date(t.start) : null), [t?.start]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function useInvalidateChild() {
  const qc = useQueryClient()
  return (child: Id) => {
    void qc.invalidateQueries({ queryKey: qk.eventsForChild(child) })
    void qc.invalidateQueries({ queryKey: qk.growth(child) })
    void qc.invalidateQueries({ queryKey: qk.timers })
  }
}
