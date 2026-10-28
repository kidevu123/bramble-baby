/**
 * Which breast pump a session used, and which pump does best.
 *
 * Baby Buddy's pumping entry has no field for the pump, so the pump rides on the entry as a `pump:<name>`
 * tag, the way the author rides as `caregiver:<name>`: it survives Baby Buddy's own UI and needs nothing
 * on the companion. The household's pumps (name and the length of a typical session) are a shared child
 * setting edited in Settings › Pumps; the log sheets only pick one.
 */
import type { Pumping } from './api/types'
import { parseDate, parseDuration } from './time'

const PREFIX = 'pump:'

export interface PumpSpec {
  name: string
  /** How long a session on this pump usually runs; a new sheet or the timer's prefill uses it. */
  minutes: number
}

/** A new household starts with no pumps (Settings › Pumps adds them; the log sheets then offer them). */
export const DEFAULT_PUMPS: PumpSpec[] = []

/**
 * The list every household had before the pumps were the household's own choice (the first family's four). A
 * household that never saved a list but already tagged sessions with a pump gets these once (`PumpsSeeder`),
 * so its pumps do not vanish; one with no tagged sessions starts empty.
 */
export const LEGACY_PUMPS: PumpSpec[] = [
  { name: 'Eufy', minutes: 30 },
  { name: 'Spectra', minutes: 20 },
  { name: 'Medela', minutes: 20 },
  { name: 'Ameda', minutes: 20 },
]

/** The day the empty default shipped (1.34.0): a household logging pumping before it lived with the list above. */
export const EMPTY_DEFAULT_SINCE = new Date(2026, 9, 20)

/** Bumped when the pump list's first-run decision changes; a household decided under an older rule is decided again. */
export const PUMPS_DECIDED = 2

/**
 * The pump list a household that never chose one starts with, from its own pumping entries: one that pumped
 * before the empty default shipped, or named a pump on any session, used the old list, so it keeps those four plus
 * any other pump its sessions name; one with neither (a new household) starts empty. 1.34.0 asked only for tagged
 * sessions, so a household upgrading from a build without pump tags lost every pump, Medela included.
 */
export function startingPumps(entries: Pick<Pumping, 'start' | 'tags'>[]): PumpSpec[] {
  const named = entries.map((e) => pumpOf(e.tags)).filter((n): n is string => Boolean(n))
  const before = entries.some((e) => new Date(e.start).getTime() < EMPTY_DEFAULT_SINCE.getTime())
  if (!named.length && !before) return []
  return cleanPumps([...LEGACY_PUMPS, ...named.map((name) => ({ name, minutes: 20 }))])
}

export function pumpTag(name: string): string {
  return `${PREFIX}${name.trim()}`
}

/** The pump named on an entry's tags, or null (older entries, Baby Buddy's own UI). */
export function pumpOf(tags: string[] | null | undefined): string | null {
  const tag = (tags ?? []).find((t) => t.startsWith(PREFIX))
  const name = tag ? tag.slice(PREFIX.length).trim() : ''
  return name || null
}

/** The entry's tags with exactly one pump tag (or none when `pump` is null); every other tag stays. */
export function withPumpTag(tags: string[] | null | undefined, pump: string | null): string[] {
  const rest = (tags ?? []).filter((t) => !t.startsWith(PREFIX))
  return pump && pump.trim() ? [...rest, pumpTag(pump)] : rest
}

/** A clean list for the settings: trimmed names, no duplicates (case-insensitive), 1–180 minutes. */
export function cleanPumps(pumps: PumpSpec[]): PumpSpec[] {
  const seen = new Set<string>()
  const out: PumpSpec[] = []
  for (const p of pumps) {
    const name = p.name.trim().slice(0, 30)
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    const minutes = Number.isFinite(p.minutes) ? Math.min(180, Math.max(1, Math.round(p.minutes))) : 20
    out.push({ name, minutes })
  }
  return out
}

/** Before this hour a session counts as "morning", when supply is at its highest whatever the pump. */
export const MORNING_ENDS_HOUR = 10
/** Fewer sessions than this on a pump and its average is a guess, not a result. */
export const MIN_SESSIONS = 3

