import { useEffect, useRef } from 'react'
import { useChildren } from './useChildren'
import { useChildSettings } from './useChildSettings'
import { companion } from '../lib/api/companion'
import { isExpecting } from '../lib/child'
import { guidePushPlan } from '../lib/guide'
import { ageBasis } from '../lib/preterm'

/**
 * Hands the companion the guide's coming periods for the child (title and what to look for), so it can send each
 * the morning its week or month begins, also on days nobody opens the app (server/nudges.py `guide`). The guide's
 * text lives in the app; this runs once per launch and child, and again when the birth date or the born-early
 * settings change (the periods then fall on other days). A refusal (an older companion) is not retried.
 */
export function GuidePushSync() {
  const { child } = useChildren()
  const { settings, isLoaded } = useChildSettings(child?.id ?? null)
  const sent = useRef('')
  const basis = child && !isExpecting(child, new Date()) ? ageBasis(child, settings) : null
  const key = child && basis && isLoaded ? `${child.id}|${child.first_name}|${child.birth_date}|${basis.due ?? ''}` : ''
  useEffect(() => {
    if (!key || !child || !basis || sent.current === key) return
    sent.current = key
    void companion.nudges.guide(child.id, guidePushPlan(basis, new Date(), child.first_name)).catch(() => undefined)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
