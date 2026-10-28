import { pumpOf } from './pumps'
import { addDays } from 'date-fns'
import type { Activity, Contraction, Milestone } from './api/companion'
import { bottleFinish } from './bottle-finish'
import type { DiaperChange, EventKind, Feeding, GrowthEntry, GrowthKind, HeadCircumference, Height, Medication, Note, Pumping, Sleep, Temperature, TummyTime, Weight } from './api/types'
import { caregiverOf } from './caregiver'
import { decodeSolidsNotes } from './foods'
import { growthEntryTime } from './growth-note'
import { formatDurationShort, formatTime, parseDate, parseDuration, secondsBetween } from './time'
import { formatLength, formatTemp, formatVolume, formatWeight, type UnitPrefs } from './units'

export type AnyEvent = Sleep | Feeding | DiaperChange | Pumping | TummyTime | Temperature | Medication | Note | Activity | Milestone | Contraction | GrowthEntry

export interface TimelineItem {
  key: string
  kind: EventKind
  at: Date
  end: Date | null
  title: string
  detail: string
  raw: AnyEvent
  /** Caregiver username from the entry's tags, when Bramble logged it. */
  by?: string | null
}

export interface EventSets {
  sleep: Sleep[]
  feedings: Feeding[]
  changes: DiaperChange[]
  pumping: Pumping[]
  tummy: TummyTime[]
  temperature: Temperature[]
  medication: Medication[]
  notes: Note[]
  activities: Activity[]
  milestones: Milestone[]
  contractions: Contraction[]
  /** Growth is fetched separately (no date range); present when the caller has it. */
  growth?: GrowthSets
}

export interface GrowthSets {
  weights: Weight[]
  heights: Height[]
  heads: HeadCircumference[]
}

export const EMPTY_EVENTS: EventSets = {
  sleep: [],
  feedings: [],
  changes: [],
  pumping: [],
  tummy: [],
  temperature: [],
  medication: [],
  notes: [],
  activities: [],
  milestones: [],
  contractions: [],
}

export const KIND_LABEL: Record<EventKind, string> = {
  contractions: 'Contractions',
  sleep: 'Sleep',
  nursing: 'Nursing',
  bottle: 'Bottle',
  feeding: 'Feeding',
  solids: 'Solids',
  diaper: 'Diaper',
  potty: 'Potty',
  pumping: 'Pumping',
  milestones: 'Milestones',
  medicine: 'Medicine',
  activity: 'Activity',
  tummy: 'Tummy time',
  growth: 'Growth',
  temperature: 'Temperature',
  note: 'Note',
}

export const ACTIVITY_LABEL: Record<string, string> = {
  bath: 'Bath',
  story: 'Story time',
  screen: 'Screen time',
  skin: 'Skin to skin',
  play: 'Play',
  outdoors: 'Outdoors',
  massage: 'Massage',
  other: 'Activity',
}

export function isPotty(d: DiaperChange): boolean {
  return d.tags?.includes('potty') ?? false
}

export function feedingKind(f: Feeding): EventKind {
  if (f.type === 'solid food') return 'solids'
  return f.method === 'bottle' ? 'bottle' : 'nursing'
}

/** "Bottle", or "Bottle · not finished" when the note says (the simple screen's question), in the title so it is never cut off. */
function feedingTitle(f: Feeding, kind: EventKind): string {
  const finish = kind === 'bottle' ? bottleFinish(f.notes) : null
  return finish ? `${KIND_LABEL[kind]} · ${finish}` : KIND_LABEL[kind]
}

export function describeFeeding(f: Feeding, units: UnitPrefs): string {
  if (f.type === 'solid food') {
    const { foods, reaction } = decodeSolidsNotes(f.notes)
    const r = reaction === 'loved' ? ' · loved it' : reaction === 'disliked' ? ' · disliked' : reaction === 'allergic' ? ' · reaction!' : ''
    return (foods.length ? foods.join(', ') : 'Solids') + r
  }
  const method =
    f.method === 'bottle'
      ? 'Bottle'
      : f.method === 'left breast'
        ? 'Nursed · L'
        : f.method === 'right breast'
          ? 'Nursed · R'
          : f.method === 'both breasts'
            ? 'Nursed · L+R'
            : 'Fed'
  const parts = [method]
  if (f.method === 'bottle') parts.push(f.type === 'formula' ? 'formula' : f.type === 'fortified breast milk' ? 'fortified' : 'breast milk')
  if (f.amount) parts.push(formatVolume(f.amount, units.volume))
  const secs = parseDuration(f.duration)
  if (secs >= 60 && f.method !== 'bottle') parts.push(formatDurationShort(secs))
  return parts.join(' · ')
}

