import { describe, expect, it } from 'vitest'
import { dayOf, reportToday } from './view-state'

describe('reportToday (sweep 2026-10-21)', () => {
  it('before the day start, the report day is still yesterday', () => {
    const now = new Date(2026, 9, 21, 6, 0)
    expect(reportToday(now, 7)).toEqual(new Date(2026, 9, 20))
    expect(reportToday(now, 0)).toEqual(new Date(2026, 9, 21))
    expect(reportToday(new Date(2026, 9, 21, 7, 0), 7)).toEqual(new Date(2026, 9, 21))
  })
  it('Reports opens on that day', () => {
    expect(dayOf({ view: 'day', cat: 'overview', span: 7, day: null }, new Date(2026, 9, 21, 6, 0), 7)).toEqual(new Date(2026, 9, 20))
  })
})
