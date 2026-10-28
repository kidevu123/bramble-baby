import { isToday } from 'date-fns'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { TopBar } from '../../components/nav/TopBar'
import { Sheet } from '../../components/ui/Sheet'
import { useChildren } from '../../hooks/useChildren'
import { useChildSettings } from '../../hooks/useChildSettings'
import { ck } from '../../hooks/useCompanionEvents'
import { rangeDays, useChildEvents, useGrowth, useRunningSleep } from '../../hooks/useEvents'
import { useNow } from '../../hooks/useNow'
import { usePeople } from '../../hooks/usePeople'
import { usePrefs } from '../../hooks/usePrefs'
import { describeApiError } from '../../lib/api/client'
import { companion, type MilkBag, type MilkLocation } from '../../lib/api/companion'
import type { EventKind, Pumping } from '../../lib/api/types'
import { isExpecting } from '../../lib/child'
import { ageBasis } from '../../lib/preterm'
import { analyzeContractions } from '../../lib/contractions'
import { buildTimeline, describeDiaper, describeFeeding, isPotty, latestOf, summarizeDay, type EventSets, type TimelineItem } from '../../lib/events'
import { formatAgo, formatDurationShort, parseDate, parseDuration } from '../../lib/time'
import { formatTemp, formatVolume, type UnitPrefs } from '../../lib/units'
import { LogSheet, type LogRequest } from '../log/LogSheet'
import { MilkLabelSheet } from '../log/MilkLabelSheet'
import { clearLabelHandoff, peekLabelHandoff } from '../../lib/labels'
import { clearLogHandoff, peekLogHandoff } from '../../lib/nudges'
import { ReminderSheet } from '../log/ReminderSheet'
import { useNotifications } from '../notifications/useNotifications'
import { useNudgeTouch } from '../notifications/useNudges'
import { useNapSchedule } from '../notifications/useNapSchedule'
import { ActiveTimers } from '../timer/ActiveTimers'
import { CustomizeSheet } from './CustomizeSheet'
import { InboxSheet } from './InboxSheet'
import { ScheduleCreatorSheet } from '../child/ChildSettingsSheets'
import { HomeTiles, type TileInfo } from './HomeTiles'
import { QuickType } from './QuickType'
import { NapBand } from './NapBand'
import { Timeline } from './Timeline'
import './home.css'

function tileInfo(events: EventSets, units: UnitPrefs, now: Date): Partial<Record<EventKind, TileInfo>> {
  const info: Partial<Record<EventKind, TileInfo>> = {}
  const s = latestOf(events.sleep, (x) => x.end)
  if (s) info.sleep = { status: `Woke ${formatAgo(s.end, now)} · slept ${formatDurationShort(parseDuration(s.duration))}` }
  const nurse = latestOf(events.feedings.filter((f) => f.type !== 'solid food' && f.method !== 'bottle'), (x) => x.start)
  if (nurse) info.nursing = { status: `${formatAgo(nurse.start, now)} · ${nurse.method === 'left breast' ? 'last side L' : nurse.method === 'right breast' ? 'last side R' : 'both sides'}` }
  const bottle = latestOf(events.feedings.filter((f) => f.method === 'bottle'), (x) => x.start)
  if (bottle) info.bottle = { status: `${formatAgo(bottle.start, now)}${bottle.amount ? ` · ${formatVolume(bottle.amount, units.volume)}` : ''}` }
  const solids = latestOf(events.feedings.filter((f) => f.type === 'solid food'), (x) => x.start)
  if (solids) info.solids = { status: `${formatAgo(solids.start, now)} · ${describeFeeding(solids, units)}` }
  const diaper = latestOf(events.changes.filter((d) => !isPotty(d)), (x) => x.time)
  if (diaper) info.diaper = { status: `${formatAgo(diaper.time, now)} · ${describeDiaper(diaper)}` }
  const potty = latestOf(events.changes.filter(isPotty), (x) => x.time)
  if (potty) info.potty = { status: `${formatAgo(potty.time, now)} · ${describeDiaper(potty).replace('Potty · ', '')}` }
  const pump = latestOf(events.pumping, (x) => x.start)
  if (pump) info.pumping = { status: `${formatAgo(pump.start, now)}${pump.amount ? ` · ${formatVolume(pump.amount, units.volume)}` : ''}` }
  const ms = [...events.milestones].sort((a, b) => b.date.localeCompare(a.date))[0]
  if (ms) info.milestones = { status: ms.title }
  const med = latestOf(events.medication, (x) => x.time)
  if (med) info.medicine = { status: `${formatAgo(med.time, now)} · ${med.name}` }
  const act = latestOf([...events.activities.map((a) => ({ start: a.start, label: a.type })), ...events.tummy.map((t) => ({ start: t.start, label: 'tummy time' }))], (x) => x.start)
  if (act) info.activity = { status: `${formatAgo(act.start, now)} · ${act.label}` }
  const temp = latestOf(events.temperature, (x) => x.time)
  if (temp) info.temperature = { status: `${formatAgo(temp.time, now)} · ${formatTemp(temp.temperature, units.temp)}` }
  const stats = analyzeContractions(events.contractions, now)
  if (stats.count) info.contractions = { status: stats.summary }
  return info
}