export function describeDiaper(d: DiaperChange): string {
  if (isPotty(d)) {
    if (d.tags.includes('accident')) return 'Accident'
    const what = d.wet && d.solid ? 'Pee + poo' : d.wet ? 'Pee' : d.solid ? 'Poo' : 'Sat but dry'
    return `Potty · ${what}`
  }
  const what = d.wet && d.solid ? 'Mixed' : d.wet ? 'Pee' : d.solid ? 'Poo' : 'Dry'
  const size = d.amount === 1 ? 'little' : d.amount === 2 ? 'medium' : d.amount === 3 ? 'large' : null
  return [what, size, d.color || null].filter(Boolean).join(' · ')
}

export function growthKindOf(entry: GrowthEntry): GrowthKind {
  if ('weight' in entry) return 'weight'
  if ('height' in entry) return 'height'
  return 'head'
}

export const GROWTH_LABEL: Record<GrowthKind, string> = { weight: 'Weight', height: 'Height', head: 'Head circumference' }

export function describeGrowth(entry: GrowthEntry, units: UnitPrefs): string {
  const kind = growthKindOf(entry)
  if (kind === 'weight') return formatWeight((entry as Weight).weight, units.weight)
  if (kind === 'height') return formatLength((entry as Height).height, units.length)
  return formatLength((entry as HeadCircumference).head_circumference, units.length)
}

/** Noon on the entry's date: where a growth entry without a time of day sits, so it sorts inside its day. */
export function growthNoonOf(entry: GrowthEntry): Date {
  const at = parseDate(entry.date)
  at.setHours(12, 0, 0, 0)
  return at
}

/**
 * Growth entries as timeline rows. Baby Buddy keeps only a date for these, so the clock comes from the
 * note's time segment (growth-note.ts); an entry without one is shown at noon.
 */
export function buildGrowthItems(growth: GrowthSets | undefined, units: UnitPrefs): TimelineItem[] {
  if (!growth) return []
  const entries: GrowthEntry[] = [...growth.weights, ...growth.heights, ...growth.heads]
  return entries.map((entry) => {
    const kind = growthKindOf(entry)
    const at = growthEntryTime(entry) ?? growthNoonOf(entry)
    return { key: `growth-${kind}-${entry.id}`, kind: 'growth', at, end: null, title: GROWTH_LABEL[kind], detail: describeGrowth(entry, units), raw: entry, by: caregiverOf(entry.tags) }
  })
}

export function sleepDurationSeconds(s: Sleep): number {
  return s.duration ? parseDuration(s.duration) : secondsBetween(s.start, s.end)
}

export function buildTimeline(events: EventSets, units: UnitPrefs): TimelineItem[] {
  const items: TimelineItem[] = []
  const tagged = (raw: { tags?: string[] | null }): string | null => caregiverOf(raw.tags)
  for (const s of events.sleep) {
    const secs = sleepDurationSeconds(s)
    items.push({
      key: `sleep-${s.id}`,
      kind: 'sleep',
      at: parseDate(s.start),
      end: parseDate(s.end),
      title: s.nap ? 'Nap' : 'Night sleep',
      detail: `${formatTime(s.start)} – ${formatTime(s.end)} · ${formatDurationShort(secs)}`,
      raw: s,
      by: tagged(s),
    })
  }
  for (const f of events.feedings) {
    const kind = feedingKind(f)
    items.push({ key: `feeding-${f.id}`, kind, at: parseDate(f.start), end: parseDate(f.end), title: feedingTitle(f, kind), detail: describeFeeding(f, units), raw: f, by: tagged(f) })
  }
  for (const d of events.changes) {
    const potty = isPotty(d)
    items.push({ key: `diaper-${d.id}`, kind: potty ? 'potty' : 'diaper', at: parseDate(d.time), end: null, title: potty ? 'Potty' : 'Diaper', detail: describeDiaper(d), raw: d, by: tagged(d) })
  }
  for (const p of events.pumping) {
    const parts = [formatDurationShort(parseDuration(p.duration))]
    if (p.amount) parts.push(formatVolume(p.amount, units.volume))
    const pump = pumpOf(p.tags)
    if (pump) parts.push(pump)
    items.push({ key: `pumping-${p.id}`, kind: 'pumping', at: parseDate(p.start), end: parseDate(p.end), title: 'Pumping', detail: parts.join(' · '), raw: p, by: tagged(p) })
  }
  for (const t of events.tummy) {
    items.push({
      key: `tummy-${t.id}`,
      kind: 'tummy',
      at: parseDate(t.start),
      end: parseDate(t.end),
      title: 'Tummy time',
      detail: [formatDurationShort(parseDuration(t.duration)), t.milestone].filter(Boolean).join(' · '),
      raw: t,
      by: tagged(t),
    })
  }
  for (const t of events.temperature) {
    items.push({ key: `temp-${t.id}`, kind: 'temperature', at: parseDate(t.time), end: null, title: 'Temperature', detail: formatTemp(t.temperature, units.temp), raw: t, by: tagged(t) })
  }
  for (const m of events.medication) {
    items.push({ key: `med-${m.id}`, kind: 'medicine', at: parseDate(m.time), end: null, title: 'Medicine', detail: `${m.name} · ${m.dosage} ${m.dosage_unit}`, raw: m, by: tagged(m) })
  }
  for (const n of events.notes) {
    items.push({ key: `note-${n.id}`, kind: 'note', at: parseDate(n.time), end: null, title: 'Note', detail: n.note, raw: n, by: tagged(n) })
  }
  for (const a of events.activities) {
    const dur = a.end ? formatDurationShort(secondsBetween(a.start, a.end)) : ''
    items.push({
      key: `activity-${a.id}`,
      kind: 'activity',
      at: parseDate(a.start),
      end: a.end ? parseDate(a.end) : null,
      title: ACTIVITY_LABEL[a.type] ?? 'Activity',
      detail: [dur, a.notes].filter(Boolean).join(' · ') || 'Logged',
      raw: a,
      by: caregiverOf(a.tags),
    })
  }
  for (const m of events.milestones) {
    const at = parseDate(m.date)
    at.setHours(12, 0, 0, 0)
    items.push({ key: `milestone-${m.id}`, kind: 'milestones', at, end: null, title: 'Milestone', detail: m.title, raw: m })
  }
  for (const c of events.contractions) {
    const dur = c.end ? formatDurationShort(secondsBetween(c.start, c.end)) : 'in progress'
    items.push({ key: `contraction-${c.id}`, kind: 'contractions', at: parseDate(c.start), end: c.end ? parseDate(c.end) : null, title: 'Contraction', detail: dur, raw: c })
  }
  items.push(...buildGrowthItems(events.growth, units))
  return items.sort((a, b) => b.at.getTime() - a.at.getTime())
}

