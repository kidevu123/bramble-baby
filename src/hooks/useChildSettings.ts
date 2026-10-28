import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { companion, DEFAULT_CHILD_SETTINGS, type ChildSettings } from '../lib/api/companion'
import type { Id } from '../lib/api/types'

const key = (child: Id) => ['child-settings', child] as const
const LOCAL_KEY = (child: Id) => `bramble.child-settings.${child}`
/** Changes this phone made that the companion did not take (offline, a restart during a deploy): sent again on
 *  the next good read, so a refetch never quietly undoes them. */
const PENDING_KEY = (child: Id) => `bramble.child-settings-pending.${child}`

function readPending(child: Id): Partial<ChildSettings> | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY(child))
    return raw ? (JSON.parse(raw) as Partial<ChildSettings>) : null
  } catch {
    return null
  }
}

function writePending(child: Id, patch: Partial<ChildSettings> | null) {
  try {
    if (patch) localStorage.setItem(PENDING_KEY(child), JSON.stringify(patch))
    else localStorage.removeItem(PENDING_KEY(child))
  } catch {
    /* ignore */
  }
}

function readLocal(child: Id): ChildSettings {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(child))
    if (!raw) return DEFAULT_CHILD_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ChildSettings>
    return { ...DEFAULT_CHILD_SETTINGS, ...parsed, sweetSpot: { ...DEFAULT_CHILD_SETTINGS.sweetSpot, ...(parsed.sweetSpot ?? {}) } }
  } catch {
    return DEFAULT_CHILD_SETTINGS
  }
}

/** Children whose shared copy the companion has answered for this session (the local copy is a fallback, not an answer). */
const consulted = new Set<Id>()

async function fetchSettings(id: Id): Promise<ChildSettings> {
  try {
    let shared = await companion.settings.get(id)
    if (typeof shared !== 'object' || Array.isArray(shared)) throw new Error('bad settings')
    const pending = readPending(id)
    if (pending) {
      try {
        await companion.settings.put(id, pending)
        writePending(id, null)
      } catch {
        /* still not taken: keep showing it and try again on the next read */
      }
      shared = { ...shared, ...pending }
    }
    consulted.add(id)
    writeLocal(id, shared)
    return shared
  } catch {
    // The local copy is a stand-in, not the shared copy: nothing may decide from what is absent in it.
    consulted.delete(id)
    return readLocal(id)
  }
}

function writeLocal(child: Id, s: ChildSettings) {
  try {
    localStorage.setItem(LOCAL_KEY(child), JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

/**
 * Per-child settings shared by every caregiver (stored by the companion service).
 * Falls back to a local copy when the companion service is unreachable so the app keeps working.
 */
export function useChildSettings(child: Id | null) {
  const qc = useQueryClient()
  const id = child ?? 0
  const query = useQuery({
    queryKey: key(id),
    enabled: child !== null,
    staleTime: 60_000,
    queryFn: () => fetchSettings(id),
    placeholderData: () => readLocal(id),
  })

  // The cache holds the latest settings this phone knows, optimistic patches included; each patch is laid
  // on top of it (never on a `settings` captured at render), so two quick updates both land.
  const current = useCallback((): ChildSettings => qc.getQueryData<ChildSettings>(key(id)) ?? readLocal(id), [qc, id])
  const save = useMutation({
    mutationFn: async (patch: Partial<ChildSettings>) => {
      writeLocal(id, current())
      try {
        // Only what changed: the companion merges it over the shared copy.
        await companion.settings.put(id, patch)
      } catch {
        // Offline or the companion restarting: the change stays on this phone and goes out on the next good read.
        writePending(id, { ...(readPending(id) ?? {}), ...patch })
      }
      return patch
    },
    onMutate: async (patch) => {
      // A read already on its way would land after this and put the old value back.
      await qc.cancelQueries({ queryKey: key(id) })
      qc.setQueryData<ChildSettings>(key(id), (prev) => ({ ...(prev ?? readLocal(id)), ...patch }))
    },
  })

  const settings = query.data ?? DEFAULT_CHILD_SETTINGS
  const isPlaceholder = query.isPlaceholderData || query.isPending
  const { mutate } = save
  // A patch, or a function of the latest settings this phone knows (for a nested object or a list: built at
  // the moment of saving, not from a copy captured at render, so another phone's recent change is kept).
  const update = useCallback(
    (change: Partial<ChildSettings> | ((latest: ChildSettings) => Partial<ChildSettings>)) => {
      if (child === null) return
      const send = () => mutate(typeof change === 'function' ? change(current()) : change)
      if (!isPlaceholder || qc.getQueryData(key(id)) !== undefined) {
        send()
        return
      }
      // Still showing the local/default copy: fetch the shared copy first so the optimistic copy (and the
      // local fallback) starts from it, not from this phone's defaults.
      void qc.fetchQuery({ queryKey: key(id), queryFn: () => fetchSettings(id) }).then(send, send)
    },
    [child, id, isPlaceholder, qc, mutate, current],
  )
  return {
    settings,
    update,
    isSaving: save.isPending,
    isLoaded: !isPlaceholder,
    /** The shared copy itself has been read, not a local or default stand-in. What is absent from it is truly absent. */
    isShared: !isPlaceholder && consulted.has(id),
  }
}
