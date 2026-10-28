import { format } from 'date-fns'
import { BathIcon, BottleIcon, DropIcon, MilestoneIcon, MoonIcon, NoteIcon, NursingIcon, PillIcon, PottyIcon, PumpIcon, RulerIcon, SpoonIcon, StopwatchIcon, ThermoIcon, TummyIcon } from '../../components/icons'
import type { EventKind } from '../../lib/api/types'
import { caregiverName } from '../../lib/caregiver'
import type { TimelineItem } from '../../lib/events'
import './timeline.css'

const ICONS: Partial<Record<EventKind, typeof MoonIcon>> = {
  contractions: StopwatchIcon,
  sleep: MoonIcon,
  nursing: NursingIcon,
  bottle: BottleIcon,
  feeding: BottleIcon,
  diaper: DropIcon,
  potty: PottyIcon,
  pumping: PumpIcon,
  solids: SpoonIcon,
  tummy: TummyIcon,
  activity: BathIcon,
  milestones: MilestoneIcon,
  medicine: PillIcon,
  temperature: ThermoIcon,
  growth: RulerIcon,
  note: NoteIcon,
}

export function TimelineRow({ item, onEdit, names }: { item: TimelineItem; onEdit: (item: TimelineItem) => void; names?: Record<string, string> }) {
  const Icon = ICONS[item.kind] ?? NoteIcon
  const by = caregiverName(item.by ?? null, names)
  return (
    <li>
      <button type="button" className="tl-row" onClick={() => onEdit(item)}>
        <span className={`icon-circle sm tone-${item.kind}`}>
          <Icon />
        </span>
        <span className="grow tl-text">
          <span className="tl-title">
            {item.title}
            <span className="tl-time">{format(item.at, 'h:mm a')}</span>
          </span>
          <span className="tl-detail">
            <span className="tl-detail-text">{item.detail}</span>
            {by ? <span className="tl-by">{by}</span> : null}
          </span>
        </span>
      </button>
    </li>
  )
}

export function Timeline({ items, onEdit, emptyText, names }: { items: TimelineItem[]; onEdit: (item: TimelineItem) => void; emptyText: string; names?: Record<string, string> }) {
  if (items.length === 0) return <p className="tl-empty muted small">{emptyText}</p>
  return (
    <ul className="tl-list card">
      {items.map((item) => (
        <TimelineRow key={item.key} item={item} onEdit={onEdit} names={names} />
      ))}
    </ul>
  )
}
