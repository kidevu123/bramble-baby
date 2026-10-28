import { differenceInDays, startOfDay } from 'date-fns'
import { parseDate } from '../time'

export * from './sources'
export * from './sleep'
export * from './feeding'
export * from './diapers'
export * from './growth'
export * from './health'
export * from './pregnancy'

export interface AgeContext {
  ageMonths: number
  dayOfLife: number
  expecting: boolean
  gestationWeeks: number | null
}

export function ageContext(birthDate: string, now: Date = new Date()): AgeContext {
  const days = differenceInDays(startOfDay(now), startOfDay(parseDate(birthDate)))
  if (days < 0) {
    const gestationDays = Math.max(0, 280 + days)
    return { ageMonths: -1, dayOfLife: -1, expecting: true, gestationWeeks: gestationDays / 7 }
  }
  return { ageMonths: days / 30.4375, dayOfLife: days, expecting: false, gestationWeeks: null }
}
