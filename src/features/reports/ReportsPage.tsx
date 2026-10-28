import { addDays, format, isSameDay, startOfDay } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TopBar } from '../../components/nav/TopBar'
import { Segmented } from '../../components/ui/Segmented'
import { ChevronLeftIcon, ChevronRightIcon, SlidersIcon } from '../../components/icons'
import { useChildren } from '../../hooks/useChildren'
import { useAgeBasis } from '../../hooks/useAgeBasis'
import { useChildSettings } from '../../hooks/useChildSettings'
import { rangeDays, useChildEvents, useGrowth } from '../../hooks/useEvents'
import { useNow } from '../../hooks/useNow'
import { usePeople } from '../../hooks/usePeople'
import { usePrefs } from '../../hooks/usePrefs'
import { buildTimeline, type TimelineItem } from '../../lib/events'
import { hhmmToHours } from '../../lib/time'
import { formatDayLabel } from '../../lib/time'
import { Timeline } from '../home/Timeline'
import { LogSheet, type LogRequest } from '../log/LogSheet'
import { CalendarView } from './CalendarView'
import { ReportSettingsSheet } from './ReportSettingsSheet'
import { SummaryView } from './SummaryView'
import { CAT_OF_GLANCE, type Cat } from './categories'
import { calorieTracking } from '../../lib/calories'
import { DayExtras, DayGlance, DayLog } from './Glance'
import { DayStrip } from './DayStrip'
import { dayExtras, dayGlance, dayLog, type GlanceKey } from '../../lib/reports'
import type { Child } from '../../lib/api/types'
import { dayKey, dayOf, fetchDays, readView, reportToday, writeView, type Span, type View } from './view-state'
import './reports.css'

const GLANCE_FILTER: Record<GlanceKey, string> = { sleep: 'sleep', feeds: 'feeding', diapers: 'diaper', pumping: 'pumping' }
const KIND_TO_FILTER: Record<string, string> = {
  contractions: 'contractions',
  milestones: 'milestones',
  sleep: 'sleep',
  nursing: 'feeding',
  bottle: 'feeding',
  feeding: 'feeding',
  solids: 'solids',
  diaper: 'diaper',
  potty: 'diaper',
  pumping: 'pumping',
  activity: 'activity',
  tummy: 'activity',
  medicine: 'medicine',
  growth: 'growth',
  temperature: 'temperature',
  note: 'note',
}

export function ReportsPage() {
  const { child } = useChildren()
  if (!child) return null
  // One body per child: switching child reads that child's saved view rather than carrying this one over.
  return <ReportsBody key={child.id} child={child} />
}

