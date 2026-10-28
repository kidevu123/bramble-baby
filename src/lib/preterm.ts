/**
 * A baby born early (Settings › Born early): how many weeks of pregnancy he was born at, and the NICU stay.
 * Two facts, not a mode: everything below is worked out from them, so entries logged before they were set read
 * right the moment they are, and the stay ends by itself on the day they came home.
 *
 * - Corrected age: every age-typical figure (feeds, sleep, diapers, wake windows, WHO percentiles, weight gain)
 *   counts from the due date instead of the birth, until two years from the birth (when most preterm babies
 *   have caught up and correction stops).
 * - Held: while he is in the NICU, or before his due date, nothing judges his feeds, sleep or diapers by age.
 *   The nurses feed and change him, and no age-typical table covers a baby before term.
 * - What stays on the real birth: the age shown, the day of life, and Mom's pumping (her days since delivery).
 */
import { addDays, differenceInCalendarDays, differenceInMonths, format, startOfDay } from 'date-fns'
import type { Child } from './api/types'
import { ageContext, type AgeContext } from './science'
import { formatAge, parseDate } from './time'

/** Full term: 40 weeks. */
export const TERM_DAYS = 280
/** Corrected age is for a baby born before 37 weeks; the sheet offers 22 to 36. */
export const EARLIEST_DAYS = 22 * 7
export const PRETERM_BEFORE_DAYS = 37 * 7
/** Correction stops two years from the birth. */
export const CORRECT_UNTIL_MONTHS = 24

export interface NicuStay {
  /** The day the stay began (yyyy-MM-dd). */
  since: string
  /** The day they came home (yyyy-MM-dd), or null while he is still there. */
  home: string | null
}

export interface PretermSettings {
  /** Weeks + days of pregnancy at birth, in days (25 wk 3 d = 178); null or missing for a baby born at term. */
  bornAtDays?: number | null
  nicu?: NicuStay | null
}

export interface AgeBasis {
  /** The real birth date (Baby Buddy's). */
  birth: string
  /** Set only for a baby born before 37 weeks. */
  bornAtDays: number | null
  /** The due date worked out from the birth and `bornAtDays`, when born early. */
  due: string | null
  nicu: NicuStay | null
}

/** What a function that judges by age counts from: a bare birth date (born at term) or a child's basis. */
export type AgeFrom = string | AgeBasis

export type AgeHold = 'nicu' | 'before-term' | null

const day = (s: string) => startOfDay(parseDate(s))
const ymd = (d: Date) => format(d, 'yyyy-MM-dd')

export function validBornAt(days: unknown): days is number {
  return typeof days === 'number' && Number.isInteger(days) && days >= EARLIEST_DAYS && days < PRETERM_BEFORE_DAYS
}

export function ageBasis(child: Pick<Child, 'birth_date'>, settings?: PretermSettings | null): AgeBasis {
  const bornAtDays = validBornAt(settings?.bornAtDays) ? settings!.bornAtDays! : null
  const nicu = settings?.nicu && typeof settings.nicu.since === 'string' && settings.nicu.since ? { since: settings.nicu.since, home: settings.nicu.home || null } : null
  const due = bornAtDays !== null ? ymd(addDays(day(child.birth_date), TERM_DAYS - bornAtDays)) : null
  return { birth: child.birth_date, bornAtDays, due, nicu }
}

export function asBasis(from: AgeFrom): AgeBasis {
  return typeof from === 'string' ? { birth: from, bornAtDays: null, due: null, nicu: null } : from
}

/** In the NICU on that day: from the day the stay began to the day before they came home. */
export function inNicuOn(basis: AgeBasis, at: Date): boolean {
  if (!basis.nicu) return false
  const d = startOfDay(at)
  if (d < day(basis.nicu.since)) return false
  return !basis.nicu.home || d < day(basis.nicu.home)
}

/** Why nothing is judged by age on that day, or null when it is. */
export function ageHold(from: AgeFrom, at: Date): AgeHold {
  const b = asBasis(from)
  if (startOfDay(at) < day(b.birth)) return null // expecting: its own mode
  if (inNicuOn(b, at)) return 'nicu'
  if (b.due && startOfDay(at) < day(b.due)) return 'before-term'
  return null
}

/** The date age-typical figures count from on that day: the due date while corrected, else the birth. */
export function normsFrom(from: AgeFrom, at: Date): string {
  const b = asBasis(from)
  if (!b.due) return b.birth
  return differenceInMonths(startOfDay(at), day(b.birth)) < CORRECT_UNTIL_MONTHS ? b.due : b.birth
}

