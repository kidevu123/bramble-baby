import { useEffect, useRef } from 'react'
import { companion, type PushScheduleItem } from '../../lib/api/companion'
import type { Child, Sleep } from '../../lib/api/types'
import type { NapSettings } from '../../lib/api/companion'
import { isExpecting } from '../../lib/child'
import { ageHold, judgedMonths, type AgeBasis } from '../../lib/preterm'
import { predictNap } from '../../lib/nap-window'
import { formatTime } from '../../lib/time'

/**
 * Keeps the server-side nap window notification schedule in sync with the current prediction.
 * Any caregiver's open app recomputes from the same data, so everyone stays consistent; the
 * server delivers even when every app is closed.
 */
export function useNapSchedule(child: Child | null, sleeps: Sleep[], settings: NapSettings, subscribed: boolean, asleepSince: Date | null = null, age: AgeBasis | null = null) {
  const last = useRef<string>('')
  useEffect(() => {
    if (!child || !subscribed || isExpecting(child)) return
    const now = new Date()
    const basis = age ?? child.birth_date
    const p = predictNap(sleeps, judgedMonths(basis, now), now, settings.wakeWindowAdjustMinutes, asleepSince)
    const items: PushScheduleItem[] = []
    // In the NICU or before the due date (Settings › Born early) no nap is predicted, so none is announced.
    if (settings.notify && !ageHold(basis, now) && p.state === 'predicted' && p.at) {
      const lead = new Date(p.at.getTime() - settings.leadMinutes * 60_000)
      if (lead.getTime() > now.getTime()) {
        items.push({ tag: 'sweetspot:near', at: lead.toISOString(), title: `Nap window soon · ${formatTime(p.at)}`, body: `${child.first_name}'s ideal nap is coming up in ${settings.leadMinutes} minutes.` })
      }
      // Only future alerts: a prediction inside the current window has a past `at`, and scheduling it
      // again on every app open re-fired "now is the ideal time" to every phone.
      if (p.at.getTime() > now.getTime()) {
        items.push({ tag: 'sweetspot:now', at: p.at.toISOString(), title: `Nap window now · ${formatTime(p.at)}`, body: `Now is the ideal time to put ${child.first_name} down.` })
      }
    }
    const signature = `${child.id}|${items.map((i) => `${i.tag}@${i.at}`).join(',')}`
    if (signature === last.current) return
    last.current = signature
    void companion.push.schedule(child.id, items).catch(() => undefined)
  }, [child, sleeps, settings, subscribed, asleepSince, age])
}
