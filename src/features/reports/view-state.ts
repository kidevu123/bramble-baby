import { addDays, format, startOfDay } from 'date-fns'
import { dayWindow } from '../../lib/events'
import type { Cat } from './categories'

export type View = 'day' | 'week' | 'list' | 'summary'
export type Span = 7 | 14 | 30 | 90 | 365

/** What Reports was showing: kept per child for this browser session so Back from a page opened on it lands there. */
export interface ReportsView {
  view: View
  cat: Cat
  span: Span
  /** The paged day, or null for "today" (which moves with the clock: today stays today tomorrow). */
  day: string | null
}

const VIEWS: View[] = ['day', 'week', 'list', 'summary']
const CATS: Cat[] = ['overview', 'sleep', 'feed', 'solids', 'diaper', 'pump', 'activity', 'medicine', 'growth', 'temperature', 'milestones']
const SPANS: Span[] = [7, 14, 30, 90, 365]
export const DEFAULT_VIEW: ReportsView = { view: 'day', cat: 'overview', span: 7, day: null }

const key = (child: number) => `bramble.reports.${child}`

/** The saved view, checked field by field; anything missing or garbled falls back to the default. */
export function readView(child: number, store: Pick<Storage, 'getItem'> | null = safeSession()): ReportsView {
  try {
    const raw = store?.getItem(key(child))
    if (!raw) return DEFAULT_VIEW
    const v = JSON.parse(raw) as Partial<ReportsView>
    return {
      view: VIEWS.includes(v.view as View) ? (v.view as View) : DEFAULT_VIEW.view,
      cat: CATS.includes(v.cat as Cat) ? (v.cat as Cat) : DEFAULT_VIEW.cat,
      span: SPANS.includes(v.span as Span) ? (v.span as Span) : DEFAULT_VIEW.span,
      day: typeof v.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.day) ? v.day : null,
    }
  } catch {
    return DEFAULT_VIEW
  }
}

export function writeView(child: number, v: ReportsView, store: Pick<Storage, 'setItem'> | null = safeSession()): void {
  try {
    store?.setItem(key(child), JSON.stringify(v))
  } catch {
    /* private mode or blocked storage: Reports simply opens on the default next time */
  }
}

/** The saved day as a date: today when none was paged to, never later than today. */
/**
 * The report day `now` falls in. With days starting at, say, 7 AM, 1 AM tonight still belongs to yesterday's
 * report day: opening Reports then shows that day, not one that has not begun (sweep 2026-10-21).
 */
export function reportToday(now: Date, startHour = 0): Date {
  const today = startOfDay(now)
  return now < dayWindow(today, startHour).start ? addDays(today, -1) : today
}

export function dayOf(v: ReportsView, now: Date, startHour = 0): Date {
  const today = reportToday(now, startHour)
  if (!v.day) return today
  const [y, m, d] = v.day.split('-').map(Number)
  const day = new Date(y, m - 1, d)
  return Number.isNaN(day.getTime()) || day > today ? today : day
}

/** The day to save: null for today, so reopening tomorrow shows tomorrow's today. */
export function dayKey(day: Date, now: Date, startHour = 0): string | null {
  return day.getTime() >= reportToday(now, startHour).getTime() ? null : format(day, 'yyyy-MM-dd')
}

/**
 * How many days of events Reports asks for: the widest range Summary can show (or a week) plus the days
 * paged back, rounded up to a fortnight so a few taps on Previous day reuse one fetch.
 */
export function fetchDays(span: Span, daysPagedBack: number): number {
  return Math.max(span, 7) + Math.ceil(Math.max(0, daysPagedBack) / 14) * 14 + 2
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}
