import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { TopBar } from '../../components/nav/TopBar'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Field'
import { Sheet } from '../../components/ui/Sheet'
import { CalendarClockIcon, CheckIcon, ChevronRightIcon, MoonIcon, PlusIcon, RulerIcon } from '../../components/icons'
import { describeDueDate, isExpecting } from '../../lib/child'
import { ageBasis, beforeDue, correctedAgeText, holdLine } from '../../lib/preterm'
import { DayNightCard, ScheduleCreatorSheet, NapSettingsSheet, WeightGoalCard } from './ChildSettingsSheets'
import { buildGrowthItems, GROWTH_LABEL, growthKindOf, type TimelineItem } from '../../lib/events'
import { useChildSettings } from '../../hooks/useChildSettings'
import { growthPercentileLabel } from '../../lib/reports'
import { PillChoice } from '../../components/ui/Field'
import { useChildren } from '../../hooks/useChildren'
import { useGrowth } from '../../hooks/useEvents'
import { usePrefs } from '../../hooks/usePrefs'
import { describeApiError } from '../../lib/api/client'
import { children as childrenApi } from '../../lib/api/endpoints'
import { qk } from '../../lib/api/keys'
import type { Child, GrowthEntry, GrowthKind } from '../../lib/api/types'
import { growthEntryTime } from '../../lib/growth-note'
import { formatAge, parseDate } from '../../lib/time'
import { LogSheet, type LogRequest } from '../log/LogSheet'
import { format } from 'date-fns'
import './child.css'

