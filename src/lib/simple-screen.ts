/**
 * The simple screen: what a phone signed in as a grandparent (or anyone an admin chooses) shows instead of the
 * app. Big buttons only, the time is always now, and every save can be taken back on the next screen. The
 * server decides who gets it (`Person.screen`, set in Settings › People); the last answer is kept on the phone
 * so a slow or missing companion never drops a grandparent into the full app.
 */
import { format } from 'date-fns'
import { SIMPLE_ACTIONS, type Person, type Screen, type SimpleAction } from './api/companion'
import type { DiaperChange, Feeding } from './api/types'
import { parseDate, toIso } from './time'

export interface ScreenChoice {
  screen: Screen
  actions: SimpleAction[]
}

export const FULL_APP: ScreenChoice = { screen: 'full', actions: [...SIMPLE_ACTIONS] }

/** The signed-in person's screen from the People listing; null until it is there. */
export function myScreen(people: Person[] | undefined): ScreenChoice | null {
  const me = people?.find((p) => p.you)
  if (!people) return null
  if (!me) return FULL_APP
  const actions = SIMPLE_ACTIONS.filter((a) => me.simpleActions?.includes(a))
  return { screen: me.screen === 'simple' && actions.length ? 'simple' : 'full', actions: actions.length ? actions : [...SIMPLE_ACTIONS] }
}

const KEY = 'bramble.screen'

export function readCachedScreen(username: string): ScreenChoice | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { username?: string; screen?: Screen; actions?: SimpleAction[] } | null
    if (!raw || raw.username?.toLowerCase() !== username.toLowerCase() || (raw.screen !== 'full' && raw.screen !== 'simple')) return null
    const actions = SIMPLE_ACTIONS.filter((a) => raw.actions?.includes(a))
    return { screen: raw.screen, actions: actions.length ? actions : [...SIMPLE_ACTIONS] }
  } catch {
    return null
  }
}

export function writeCachedScreen(username: string, choice: ScreenChoice) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ username, ...choice }))
  } catch {
    // Private mode: the listing decides each launch.
  }
}

export type DiaperKind = 'pee' | 'poop' | 'both'

/** What a diaper button writes: the time is now, nothing else to choose. */
export function diaperBody(child: number, kind: DiaperKind, now: Date): Record<string, unknown> {
  return { child, time: toIso(now), wet: kind !== 'poop', solid: kind !== 'pee', color: '', amount: null, notes: '' }
}

/** "3:12 PM", or "yesterday 9:40 PM" / "Mon 9:40 PM" further back: what "last bottle" says on a big button. */
export function whenText(at: Date, now: Date): string {
  const clock = format(at, 'h:mm a')
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days <= 0) return clock
  if (days === 1) return `yesterday ${clock}`
  return `${format(at, 'EEE')} ${clock}`
}

/** "2 hours ago" / "40 minutes ago" / "just now": said in words, not "2h". */
export function agoText(at: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000))
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  return hours === 1 ? 'an hour ago' : `${hours} hours ago`
}

export const lastBottle = (feedings: Feeding[]): Date | null => latest(feedings.filter((f) => f.method === 'bottle').map((f) => parseDate(f.start)))
export const lastDiaper = (changes: DiaperChange[]): Date | null => latest(changes.filter((c) => !(c.tags ?? []).includes('potty')).map((c) => parseDate(c.time)))

function latest(dates: Date[]): Date | null {
  return dates.length ? dates.reduce((a, b) => (b > a ? b : a)) : null
}