/** One session as the chart draws it. `amount` and `perMinute` are in the unit the entries carry. */
export interface PumpPoint {
  amount: number
  minutes: number
  perMinute: number
  /** Started before MORNING_ENDS_HOUR: the easy slot, drawn differently so it is not mistaken for the pump. */
  morning: boolean
  start: Date
}

export interface PumpStats {
  name: string
  sessions: number
  /** In the unit the entries carry (the phone's display unit). */
  total: number
  avgAmount: number
  avgMinutes: number
  /** Volume per minute of pumping, same unit. */
  perMinute: number
  bestAmount: number
  /** Share of this pump's sessions that started before MORNING_ENDS_HOUR. */
  morningShare: number
  /** Every session, oldest first: the real data behind the average. */
  points: PumpPoint[]
}

export interface PumpComparison {
  /** Ranked by average per session, most first; only pumps with at least one session. */
  pumps: PumpStats[]
  /** Sessions in the range with no pump recorded. */
  untracked: number
  /** Those sessions themselves, so the chart can show them as a row of their own. */
  untrackedPoints: PumpPoint[]
  /** The pump that gets the most per minute, when that differs from the one with the most per session. */
  perMinuteLeader: string | null
}

function point(e: Pumping): PumpPoint {
  const minutes = Math.max(1, parseDuration(e.duration) / 60)
  const start = parseDate(e.start)
  return { amount: e.amount as number, minutes, perMinute: (e.amount as number) / minutes, morning: start.getHours() < MORNING_ENDS_HOUR, start }
}

/** Entries with a volume, grouped by the pump on their tags. Amounts are whatever unit the caller passes. */
export function comparePumps(entries: Pumping[]): PumpComparison {
  const groups = new Map<string, PumpPoint[]>()
  const untrackedPoints: PumpPoint[] = []
  for (const e of [...entries].sort((a, b) => parseDate(a.start).getTime() - parseDate(b.start).getTime())) {
    if (e.amount === null || e.amount === undefined || !(e.amount >= 0)) continue
    const pump = pumpOf(e.tags)
    if (!pump) {
      untrackedPoints.push(point(e))
      continue
    }
    const list = groups.get(pump) ?? []
    list.push(point(e))
    groups.set(pump, list)
  }
  const pumps: PumpStats[] = []
  for (const [name, points] of groups) {
    const total = points.reduce((s, p) => s + p.amount, 0)
    const totalMinutes = points.reduce((s, p) => s + p.minutes, 0)
    pumps.push({
      name,
      sessions: points.length,
      total,
      avgAmount: total / points.length,
      avgMinutes: totalMinutes / points.length,
      perMinute: total / totalMinutes,
      bestAmount: Math.max(...points.map((p) => p.amount)),
      morningShare: points.filter((p) => p.morning).length / points.length,
      points,
    })
  }
  pumps.sort((a, b) => b.avgAmount - a.avgAmount || b.perMinute - a.perMinute || a.name.localeCompare(b.name))
  const byMinute = [...pumps].sort((a, b) => b.perMinute - a.perMinute)
  const perMinuteLeader = pumps.length > 1 && byMinute[0].name !== pumps[0].name ? byMinute[0].name : null
  return { pumps, untracked: untrackedPoints.length, untrackedPoints, perMinuteLeader }
}

/** The one short line under the chart when the data cannot carry a verdict yet; null when it can. */
export function pumpCaution(c: PumpComparison): string | null {
  if (c.pumps.length === 0) return c.untracked ? 'Pick the pump on each session to start comparing.' : 'No pumping with a volume in this range yet.'
  if (c.pumps.length === 1) return `Only the ${c.pumps[0].name} so far. Log a session on another pump to compare.`
  const thin = c.pumps.filter((p) => p.sessions < MIN_SESSIONS)
  return thin.length ? `Fewer than ${MIN_SESSIONS} sessions on ${thin.map((p) => p.name).join(' and ')}: too few to trust yet.` : null
}

/** "2 of 2 before 10 AM": the time-of-day caveat for one pump, or null when it is not lopsided. */
export function morningNote(p: PumpStats): string | null {
  if (p.sessions < 2) return null
  const morning = Math.round(p.morningShare * p.sessions)
  if (p.morningShare >= 0.7) return `${morning} of ${p.sessions} before 10 AM`
  if (p.morningShare === 0) return 'none before 10 AM'
  return null
}
