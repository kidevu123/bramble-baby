import { useCallback, useEffect, useMemo } from 'react'
import { bodyToStorage, entryToDisplay, type UnitKind } from '../lib/storage-units'
import type { Id } from '../lib/api/types'
import type { UnitPrefs } from '../lib/units'
import { useChildSettings } from './useChildSettings'
import { useChildren } from './useChildren'
import { usePrefs } from './usePrefs'

/**
 * The units Baby Buddy's numbers are stored in for this child. Recorded once in the shared child
 * settings and never changed afterwards. Null until known: the hooks and sheets wait for it rather
 * than guess, because a guess is exactly how "5.39 lb" once turned into "5.39 kg".
 *
 * Legacy households (data logged before storage units existed) are seeded by StorageUnitsSeeder from
 * the household's earlier shared units, else this phone's own units, which is what the old app used.
 */
export function useStorageUnits(child: Id | null): UnitPrefs | null {
  const { settings, isShared } = useChildSettings(child)
  const { prefs } = usePrefs()
  const stored = settings.storageUnits
  return useMemo(() => {
    if (child === null) return null
    if (stored) return stored
    // Only a household the companion has actually answered for is "legacy"; a fresh phone whose companion
    // is unreachable has a default copy with nothing in it, and guessing its own units would read the
    // household's mL as oz and write bottles in oz.
    if (!isShared) return null
    return settings.units ?? prefs.units
  }, [child, stored, isShared, settings.units, prefs.units])
}

/** Converters for one child between this phone's display units and the household's storage units. */
export function useUnitBoundary(child: Id | null) {
  const storage = useStorageUnits(child)
  const { prefs } = usePrefs()
  const display = prefs.units
  const ready = storage !== null
  const toStorage = useCallback(
    <T extends object>(kind: UnitKind, body: T): T => {
      if (!storage) throw new Error('Household units are still loading. Try again in a moment.')
      return bodyToStorage(kind, body, storage, display)
    },
    [storage, display],
  )
  const toDisplay = useCallback(
    <T extends object>(kind: UnitKind, entry: T): T => {
      if (!storage) throw new Error('Household units are still loading. Try again in a moment.')
      return entryToDisplay(kind, entry, storage, display)
    },
    [storage, display],
  )
  return { ready, storage, display, toStorage, toDisplay }
}

/** Records the storage units for a child that has none yet. Mounted once inside the app shell. */
export function StorageUnitsSeeder() {
  const { child } = useChildren()
  const { prefs } = usePrefs()
  const { settings, update, isShared } = useChildSettings(child?.id ?? null)
  // Seed only from the shared copy: a local stand-in (companion unreachable) says nothing about the household.
  const missing = isShared && !settings.storageUnits
  const legacy = settings.units
  useEffect(() => {
    if (!child || !missing) return
    update({ storageUnits: legacy ?? prefs.units })
  }, [child, missing, legacy, prefs.units, update])
  return null
}
