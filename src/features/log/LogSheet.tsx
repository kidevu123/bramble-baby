import { usePeople } from '../../hooks/usePeople'
import { Sheet } from '../../components/ui/Sheet'
import type { Activity, Milestone, MilkBag } from '../../lib/api/companion'
import type { QuickPrefill } from '../../lib/quick-text'
import type { Child, DiaperChange, Feeding, GrowthEntry, Medication, Note, Pumping, Sleep, Temperature, TummyTime, GrowthKind } from '../../lib/api/types'
import { caregiverName } from '../../lib/caregiver'
import { growthKindOf, KIND_LABEL, type TimelineItem } from '../../lib/events'
import { formatAgo } from '../../lib/time'
import type { EventKind } from '../../lib/api/types'
import { ActivitySheet } from './ActivitySheet'
import { DiaperSheet } from './DiaperSheet'
import { PumpingSheet } from './DurationSheets'
import { FeedingSheet } from './FeedingSheet'
import { GrowthSheet, HealthSheet, NoteSheet } from './MiscSheets'
import { MilestoneSheet } from './MilestoneSheet'
import { SleepSheet } from './SleepSheet'
import { SolidsSheet } from './SolidsSheet'
import './log.css'

export interface LogRequest {
  kind: EventKind
  editing?: TimelineItem | null
  /** Quick text logging: fields to open the sheet with (never saved by itself). */
  prefill?: QuickPrefill
  /** Growth only: which measurement to open on when adding (tapping an empty Height/Head stat). */
  growthKind?: GrowthKind
  /** Bottle only: the stash bag this bottle is made from (scan out). */
  bag?: MilkBag | null
}

interface Props {
  request: LogRequest | null
  child: Child
  recentFeedings?: Feeding[]
  /** Everything already on the timeline, so a likely duplicate can be flagged before saving. */
  recent?: TimelineItem[]
  names?: Record<string, string>
  onClose: () => void
}

/** Kinds that count as "the same thing" for the duplicate warning. */
const SAME_KIND: Partial<Record<EventKind, EventKind[]>> = {
  feeding: ['feeding', 'nursing', 'bottle'],
  nursing: ['feeding', 'nursing', 'bottle'],
  bottle: ['feeding', 'nursing', 'bottle'],
  activity: ['activity', 'tummy'],
  tummy: ['activity', 'tummy'],
}
const DUPLICATE_WINDOW_MS = 30 * 60_000

/** The most recent entry of the same kind by someone else in the last 30 minutes, if any (your own are in the list you just saw). */
export function likelyDuplicate(kind: EventKind, recent: TimelineItem[], now = new Date(), me: string | null = null): TimelineItem | null {
  const kinds = SAME_KIND[kind] ?? [kind]
  const cutoff = now.getTime() - DUPLICATE_WINDOW_MS
  const mine = (i: TimelineItem) => me !== null && (i.by ?? '').toLowerCase() === me.toLowerCase()
  return recent.filter((i) => kinds.includes(i.kind) && !mine(i) && i.at.getTime() >= cutoff && i.at.getTime() <= now.getTime() + 60_000).sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null
}

const TITLE_KIND: Partial<Record<EventKind, string>> = { nursing: 'feeding', bottle: 'feeding', tummy: 'activity', milestones: 'milestone' }

export function LogSheet({ request, child, recentFeedings = [], recent = [], names, onClose }: Props) {
  const kind = request?.kind
  const editing = request?.editing ?? null
  const pre = editing ? undefined : request?.prefill
  const me = usePeople().people?.find((p) => p.you)?.username ?? null
  const duplicate = kind && !editing && kind !== 'contractions' ? likelyDuplicate(kind, recent, new Date(), me) : null
  const title = kind ? `${editing ? 'Edit' : 'Add'} ${(TITLE_KIND[kind] ?? KIND_LABEL[kind]).toLowerCase()}` : ''

  let body = null
  if (request && kind) {
    switch (kind) {
      case 'sleep':
        body = <SleepSheet child={child} editing={editing?.raw as Sleep | null} prefill={pre?.kind === 'sleep' ? pre : undefined} onClose={onClose} />
        break
      case 'feeding':
      case 'nursing':
        body = <FeedingSheet child={child} initial="nursing" editing={editing?.raw as Feeding | null} prefill={pre?.kind === 'nursing' ? pre : undefined} onClose={onClose} />
        break
      case 'bottle':
        body = <FeedingSheet child={child} initial="bottle" editing={editing?.raw as Feeding | null} bag={request.bag ?? null} prefill={pre?.kind === 'bottle' ? pre : undefined} onClose={onClose} />
        break
      case 'solids':
        body = <SolidsSheet child={child} editing={editing?.raw as Feeding | null} recentFeedings={recentFeedings} onClose={onClose} />
        break
      case 'diaper':
        body = <DiaperSheet child={child} initial="diaper" editing={editing?.raw as DiaperChange | null} prefill={pre?.kind === 'diaper' ? pre : undefined} onClose={onClose} />
        break
      case 'potty':
        body = <DiaperSheet child={child} initial="potty" editing={editing?.raw as DiaperChange | null} onClose={onClose} />
        break
      case 'pumping':
        body = <PumpingSheet child={child} editing={editing?.raw as Pumping | null} prefill={pre?.kind === 'pumping' ? pre : undefined} onClose={onClose} />
        break
      case 'tummy':
        body = <ActivitySheet child={child} editing={editing ? { kind: 'tummy', entry: editing.raw as TummyTime } : null} tummyPrefill={pre?.kind === 'tummy' ? pre : undefined} onClose={onClose} />
        break
      case 'activity':
        body = <ActivitySheet child={child} editing={editing ? { kind: 'activity', entry: editing.raw as Activity } : null} onClose={onClose} />
        break
      case 'milestones':
        body = <MilestoneSheet child={child} editing={editing?.raw as Milestone | null} onClose={onClose} />
        break
      case 'growth':
        body = <GrowthSheet child={child} initial={request.growthKind ?? (pre?.kind === 'growth' ? pre.growthKind : undefined)} editing={editing ? { kind: growthKindOf(editing.raw as GrowthEntry), entry: editing.raw as GrowthEntry } : null} prefill={pre?.kind === 'growth' ? pre : undefined} onClose={onClose} />
        break
      case 'medicine':
        body = <HealthSheet child={child} initial="medication" editing={editing ? { kind: 'medication', entry: editing.raw as Medication } : null} onClose={onClose} />
        break
      case 'temperature':
        body = <HealthSheet child={child} initial="temperature" editing={editing ? { kind: 'temperature', entry: editing.raw as Temperature } : null} prefill={pre?.kind === 'temperature' ? pre : undefined} onClose={onClose} />
        break
      case 'note':
        body = <NoteSheet child={child} editing={editing?.raw as Note | null} prefill={pre?.kind === 'note' ? pre : undefined} onClose={onClose} />
        break
      case 'contractions':
        body = null
        break
    }
  }

  return (
    <Sheet open={request !== null && kind !== 'contractions'} title={title} onClose={onClose}>
      {duplicate ? (
        <p className="dup-warning" role="status">
          <strong>{caregiverName(duplicate.by ?? null, names) ?? 'Someone'}</strong> already logged {duplicate.title.toLowerCase()} {formatAgo(duplicate.at)}
          {duplicate.detail ? ` (${duplicate.detail})` : ''}. Still adding a new one?
        </p>
      ) : null}
      {body}
    </Sheet>
  )
}
