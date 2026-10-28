import { Fragment, useLayoutEffect, useRef, type ReactNode } from 'react'
import {
  AlarmPlusIcon,
  BathIcon,
  BottleTiltIcon,
  BowlIcon,
  DiaperIcon,
  MilestoneIcon,
  NursingIcon,
  PillIcon,
  PottyIcon,
  PumpIcon,
  RulerIcon,
  SleepZIcon,
  StopwatchIcon,
  ThermoIcon,
} from '../../components/icons'
import type { EventKind } from '../../lib/api/types'
import './home-tiles.css'

export interface TileInfo {
  /** One-line status shown under the label, e.g. "Woke 45m ago · slept 1h 20m". */
  status?: string
}

interface Props {
  tiles: string[]
  info: Partial<Record<EventKind, TileInfo>>
  onOpen: (kind: EventKind) => void
  onReminder: (kind: EventKind) => void
  reminderCounts?: Partial<Record<EventKind, number>>
}

const ICONS: Partial<Record<EventKind, (p: React.SVGProps<SVGSVGElement>) => ReactNode>> = {
  contractions: StopwatchIcon,
  sleep: SleepZIcon,
  nursing: NursingIcon,
  bottle: BottleTiltIcon,
  solids: BowlIcon,
  diaper: DiaperIcon,
  potty: PottyIcon,
  pumping: PumpIcon,
  milestones: MilestoneIcon,
  medicine: PillIcon,
  activity: BathIcon,
  growth: RulerIcon,
  temperature: ThermoIcon,
}

// Whole words only: a split tile that is too narrow for its label shrinks the label (useFitLabels), it never
// hyphenates ("Mile-stones", "Tempera-ture" read as broken).
const LABELS: Partial<Record<EventKind, string>> = {
  contractions: 'Contractions',
  sleep: 'Sleep',
  nursing: 'Nursing',
  bottle: 'Bottle',
  solids: 'Solids',
  diaper: 'Diaper',
  potty: 'Potty',
  pumping: 'Pumping',
  milestones: 'Milestones',
  medicine: 'Medicine',
  activity: 'Activity',
  growth: 'Growth',
  temperature: 'Temperature',
}

const plain = (label: string | undefined) => label ?? ''

/** Smallest split-tile label size (px); below it the label truncates instead (never seen at 320 px). */
const MIN_LABEL_PX = 13

/**
 * Split-tile labels are one word on one line. When a word is wider than its tile (Temperature at 320 px,
 * Medicine beside an alarm), the label's font steps down until it fits, from the size the stylesheet gives.
 */
function useFitLabels(dep: string) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const fit = () => {
      for (const el of root.querySelectorAll<HTMLElement>('.split .tile-label')) {
        el.style.fontSize = ''
        const room = el.clientWidth
        const need = el.scrollWidth
        if (need <= room + 0.5 || room === 0) continue
        const base = parseFloat(getComputedStyle(el).fontSize)
        el.style.fontSize = `${Math.max(MIN_LABEL_PX, Math.floor(((base * room) / need) * 10) / 10)}px`
      }
    }
    fit()
    void document.fonts?.ready.then(fit)
    // Older WebKit and the test DOM have no ResizeObserver: fitted once on mount and when the fonts land.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(fit)
    ro.observe(root)
    return () => ro.disconnect()
  }, [dep])
  return ref
}

/** Tiles that can carry a reminder (the alarm-plus badge). */
const REMINDABLE = new Set<EventKind>(['bottle', 'solids', 'potty', 'medicine', 'pumping', 'diaper'])

/** Pairs render side by side when both are enabled, in two columns. */
const PAIRS: [EventKind, EventKind][] = [
  ['nursing', 'bottle'],
  ['diaper', 'potty'],
  ['milestones', 'medicine'],
  ['growth', 'temperature'],
]

function layoutRows(tiles: EventKind[]): EventKind[][] {
  const enabled = new Set(tiles)
  const rows: EventKind[][] = []
  const used = new Set<EventKind>()
  for (const t of tiles) {
    if (used.has(t)) continue
    const pair = PAIRS.find(([a, b]) => (a === t || b === t) && enabled.has(a) && enabled.has(b))
    if (pair) {
      rows.push([pair[0], pair[1]])
      used.add(pair[0])
      used.add(pair[1])
    } else {
      rows.push([t])
      used.add(t)
    }
  }
  return rows
}

export function HomeTiles({ tiles, info, onOpen, onReminder, reminderCounts }: Props) {
  const rows = layoutRows(tiles.filter((t): t is EventKind => t in LABELS))
  const ref = useFitLabels(rows.map((r) => r.join('-')).join('|'))
  return (
    <div className="tiles" ref={ref}>
      {rows.map((row) => (
        <div key={row.join('-')} className={row.length === 2 ? 'tile-row split' : 'tile-row'}>
          {row.map((kind) => {
            const Icon = ICONS[kind]!
            const full = info[kind]?.status
            // Split tiles are narrow: keep just the leading "x ago" part.
            const status = full && row.length === 2 ? full.split(' · ')[0] : full
            const count = reminderCounts?.[kind] ?? 0
            const alarm = REMINDABLE.has(kind)
            return (
              <div key={kind} className={`tile tile-${kind}${alarm ? ' has-alarm' : ''}`}>
                <button type="button" className="tile-main" onClick={() => onOpen(kind)} aria-label={`${plain(LABELS[kind])}${status ? `, ${status}` : ''}`}>
                  <Icon className="tile-watermark" />
                  <span className="tile-text">
                    <span className="tile-label">{LABELS[kind]}</span>
                    {status ? (
                      <span className="tile-status">
                        {/* A long status wraps between its parts ("Woke 1h ago ·" / "slept 45m"), never inside one. */}
                        {status.split(' · ').map((part, i, all) => (
                          <Fragment key={i}>
                            {i ? ' ' : ''}
                            <span className="tile-status-part">{i < all.length - 1 ? `${part} ·` : part}</span>
                          </Fragment>
                        ))}
                      </span>
                    ) : null}
                  </span>
                </button>
                {alarm ? (
                  <button type="button" className={count ? 'tile-alarm has' : 'tile-alarm'} onClick={() => onReminder(kind)} aria-label={`Set ${plain(LABELS[kind])} reminder`}>
                    <AlarmPlusIcon />
                    {count ? <span className="tile-alarm-count">{count}</span> : null}
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