export function ChildPage() {
  const { child, children, select } = useChildren()
  const { prefs } = usePrefs()
  const growth = useGrowth(child?.id ?? null)
  const [editing, setEditing] = useState<Child | 'new' | null>(null)
  const [request, setRequest] = useState<LogRequest | null>(null)
  const [historyKind, setHistoryKind] = useState<GrowthKind>('weight')
  const [showAllHistory, setShowAllHistory] = useState(false)
  // Nap window settings and the Schedule Creator live here; Home and the nap window page open the same
  // Schedule Creator sheet in place rather than sending the user to this tab.
  const [sheet, setSheet] = useState<'nap' | 'schedule' | null>(null)
  const { settings, update: updateSettings } = useChildSettings(child?.id ?? null)
  if (!child) return null
  const expecting = isExpecting(child)
  // Settings › Born early: the corrected age (or the weeks before the due date) beside the real one, and the
  // WHO percentiles counted from the due date.
  const basis = ageBasis(child, settings)
  const corrected = expecting ? null : correctedAgeText(basis)
  const held = expecting ? null : holdLine(basis)

  // Newest first; two entries on one day order by the clock in their note (growth-note.ts).
  const items = buildGrowthItems(growth.data, prefs.units).sort((a, b) => b.at.getTime() - a.at.getTime())
  const latestOf = (kind: GrowthKind) => items.find((i) => growthKindOf(i.raw as GrowthEntry) === kind)
  const latestW = latestOf('weight')
  const latestH = latestOf('height')
  const latestHead = latestOf('head')
  const sex = settings.sex ?? null
  // The same percentile Reports shows: aged on the entry's own date (src/lib/reports.ts growthPercentileLabel).
  // WHO curves stop at 24 months; past that the label is empty rather than a number from the wrong row.
  const pctLabel = (item: TimelineItem | undefined) => {
    const p = item ? growthPercentileLabel(item.raw as GrowthEntry, basis, sex, prefs.units) : ''
    return p ? ` · ${p}` : ''
  }
  // "Oct 6, 8:38 AM" when the entry carries a time; just the date when it does not (never a made-up noon).
  // The clock never breaks across lines, so a narrow stat tile wraps as "Oct 6," / "8:38 AM", not "… 8:38" / "AM".
  const when = (item: TimelineItem, dateFormat: string) =>
    growthEntryTime(item.raw as GrowthEntry) ? (
      <>
        {format(item.at, dateFormat)}, <span style={{ whiteSpace: 'nowrap' }}>{format(item.at, 'h:mm a')}</span>
      </>
    ) : (
      format(item.at, dateFormat)
    )
  const history = items.filter((i) => growthKindOf(i.raw as GrowthEntry) === historyKind)
  const visibleHistory = showAllHistory ? history : history.slice(0, 5)
  const editGrowth = (item: TimelineItem) => setRequest({ kind: 'growth', editing: item })

  return (
    <>
      {/* No page title and no "+" here: the Child tab is already lit, the hero names the child, and
          "Add another child" below is the one way in to that sheet. The child's name keeps the room. */}
      <TopBar />
      <main className="page">
        {/* The 1.27 hero, sideways: the big avatar beside the name, the age and Edit profile, so growth starts higher. */}
        <section className="card child-hero">
          <Avatar child={child} size={88} />
          <div className="child-hero-text">
            <h1>
              {child.first_name} {child.last_name}
            </h1>
            {expecting ? (
              <p className="muted">{describeDueDate(child)}</p>
            ) : (
              <p className="muted">
                <span className="child-hero-piece">{formatAge(child.birth_date)} old</span>
                {corrected ? (
                  <span className="child-hero-piece" data-testid="corrected-age">
                    {corrected}
                    {basis.due && beforeDue(basis) ? ` · due ${format(parseDate(basis.due), 'MMM d')}` : null}
                  </span>
                ) : null}
                <span className="child-hero-piece">born {format(parseDate(child.birth_date), 'MMM d, yyyy')}</span>
                {held?.startsWith('In the NICU') ? <span className="child-hero-piece">in the NICU</span> : null}
              </p>
            )}
            <Button variant="secondary" onClick={() => setEditing(child)}>
              Edit profile
            </Button>
          </div>
        </section>

        <section className="card card-pad stack">
          <div className="row-between">
            <div className="row">
              <span className="icon-circle sm tone-growth">
                <RulerIcon />
              </span>
              <h3>Growth</h3>
            </div>
            <Button variant="ghost" onClick={() => setRequest({ kind: 'growth' })}>
              + Add
            </Button>
          </div>
          <p className="xs muted">Tap a measurement to fix a wrong number or time.</p>
          <div className="growth-grid">
            <button type="button" className="growth-stat" onClick={() => (latestW ? editGrowth(latestW) : setRequest({ kind: 'growth', growthKind: 'weight' }))} aria-label="Edit latest weight">
              <span className="xs muted">Weight</span>
              <span className="strong">{latestW ? latestW.detail : '—'}</span>
              {latestW ? <span className="xs muted">{when(latestW, 'MMM d')}{pctLabel(latestW)}</span> : null}
            </button>
            <button type="button" className="growth-stat" onClick={() => (latestH ? editGrowth(latestH) : setRequest({ kind: 'growth', growthKind: 'height' }))} aria-label="Edit latest height">
              <span className="xs muted">Height</span>
              <span className="strong">{latestH ? latestH.detail : '—'}</span>
              {latestH ? <span className="xs muted">{when(latestH, 'MMM d')}{pctLabel(latestH)}</span> : null}
            </button>
            <button type="button" className="growth-stat" onClick={() => (latestHead ? editGrowth(latestHead) : setRequest({ kind: 'growth', growthKind: 'head' }))} aria-label="Edit latest head circumference">
              <span className="xs muted">Head</span>
              <span className="strong">{latestHead ? latestHead.detail : '—'}</span>
              {latestHead ? <span className="xs muted">{when(latestHead, 'MMM d')}{pctLabel(latestHead)}</span> : null}
            </button>
          </div>
          <div className="row-between sex-row">
            <span className="small muted">WHO percentiles for a</span>
            <PillChoice tone="teal" value={sex} onChange={(v) => updateSettings({ sex: v })} options={[{ value: 'male', label: 'Boy' }, { value: 'female', label: 'Girl' }]} />
          </div>
          <div className="stack growth-history">
            <PillChoice tone="teal" value={historyKind} onChange={(k) => { setHistoryKind(k); setShowAllHistory(false) }} options={[{ value: 'weight', label: 'Weight' }, { value: 'height', label: 'Height' }, { value: 'head', label: 'Head' }]} />
            {history.length === 0 ? <p className="small muted">No {GROWTH_LABEL[historyKind].toLowerCase()} logged yet.</p> : null}
            <ul className="growth-list">
              {visibleHistory.map((item) => (
                <li key={item.key}>
                  <button type="button" className="growth-row" onClick={() => editGrowth(item)}>
                    <span className="strong">{item.detail}</span>
                    <span className="xs muted">{when(item, 'MMM d, yyyy')}</span>
                    <ChevronRightIcon className="chev" />
                  </button>
                </li>
              ))}
            </ul>
            {history.length > 5 && !showAllHistory ? (
              <Button variant="ghost" onClick={() => setShowAllHistory(true)}>
                Show all {history.length}
              </Button>
            ) : null}
          </div>
        </section>

        <WeightGoalCard child={child} />
        <div className="card profile-links">
          <button type="button" className="profile-link" onClick={() => setSheet('nap')}>
            <span className="icon-circle tone-sleep">
              <MoonIcon />
            </span>
            <span className="grow profile-link-title">Nap window settings</span>
            <ChevronRightIcon className="chev" />
          </button>
          <button type="button" className="profile-link" onClick={() => setSheet('schedule')}>
            <span className="icon-circle tone-feeding">
              <CalendarClockIcon />
            </span>
            <span className="grow profile-link-title">Schedule Creator</span>
            <ChevronRightIcon className="chev" />
          </button>
        </div>

        <DayNightCard child={child} />

        <section className="stack">
          {children.length > 1 ? <p className="section-title">Children</p> : null}
          <ul className="child-list card">
            {/* With one child the hero already names them: the list starts when there is a choice to make. */}
            {(children.length > 1 ? children : []).map((c) => (
              <li key={c.id}>
                <button type="button" className="child-row" onClick={() => select(c.id)} aria-pressed={c.id === child.id}>
                  <Avatar child={c} size={36} />
                  <span className="grow">
                    <span className="strong">{c.first_name}</span>
                    <span className="xs muted" style={{ display: 'block' }}>
                      {formatAge(c.birth_date)}
                    </span>
                  </span>
                  {c.id === child.id ? <CheckIcon className="child-check" /> : null}
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="child-row" onClick={() => setEditing('new')}>
                <span className="icon-circle sm" style={{ background: 'var(--surface-2)', color: 'var(--text-strong)' }}>
                  <PlusIcon />
                </span>
                <span className="strong">Add another child</span>
              </button>
            </li>
          </ul>
        </section>

      </main>

      <NapSettingsSheet open={sheet === 'nap'} child={child} onClose={() => setSheet(null)} />
      <ScheduleCreatorSheet open={sheet === 'schedule'} child={child} onClose={() => setSheet(null)} />
      <ChildEditor key={editing === null ? 'closed' : editing === 'new' ? 'new' : `child-${editing.id}`} target={editing} onClose={() => setEditing(null)} />
      <LogSheet request={request} child={child} onClose={() => setRequest(null)} />
    </>
  )
}

function ChildEditor({ target, onClose }: { target: Child | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { update } = usePrefs()
  const initial = target && target !== 'new' ? target : null
  const [firstName, setFirstName] = useState(initial?.first_name ?? '')
  const [lastName, setLastName] = useState(initial?.last_name ?? '')
  const [birthDate, setBirthDate] = useState(initial?.birth_date ?? '')
  // The parent keys this editor on its target, so a different child (or Add child) opens a fresh form and a
  // fresh mutation; nothing is reset during render.
  const save = useMutation({
    mutationFn: async () => {
      const body = { first_name: firstName.trim(), last_name: lastName.trim(), birth_date: birthDate }
      return initial ? childrenApi.update(initial.slug, body) : childrenApi.create(body)
    },
    onSuccess: async (child) => {
      if (!initial) update({ selectedChild: child.id })
      await qc.invalidateQueries({ queryKey: qk.children })
      onClose()
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Sheet
      open={target !== null}
      title={initial ? 'Edit profile' : 'Add child'}
      onClose={onClose}
      footer={
        <Button type="submit" form="child-editor-form" size="lg" block loading={save.isPending}>
          Save
        </Button>
      }
    >
      <form id="child-editor-form" className="stack" onSubmit={onSubmit} style={{ gap: 20 }}>
        <TextField label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        <TextField label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        <TextField label="Birth date or due date" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
        {save.isError ? (
          <p className="log-error" role="alert">
            {describeApiError(save.error)}
          </p>
        ) : null}
      </form>
    </Sheet>
  )
}
