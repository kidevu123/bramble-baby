import { useEffect } from 'react'
import { DEFAULT_LABEL_PREFS } from '../lib/labels'
import type { MilkWindows } from '../lib/api/companion'
import { useChildren } from './useChildren'
import { useChildSettings } from './useChildSettings'
import { usePrefs } from './usePrefs'

const same = (a: MilkWindows, b: MilkWindows) => a.roomHours === b.roomHours && a.fridgeDays === b.fridgeDays && a.freezerMonths === b.freezerMonths

/**
 * The storage windows are the household's, not one phone's: every bag on the server and every sticker is dated
 * with them. They used to live only in each phone's label prefs, so a new caregiver's phone (or cleared site
 * data) dated bags with 4 h / 4 d / 6 mo while the other phone printed the NICU's windows (sweep 2026-10-21).
 * Now the shared copy wins and is copied into this phone's prefs; a household without one takes it from the
 * first phone that changed them from the defaults. Settings writes both (`LabelSettings`).
 */
export function MilkWindowsSync() {
  const { child } = useChildren()
  const { settings, update, isShared } = useChildSettings(child?.id ?? null)
  const { prefs, update: updatePrefs } = usePrefs()
  const mine: MilkWindows = { roomHours: prefs.labels.roomHours, fridgeDays: prefs.labels.fridgeDays, freezerMonths: prefs.labels.freezerMonths }
  const shared = settings.milkWindows
  const defaults: MilkWindows = { roomHours: DEFAULT_LABEL_PREFS.roomHours, fridgeDays: DEFAULT_LABEL_PREFS.fridgeDays, freezerMonths: DEFAULT_LABEL_PREFS.freezerMonths }
  useEffect(() => {
    if (!child || !isShared) return
    if (shared) {
      if (!same(shared, mine)) updatePrefs({ labels: { ...prefs.labels, ...shared } })
    } else if (!same(mine, defaults)) {
      update({ milkWindows: mine })
    }
  }, [child, isShared, shared?.roomHours, shared?.fridgeDays, shared?.freezerMonths, mine.roomHours, mine.fridgeDays, mine.freezerMonths]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
