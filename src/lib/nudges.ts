import { differenceInCalendarDays } from 'date-fns'
import type { EventKind } from './api/types'
import type { NudgeKind, NudgePlan, NudgeSettings } from './api/companion'

export const DEFAULT_NUDGE_SETTINGS: NudgeSettings = {
  feed: true,
  pump: true,
  pumpEveryMinutes: null,
  milk: true,
  diaper: true,
  summary: true,
  summaryAt: '20:00',
  weight: true,
  supply: true,
  activity: false,
  quietStart: '22:00',
  quietEnd: '07:00',
  units: null,
}

/** Pump cadence choices in Settings; "auto" = measured from the last sessions. */
export const PUMP_CADENCES: { value: string; label: string; minutes: number | null }[] = [
  { value: 'auto', label: 'Auto', minutes: null },
  { value: '120', label: '2 h', minutes: 120 },
  { value: '150', label: '2½ h', minutes: 150 },
  { value: '180', label: '3 h', minutes: 180 },
  { value: '240', label: '4 h', minutes: 240 },
]

export function pumpCadenceValue(minutes: number | null): string {
  return PUMP_CADENCES.find((c) => c.minutes === minutes)?.value ?? 'auto'
}

/** "HH:MM" -> "8:00 PM" */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm
  const d = new Date(2000, 0, 1, h, m)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** The one-line status under a nudge row: the planned moment, or the server's plain-words reason. */
export function describePlan(plan: NudgePlan | undefined, on: boolean, now: Date = new Date()): string {
  if (!on) return 'Off'
  if (!plan) return 'Waiting for the server'
  if (!plan.at) return plan.note
  const at = new Date(plan.at)
  const when = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  // Calendar days, not hours: 7 AM the day after tomorrow is a weekday even when it is 33 h away.
  const days = differenceInCalendarDays(at, now)
  const day = days === 0 ? '' : days === 1 ? 'tomorrow ' : days === -1 ? 'yesterday ' : `${at.toLocaleDateString([], { weekday: 'short' })} `
  // A moment already past is due (the server sends it on its next pass), never "Next: tomorrow".
  const head = at.getTime() <= now.getTime() ? 'Due since' : 'Next:'
  return `${head} ${day}${when}${plan.note ? ` · ${plan.note}` : ''}`
}

/** Settings row summary: "Feeding, pumping, diaper, summary · quiet 10:00 PM–7:00 AM" */
export function nudgeSummary(s: NudgeSettings): string {
  const on = (['feed', 'pump', 'diaper', 'summary', 'weight', 'supply', 'activity'] as NudgeKind[]).filter((k) => s[k])
  const names: Record<NudgeKind, string> = { feed: 'feeding', pump: 'pumping', diaper: 'diaper', summary: 'summary', weight: 'weight', supply: 'supply', activity: 'pings' }
  const list = on.length ? on.map((k) => names[k]).join(', ') : 'all off'
  return `${list[0].toUpperCase()}${list.slice(1)} · quiet ${clockLabel(s.quietStart)}–${clockLabel(s.quietEnd)}`
}

// ---- push click -> log sheet hand-off
//
// A push can only reach the app through a URL: the service worker opens `/?log=bottle` and the app
// consumes that parameter *before the router mounts*, stashing it like the pumping timer's label hand-off
// (sessionStorage), and strips it from the address at once. Home reads the hand-off once and opens that
// sheet for "just now". It is not a deep link into another page: the user lands on Home, the sheet closes
// back to Home, and the parameter never survives a reload.

const HANDOFF_KEY = 'bramble.logHandoff'
export const LOG_PARAM = 'log'
export const LOG_KINDS: EventKind[] = ['sleep', 'nursing', 'bottle', 'solids', 'diaper', 'potty', 'pumping', 'milestones', 'medicine', 'activity', 'tummy', 'growth', 'temperature', 'note']
const HANDOFF_MAX_AGE_MS = 5 * 60_000

export interface LogHandoff {
  kind: EventKind
  at: number
}

/** `?log=<kind>` on the current address -> stashed hand-off, address cleaned. Returns the kind when one was taken. */
export function captureLogHandoff(loc: Location = location, hist: History = history): EventKind | null {
  let kind: string | null = null
  try {
    kind = new URLSearchParams(loc.search).get(LOG_PARAM)
  } catch {
    return null
  }
  if (!kind) return null
  const clean = loc.pathname + loc.hash
  try {
    hist.replaceState(hist.state, '', clean)
  } catch {
    /* ignore */
  }
  if (!LOG_KINDS.includes(kind as EventKind)) return null
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ kind: kind as EventKind, at: Date.now() } satisfies LogHandoff))
  } catch {
    /* private mode: the tap still lands on Home */
  }
  return kind as EventKind
}

/** Read without consuming (state initialisers may run twice); stale hand-offs are ignored. */
export function peekLogHandoff(now = Date.now()): EventKind | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY)
    if (!raw) return null
    const h = JSON.parse(raw) as LogHandoff
    return LOG_KINDS.includes(h.kind) && now - h.at < HANDOFF_MAX_AGE_MS ? h.kind : null
  } catch {
    return null
  }
}

export function clearLogHandoff() {
  try {
    sessionStorage.removeItem(HANDOFF_KEY)
  } catch {
    /* ignore */
  }
}