export interface DaySummary {
  sleepSeconds: number
  napCount: number
  feedCount: number
  bottleVolume: number
  diaperCount: number
  wetCount: number
  solidCount: number
  pumpVolume: number
}

/**
 * The span a day covers when it starts at `startHour` (0 = midnight; Reports can start the day at the
 * child's day start, e.g. 8 = 8 AM to 8 AM). Calendar day, not 24 h: DST days are 23 or 25 hours long.
 */
export function dayWindow(day: Date, startHour = 0): { start: Date; end: Date } {
  const start = new Date(day)
  start.setHours(Math.floor(startHour), Math.round((startHour % 1) * 60), 0, 0)
  return { start, end: addDays(start, 1) }
}

/** Totals for one day (midnight to midnight, or from `startHour` as `dayWindow` says). Sleep counts the
 *  portion of each sleep that falls in it. */
export function summarizeDay(events: EventSets, day: Date, startHour = 0): DaySummary {
  const { start: dayStart, end: dayEnd } = dayWindow(day, startHour)
  const inDay = (t: string) => {
    const ms = parseDate(t).getTime()
    return ms >= dayStart.getTime() && ms < dayEnd.getTime()
  }
  let sleepSeconds = 0
  let napCount = 0
  for (const s of events.sleep) {
    const start = Math.max(parseDate(s.start).getTime(), dayStart.getTime())
    const end = Math.min(parseDate(s.end).getTime(), dayEnd.getTime())
    if (end > start) sleepSeconds += (end - start) / 1000
    if (s.nap && inDay(s.start)) napCount++
  }
  const feeds = events.feedings.filter((f) => inDay(f.start) && f.type !== 'solid food')
  const diapers = events.changes.filter((d) => inDay(d.time) && !isPotty(d))
  const pumps = events.pumping.filter((p) => inDay(p.start))
  return {
    sleepSeconds,
    napCount,
    feedCount: feeds.length,
    bottleVolume: feeds.reduce((sum, f) => sum + (f.method === 'bottle' ? f.amount ?? 0 : 0), 0),
    diaperCount: diapers.length,
    wetCount: diapers.filter((d) => d.wet).length,
    solidCount: diapers.filter((d) => d.solid).length,
    pumpVolume: pumps.reduce((sum, p) => sum + (p.amount ?? 0), 0),
  }
}

export function latestOf<T>(items: T[], at: (item: T) => string): T | null {
  let best: T | null = null
  let bestTime = -Infinity
  for (const item of items) {
    const t = parseDate(at(item)).getTime()
    if (t > bestTime) {
      best = item
      bestTime = t
    }
  }
  return best
}