/** The date a WHO percentile counts from for a measurement on that day, or null before term (the WHO
 *  standards start at a term birth; a baby before his due date is not on them). */
export function whoFrom(from: AgeFrom, at: Date): string | null {
  const b = asBasis(from)
  if (b.due && startOfDay(at) < day(b.due)) return null
  return normsFrom(b, at)
}

/** The age the age-typical tables use on that day, and whether they apply at all (`hold`). */
export function judgedAge(from: AgeFrom, at: Date): AgeContext & { hold: AgeHold } {
  const b = asBasis(from)
  const hold = ageHold(b, at)
  // Before the due date (in the NICU or home) the age counted from it would be negative and read as expecting.
  if (hold && b.due && startOfDay(at) < day(b.due)) return { ageMonths: 0, dayOfLife: 0, expecting: false, gestationWeeks: null, hold }
  return { ...ageContext(normsFrom(b, at), at), hold }
}

/** Months for the age-typical tables (wake windows, sleep plans, milestones): corrected, 0 before term. */
export function judgedMonths(from: AgeFrom, at: Date = new Date()): number {
  const ctx = judgedAge(from, at)
  return ctx.expecting ? 0 : Math.max(0, ctx.ageMonths)
}

/** "25 wk 3 d" */
export function describeWeeks(days: number): string {
  const w = Math.floor(days / 7)
  const d = days % 7
  return d ? `${w} wk ${d} d` : `${w} wk`
}

/** Weeks of pregnancy plus days since birth ("31 wk 2 d"), what the NICU calls his age before term. */
export function postmenstrualDays(basis: AgeBasis, at: Date): number | null {
  if (basis.bornAtDays === null) return null
  return basis.bornAtDays + Math.max(0, differenceInCalendarDays(startOfDay(at), day(basis.birth)))
}

/** The age to show beside the real one: "31 wk 2 d corrected" (weeks of pregnancy) before the due date, "1 mo 2 wk corrected" after it
 *  (until correction stops), null for a baby born at term. */
export function correctedAgeText(basis: AgeBasis, at: Date = new Date()): string | null {
  if (!basis.due) return null
  if (startOfDay(at) < day(basis.due)) return `${describeWeeks(postmenstrualDays(basis, at)!)} corrected`
  if (normsFrom(basis, at) !== basis.due) return null
  return `${formatAge(basis.due, at)} corrected`
}

/** One line for the Home band and the Child page while held: "In the NICU · 31 wk 2 d · due Jan 12". */
export function holdLine(basis: AgeBasis, at: Date = new Date()): string | null {
  const hold = ageHold(basis, at)
  if (!hold) return null
  const parts = [hold === 'nicu' ? 'In the NICU' : 'Home before the due date']
  const pma = postmenstrualDays(basis, at)
  if (pma !== null && basis.due && startOfDay(at) < day(basis.due)) parts.push(`${describeWeeks(pma)} corrected`, `due ${format(day(basis.due), 'MMM d')}`)
  else if (basis.nicu) parts.push(`day ${differenceInCalendarDays(startOfDay(at), day(basis.nicu.since)) + 1}`)
  return parts.join(' · ')
}

/** Before the due date of a baby born early. */
export function beforeDue(basis: AgeBasis, at: Date = new Date()): boolean {
  return basis.due !== null && startOfDay(at) < day(basis.due)
}

/** Why a figure has no age-typical comparison, for the places that would show one. */
export function holdNote(hold: AgeHold): string {
  return hold === 'nicu' ? 'Not compared with age norms while in the NICU.' : hold === 'before-term' ? 'Not compared with age norms before the due date.' : ''
}

/** The Settings row's state line. */
export function pretermState(basis: AgeBasis, at: Date = new Date()): string {
  const parts: string[] = []
  if (basis.bornAtDays !== null) parts.push(`Born at ${describeWeeks(basis.bornAtDays)}`)
  if (basis.nicu) parts.push(inNicuOn(basis, at) ? `in the NICU since ${format(day(basis.nicu.since), 'MMM d')}` : basis.nicu.home ? `home since ${format(day(basis.nicu.home), 'MMM d')}` : `NICU from ${format(day(basis.nicu.since), 'MMM d')}`)
  if (!parts.length) return 'Off'
  const s = parts.join(' · ')
  return s[0].toUpperCase() + s.slice(1)
}

/** Mom's days since delivery (day 1 is the birth day), which the pumping targets count from. */
export function daysSinceDelivery(birth: string, at: Date): number {
  return differenceInCalendarDays(startOfDay(at), day(birth)) + 1
}