export function HomePage() {
  const { child } = useChildren()
  const { prefs } = usePrefs()
  const navigate = useNavigate()
  const now = useNow(30_000)
  const dayKey = now.toDateString()
  const range = useMemo(() => rangeDays(14, now), [dayKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const events = useChildEvents(child?.id ?? null, range)
  const growth = useGrowth(child?.id ?? null)
  const asleepSince = useRunningSleep(child?.id ?? null)
  const { settings } = useChildSettings(child?.id ?? null)
  const { names } = usePeople()
  const notifications = useNotifications(child?.id ?? null)
  const reminders = useQuery({
    queryKey: ck.reminders(child?.id ?? 0),
    enabled: child !== null,
    queryFn: () => companion.reminders.list(child!.id).catch(() => []),
    refetchInterval: 60_000,
  })
  // A tapped push ("Oscar usually eats about now") lands here with the sheet it asked for already open,
  // defaulting to just now; the hand-off is consumed once so a reload does not reopen it.
  const [request, setRequest] = useState<LogRequest | null>(() => {
    const kind = peekLogHandoff()
    return kind && kind !== 'contractions' ? { kind } : null
  })
  useEffect(() => clearLogHandoff(), [])
  const [reminderFor, setReminderFor] = useState<EventKind | null>(null)
  const [customize, setCustomize] = useState(false)
  const [inbox, setInbox] = useState(false)
  const [schedule, setSchedule] = useState(false)
  // A pumping timer that just stopped hands its saved entry over so the milk label is one tap away.
  // The pumping timer hands over the entry it saved and where the milk went (it opens the label sheet here).
  const [labelFor, setLabelFor] = useState<(Pumping & { location?: MilkLocation }) | null>(() => peekLabelHandoff<Pumping & { location?: MilkLocation }>())
  // Stable while nothing changed, so the label sheet does not redraw its PNG on every 30 s tick.
  const labelInput = useMemo(
    () => (labelFor && child ? { childName: child.first_name, pumpedAt: parseDate(labelFor.start), amount: labelFor.amount, unit: prefs.units.volume, notes: labelFor.notes, birthDate: child.birth_date } : null),
    [labelFor, child, prefs.units.volume],
  )
  const [labelBag, setLabelBag] = useState<MilkBag | null>(null)
  useEffect(() => clearLabelHandoff(), [])

  const { bornAtDays, nicu } = settings
  const ageBasisOf = useMemo(() => (child ? ageBasis(child, { bornAtDays, nicu }) : null), [child, bornAtDays, nicu])
  useNapSchedule(child, events.sleep, settings.sweetSpot, Boolean(notifications.state?.subscribed), asleepSince, ageBasisOf)
  // What the nudges are computed from; a change (a feed just saved) makes the server recompute at once.
  useNudgeTouch(child?.id ?? null, `${latestOf(events.feedings, (f) => f.start)?.id ?? 0}|${events.feedings.length}|${latestOf(events.pumping, (p) => p.start)?.id ?? 0}|${events.pumping.length}|${latestOf(events.changes, (c) => c.time)?.id ?? 0}|${events.changes.length}`, Boolean(notifications.state?.subscribed))

  const timeline = useMemo(() => buildTimeline({ ...events, growth: growth.data }, prefs.units), [events, growth.data, prefs.units])
  const today = useMemo(() => timeline.filter((i) => isToday(i.at)), [timeline])
  const summary = useMemo(() => summarizeDay(events, now), [events, now])
  const info = useMemo(() => tileInfo(events, prefs.units, now), [events, prefs.units, now])
  const reminderCounts = useMemo(() => {
    const counts: Partial<Record<EventKind, number>> = {}
    for (const r of reminders.data ?? []) {
      if (r.sent || !r.tag.startsWith('reminder:')) continue
      const k = r.tag.slice('reminder:'.length) as EventKind
      counts[k] = (counts[k] ?? 0) + 1
    }
    return counts
  }, [reminders.data])

  const onOpen = useCallback(
    (kind: EventKind) => {
      if (kind === 'contractions') navigate('/contractions')
      else setRequest({ kind })
    },
    [navigate],
  )
  const onEdit = useCallback((item: TimelineItem) => (item.kind === 'contractions' ? navigate('/contractions') : setRequest({ kind: item.kind, editing: item })), [navigate])
  const close = useCallback(() => setRequest(null), [])

  if (!child) return null
  const expecting = isExpecting(child, now)
  const tiles = settings.homeTiles.filter((t) => (t === 'contractions' ? expecting || settings.homeTiles.includes('contractions') && events.contractions.length > 0 : true))
  const orderedTiles = expecting ? ['contractions', ...tiles.filter((t) => t !== 'contractions')] : tiles

  return (
    <>
      <TopBar onInbox={() => setInbox(true)} inboxCount={(reminders.data ?? []).filter((r) => !r.sent).length} />
      <main className="page home-page">
        <NapBand child={child} sleeps={events.sleep} now={now} wakeWindowAdjustMinutes={settings.sweetSpot.wakeWindowAdjustMinutes} asleepSince={asleepSince} onSchedule={() => setSchedule(true)} />
        <ActiveTimers child={child.id} />
        {events.isError ? (
          <p className="log-error" role="alert">
            {describeApiError(events.error)}
          </p>
        ) : null}

        <HomeTiles tiles={orderedTiles} info={info} onOpen={onOpen} onReminder={setReminderFor} reminderCounts={reminderCounts} />
        {/* Choosing the tiles is rare, so it sits under them rather than as a heading row above them. */}
        <div className="tiles-foot">
          <button type="button" className="customize-link" onClick={() => setCustomize(true)} aria-label="Customize home">
            Customize tiles
          </button>
        </div>
        {!expecting ? <QuickType units={prefs.units} onOpen={(prefill) => setRequest({ kind: prefill.kind, prefill })} /> : null}

        <section className="stack">
          <div className="row-between">
            <h3>Today</h3>
            {!expecting ? (
              <div className="today-chips">
                <span className="chip soft-sleep text-sleep">{formatDurationShort(summary.sleepSeconds)} sleep</span>
                <span className="chip soft-feeding text-feeding">
                  {summary.feedCount} feeds{summary.bottleVolume ? ` · ${formatVolume(summary.bottleVolume, prefs.units.volume)}` : ''}
                </span>
                <span className="chip soft-diaper text-diaper">{summary.diaperCount} diapers</span>
              </div>
            ) : null}
          </div>
          <Timeline items={today} onEdit={onEdit} names={names} emptyText={events.isLoading ? 'Loading today…' : 'Nothing logged yet today. Tap a tile above to start.'} />
        </section>
      </main>
      <LogSheet request={request} child={child} recentFeedings={events.feedings} recent={timeline} names={names} onClose={close} />
      <Sheet open={reminderFor !== null} title={reminderFor ? `${reminderFor[0].toUpperCase()}${reminderFor.slice(1)} reminder` : ''} onClose={() => setReminderFor(null)}>
        {reminderFor ? <ReminderSheet child={child} kind={reminderFor} /> : null}
      </Sheet>
      <CustomizeSheet open={customize} child={child} onClose={() => setCustomize(false)} />
      <InboxSheet open={inbox} child={child} onClose={() => setInbox(false)} />
      <ScheduleCreatorSheet open={schedule} child={child} onClose={() => setSchedule(false)} />
      <MilkLabelSheet
        open={labelFor !== null}
        child={child.id}
        pumpingId={labelFor?.id ?? null}
        location={labelFor?.location ?? 'fridge'}
        bag={labelBag}
        onRegistered={setLabelBag}
        input={labelInput}
        onClose={() => setLabelFor(null)}
      />
    </>
  )
}
