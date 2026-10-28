import { differenceInDays, startOfDay } from 'date-fns'
import type { Child } from './api/types'
import { parseDate } from './time'

/** A child whose birth date is in the future is "expecting" mode (due date + contractions). */
export function isExpecting(child: Child, now: Date = new Date()): boolean {
  // Calendar days, not 86 400 000 ms: the spring-forward day is 23 hours long.
  return startOfDay(parseDate(child.birth_date)).getTime() > startOfDay(now).getTime()
}

/** "Due in 3 weeks and 5 days" / "Due tomorrow" / "Due today" */
export function describeDueDate(child: Child, now: Date = new Date()): string {
  const days = differenceInDays(startOfDay(parseDate(child.birth_date)), startOfDay(now))
  if (days <= 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  const weeks = Math.floor(days / 7)
  const rem = days % 7
  if (weeks === 0) return `Due in ${days} days`
  return `Due in ${weeks} week${weeks === 1 ? '' : 's'}${rem ? ` and ${rem} day${rem === 1 ? '' : 's'}` : ''}`
}

/** Gestation from a 40-week term: "36 weeks, 2 days". */
export function describeGestation(child: Child, now: Date = new Date()): string {
  const daysToDue = differenceInDays(startOfDay(parseDate(child.birth_date)), startOfDay(now))
  const gestDays = Math.max(0, 280 - daysToDue)
  const weeks = Math.floor(gestDays / 7)
  const days = gestDays % 7
  return `${weeks} weeks, ${days} day${days === 1 ? '' : 's'}`
}
