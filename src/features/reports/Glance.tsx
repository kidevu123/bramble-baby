import { BottleTiltIcon, ChevronRightIcon, DiaperIcon, MoonIcon, PillIcon, PlayBlocksIcon, PumpIcon, RulerIcon, ScaleIcon, SpoonIcon, ThermoIcon, TummyIcon } from '../../components/icons'
import type { TimelineItem } from '../../lib/events'
import type { DayLogGroup, ExtraKey, ExtraStat, GlanceKey, GlanceStat, GlanceStatus, OverviewRow } from '../../lib/reports'
import { formatDurationShort, formatTime } from '../../lib/time'
import { Timeline } from '../home/Timeline'
import { Spark } from './charts'
import './glance.css'

const ICON: Record<GlanceKey, typeof MoonIcon> = { sleep: MoonIcon, feeds: BottleTiltIcon, diapers: DiaperIcon, pumping: PumpIcon }
const TONE: Record<GlanceKey, string> = { sleep: 'sleep', feeds: 'feeding', diapers: 'diaper', pumping: 'pumping' }
const SPARK: Record<GlanceKey, string> = { sleep: 'var(--teal)', feeds: 'var(--orange)', diapers: 'var(--yellow)', pumping: 'var(--purple)' }

function statusWord(status: GlanceStatus): string | null {
  return status === 'typical' ? 'typical for age' : status === 'low' ? 'below typical' : status === 'high' ? 'above typical' : null
}

/**
 * The Day view's first screen: four tiles with the day's totals, each against the child's own week
 * ("usual 9h 10m") and the age-typical range. A tap opens that category in Summary.
 */
export function DayGlance({ stats, onOpen }: { stats: GlanceStat[]; onOpen: (key: GlanceKey) => void }) {
  if (!stats.length) return null
  return (
    <ul className="glance-grid" aria-label="At a glance">
      {stats.map((s) => {
        const Icon = ICON[s.key]
        const word = statusWord(s.status)
        return (
          <li key={s.key} className="glance-cell">
          <button type="button" className={`glance-tile soft-${TONE[s.key]} status-${s.status}`} onClick={() => onOpen(s.key)} aria-label={`${s.label}: ${s.value}, ${s.detail}${s.usual ? `, usual ${s.usual}` : ''}${word ? `, ${word}` : ''}`}>
            <span className="glance-head">
              <span className={`icon-circle sm tone-${TONE[s.key]}`} aria-hidden>
                <Icon />
              </span>
              <span className="glance-label">{s.label}</span>
            </span>
            <span className="glance-figure">
              <span className="glance-value">{s.value}</span>
              <span className="glance-detail">{s.detail}</span>
            </span>
            <span className="glance-foot">
              {s.usual ? <span className="glance-usual">usual {s.usual}</span> : <span className="glance-usual">no week to compare yet</span>}
              {word ? (
                <span className="glance-status">
                  <i className="glance-dot" aria-hidden /> {word}
                </span>
              ) : null}
            </span>
          </button>
          </li>
        )
      })}
    </ul>
  )
}

/** The Summary overview: one row per category with its daily average, a sparkline of the range and where it sits for the age. */
export function Overview({ rows, onOpen }: { rows: OverviewRow[]; onOpen: (key: GlanceKey) => void }) {
  return (
    <section className="card overview" aria-label="Overview">
      {rows.map((r) => {
        const Icon = ICON[r.key]
        return (
          <button key={r.key} type="button" className={`overview-row status-${r.status}`} onClick={() => onOpen(r.key)}>
            <span className={`icon-circle sm tone-${TONE[r.key]}`} aria-hidden>
              <Icon />
            </span>
            <span className="overview-main">
              <span className="overview-top">
                <span className="overview-label">{r.label}</span>
                <Spark values={r.series} color={SPARK[r.key]} />
              </span>
              <span className="overview-figure">
                <span className="overview-avg">{r.average}</span>
                <span className="overview-unit">{r.unit}</span>
              </span>
              <span className="overview-note">
                {r.status !== 'none' ? <i className="glance-dot" aria-hidden /> : null}
                {r.note}
              </span>
            </span>
            <ChevronRightIcon className="chev" aria-hidden />
          </button>
        )
      })}
    </section>
  )
}

const EXTRA_ICON: Record<ExtraKey, typeof MoonIcon> = { calories: BottleTiltIcon, weight: ScaleIcon, height: RulerIcon, head: RulerIcon, temperature: ThermoIcon, medicine: PillIcon, tummy: TummyIcon, solids: SpoonIcon, activity: PlayBlocksIcon }
const EXTRA_TONE: Record<ExtraKey, string> = { calories: 'feeding', weight: 'growth', height: 'growth', head: 'growth', temperature: 'temperature', medicine: 'medicine', tummy: 'activity', solids: 'solids', activity: 'activity' }

/** Under the glance tiles: the latest growth and whatever else the day held, each a tap into its Summary category. */
export function DayExtras({ rows, onOpen }: { rows: ExtraStat[]; onOpen: (cat: ExtraStat['cat']) => void }) {
  if (!rows.length) return null
  return (
    <section className="card overview" aria-label="More for this day">
      {rows.map((r) => {
        const Icon = EXTRA_ICON[r.key]
        return (
          <button key={r.key} type="button" className="overview-row extra-row" onClick={() => onOpen(r.cat)} data-testid={`extra-${r.key}`}>
            <span className={`icon-circle sm tone-${EXTRA_TONE[r.key]}`} aria-hidden>
              <Icon />
            </span>
            <span className="overview-main">
              <span className="overview-figure">
                <span className="overview-label">{r.label}</span>
                <span className="overview-avg extra-value">{r.value}</span>
              </span>
              <span className="overview-note">{r.detail}</span>
            </span>
            <ChevronRightIcon className="chev" aria-hidden />
          </button>
        )
      })}
    </section>
  )
}

/**
 * Everything logged that day, by kind (Feeds, Diapers, Sleep, Pumping, Solids, everything else), oldest first,
 * so a family can check nothing was missed; feeds and diapers name their longest gap. Every row opens the
 * entry to edit, like the timeline on Home.
 */
export function DayLog({ groups, onEdit, names }: { groups: DayLogGroup[]; onEdit: (item: TimelineItem) => void; names?: Record<string, string> }) {
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  return (
    <section className="day-log stack" aria-label="Everything logged" data-testid="day-log">
      <header className="day-log-head">
        <h3>Everything logged</h3>
        <span className="small muted">
          {total} {total === 1 ? 'entry' : 'entries'}
        </span>
      </header>
      {groups.length === 0 ? <p className="small muted day-log-empty">No feeds, diapers, sleep or pumping logged this day.</p> : null}
      {groups.map((g) => (
        <div key={g.key} className="day-log-group" data-testid={`day-log-${g.key}`}>
          <div className="day-log-title">
            <span className="day-log-name">{g.title}</span>
            <span className="day-log-count">{g.items.length}</span>
          </div>
          {g.longestGap && g.items.length > 1 ? (
            <p className="small muted day-log-gap">
              Longest gap {formatDurationShort(g.longestGap.seconds)}, {formatTime(g.longestGap.from)} – {formatTime(g.longestGap.to)}
            </p>
          ) : null}
          <Timeline items={g.items} onEdit={onEdit} names={names} emptyText="" />
        </div>
      ))}
    </section>
  )
}
