import { useEffect, useRef } from 'react'
import { pumping } from '../lib/api/endpoints'
import { PUMPS_DECIDED, startingPumps } from '../lib/pumps'
import { useChildren } from './useChildren'
import { useChildSettings } from './useChildSettings'

const DAY = 86_400_000

/**
 * A household that never chose its pumps gets them decided once, from its own pumping entries (`startingPumps`):
 * an existing household keeps the old list, a new one starts empty and adds its own in Settings › Pumps. An empty
 * list decided under 1.34's rule (no `pumpsDecided`) is decided again, which brings back the pumps it lost; a list
 * saved in Settings › Pumps carries `pumpsDecided` and is never touched. Only from the shared copy of the settings.
 */
export function PumpsSeeder() {
  const { child } = useChildren()
  const { settings, update, isShared } = useChildSettings(child?.id ?? null)
  const undecided = isShared && (settings.pumps === undefined || (settings.pumps.length === 0 && (settings.pumpsDecided ?? 0) < PUMPS_DECIDED))
  const asked = useRef<number | null>(null)
  useEffect(() => {
    if (!child || !undecided || asked.current === child.id) return
    asked.current = child.id
    const now = new Date()
    pumping
      .list(child.id, { from: new Date(now.getTime() - 365 * DAY), to: now })
      .then((rows) => update({ pumps: startingPumps(rows), pumpsDecided: PUMPS_DECIDED }))
      .catch(() => {
        asked.current = null // try again on the next load
      })
  }, [child, undecided, update])
  return null
}