function ReportsBody({ child }: { child: Child }) {
  const navigate = useNavigate()
  const { prefs } = usePrefs()
  const { settings } = useChildSettings(child.id)
  const tracking = useMemo(() => calorieTracking(settings), [settings])
  const age = useAgeBasis(child)
  const { names } = usePeople()
  // The view, category, range and paged day survive a trip to the pediatrician report, Settings or Insights
  // and back (the route change unmounts this page): kept per child for this session, never in the URL.
  const [saved] = useState(() => readView(child.id))
  const [view, setView] = useState<View>(saved.view)
  const [cat, setCat] = useState<Cat>(saved.cat)
  const [span, setSpan] = useState<Span>(saved.span)
  const startHourNow = () => (settings.reportDayStart === 'day' ? hhmmToHours(settings.dayStart) : 0)
  const [day, setDay] = useState(() => dayOf(saved, new Date(), startHourNow()))
  // Showing "today" follows today (past midnight, past the day start); a day paged to stays put.
  const followingToday = useRef(!saved.day)
  const [request, setRequest] = useState<LogRequest | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Moves while the page stays open (the day strip's now line, Next day across midnight, today's glance).
  const now = useNow(60_000)
  const nowKey = now.toDateString()
  useEffect(() => writeView(child.id, { view, cat, span, day: followingToday.current ? null : dayKey(day, new Date(), startHourNow()) }), [child.id, view, cat, span, day]) // eslint-disable-line react-hooks/exhaustive-deps

  const pagedBack = Math.round((startOfDay(now).getTime() - day.getTime()) / 86_400_000)
  const days = fetchDays(span, pagedBack)
  const range = useMemo(() => rangeDays(days, now), [days, nowKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const events = useChildEvents(child.id, range)
  const growth = useGrowth(child.id)
  // A wider range is fetched fresh: until it answers the day must not read "0 feeds · below typical".
  const loading = events.isLoading
  const filters = settings.reportFilters
  const timeline = useMemo(
    () => buildTimeline({ ...events, growth: growth.data }, prefs.units).filter((t) => filters[KIND_TO_FILTER[t.kind] ?? t.kind] !== false),
    [events, growth.data, prefs.units, filters],
  )
  /** A glance tile or an overview row opens its category in Summary. */
  const openCat = useCallback((key: GlanceKey) => {
    setCat(CAT_OF_GLANCE[key])
    setView('summary')
  }, [])
  // The tiles, the extras and the strip count the same day: from the day-start time when Reports is set to
  // "day starts at", else midnight to midnight.
  const dayStartHour = startHourNow()
  const today = reportToday(now, dayStartHour)
  useEffect(() => {
    if (followingToday.current && day.getTime() !== today.getTime()) setDay(today)
  }, [today.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  // The Day view honours the report filters like the list and the strip: a category switched off in Reports
  // settings has no tile and no row (its Summary tab is gone too, so a tap would land on Overview).
  const glance = useMemo(
    () => (view === 'day' && !loading ? dayGlance(events, child, prefs.units, day, now, dayStartHour, age).filter((g) => filters[GLANCE_FILTER[g.key]] !== false) : []),
    [events, child, prefs.units, day, now, view, filters, loading, dayStartHour, age],
  )
  const extras = useMemo(
    () => (view === 'day' && !loading ? dayExtras(events, growth.data, child, prefs.units, settings.sex ?? null, day, now, dayStartHour, age, tracking).filter((e) => filters[e.cat === 'feed' ? 'feeding' : e.cat] !== false) : []),
    [events, growth.data, child, prefs.units, settings.sex, day, now, view, filters, loading, dayStartHour, age, tracking],
  )
  // Everything logged that day, by kind, in the same window and through the same filters as the tiles: the way to
  // check a day was logged in full.
  const log = useMemo(() => (view === 'day' && !loading ? dayLog(timeline, day, dayStartHour) : []), [timeline, day, dayStartHour, view, loading])
  const openCategory = useCallback((c: Cat) => {
    setCat(c)
    setView('summary')
  }, [])
  const onEdit = useCallback((item: TimelineItem) => (item.kind === 'contractions' ? navigate('/contractions') : setRequest({ kind: item.kind, editing: item })), [navigate])

  const step = view === 'day' ? 1 : 7
  const canForward = day < today
  const weekStart = addDays(day, -6)
  const label = view === 'day' ? formatDayLabel(day, now) : `${format(weekStart, 'MMM d')} – ${format(day, 'MMM d')}`


  return (
    <>
      <TopBar
        rightSlot={
          <button type="button" className="topbar-icon" aria-label="Reports settings" onClick={() => setSettingsOpen(true)}>
            <SlidersIcon />
          </button>
        }
      />
      <main className="page reports-page">
        <Segmented label="Report view" options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'list', label: 'List' }, { value: 'summary', label: 'Summary' }]} value={view} onChange={setView} />

        {view !== 'summary' ? (
          <div className="week-nav">
            <button type="button" className="week-btn" onClick={() => {
                followingToday.current = false
                setDay(addDays(day, -step))
              }} aria-label={view === 'day' ? 'Previous day' : 'Previous week'}>
              <ChevronLeftIcon />
            </button>
            <span className="week-label">{label}</span>
            <button type="button" className="week-btn" disabled={!canForward} onClick={() => {
                const next = addDays(day, step)
                followingToday.current = next >= today
                setDay(next >= today ? today : next)
              }} aria-label={view === 'day' ? 'Next day' : 'Next week'}>
              <ChevronRightIcon />
            </button>
          </div>
        ) : null}

        {loading && view !== 'summary' ? (
          <div className="card card-pad reports-loading" role="status" aria-busy="true">
            Loading…
          </div>
        ) : null}
        {view === 'day' && !loading ? <DayGlance stats={glance} onOpen={openCat} /> : null}
        {view === 'day' && !loading ? <DayStrip events={events} day={day} dayStartHour={dayStartHour} filters={filters} now={now} /> : null}
        {view === 'day' && !loading ? <DayExtras rows={extras} onOpen={openCategory} /> : null}
        {view === 'day' && !loading ? <DayLog groups={log} onEdit={onEdit} names={names} /> : null}
        {view === 'week' && !loading ? <CalendarView events={events} endDay={day} /> : null}
        {view === 'list' && !loading ? (
          <div className="stack">
            {Array.from({ length: 7 }, (_, i) => addDays(day, -i)).map((d) => (
              <section key={d.toISOString()} className="stack">
                <h3 className="day-heading">{formatDayLabel(d, now)}</h3>
                <Timeline items={timeline.filter((t) => isSameDay(t.at, d))} onEdit={onEdit} names={names} emptyText="Nothing logged" />
              </section>
            ))}
          </div>
        ) : null}
        {view === 'summary' ? <SummaryView loading={loading} events={events} child={child} now={now} span={span} onSpan={setSpan} filters={filters} cat={cat} onCat={setCat} /> : null}
      </main>
      <LogSheet request={request} child={child} recentFeedings={events.feedings} recent={timeline} names={names} onClose={() => setRequest(null)} />
      <ReportSettingsSheet open={settingsOpen} child={child} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
