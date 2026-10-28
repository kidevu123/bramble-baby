import { describe, expect, it } from 'vitest'
import { formatAge, formatAgo, formatClock, formatDurationShort, formatWhen, parseDuration } from './time'

describe('parseDuration', () => {
  it('parses HH:MM:SS', () => expect(parseDuration('01:20:05')).toBe(4805))
  it('parses day-prefixed durations', () => expect(parseDuration('1 02:00:00')).toBe(93600))
  it('parses "N days, HH:MM:SS"', () => expect(parseDuration('2 days, 00:00:10')).toBe(172810))
  it('returns 0 for empty', () => expect(parseDuration(null)).toBe(0))
})

describe('formatDurationShort', () => {
  it('formats minutes only', () => expect(formatDurationShort(45 * 60)).toBe('45m'))
  it('formats hours and minutes', () => expect(formatDurationShort(80 * 60)).toBe('1h 20m'))
  it('drops zero minutes', () => expect(formatDurationShort(7200)).toBe('2h'))
})

describe('formatClock', () => {
  it('pads all fields', () => expect(formatClock(396)).toBe('00:06:36'))
})

describe('formatAgo', () => {
  const now = new Date('2026-09-01T12:00:00')
  it('says just now under a minute', () => expect(formatAgo(new Date('2026-09-01T11:59:40'), now)).toBe('just now'))
  it('formats minutes', () => expect(formatAgo(new Date('2026-09-01T11:15:00'), now)).toBe('45m ago'))
  it('formats hours and minutes', () => expect(formatAgo(new Date('2026-09-01T09:50:00'), now)).toBe('2h 10m ago'))
  it('says yesterday', () => expect(formatAgo(new Date('2026-08-31T08:00:00'), now)).toBe('yesterday'))
})

describe('formatWhen', () => {
  it('uses Today prefix', () => {
    const d = new Date()
    d.setHours(9, 41, 0, 0)
    expect(formatWhen(d)).toBe('Today, 9:41 AM')
  })
})

describe('formatAge', () => {
  const now = new Date('2026-09-01T12:00:00')
  it('uses days for newborns', () => expect(formatAge('2026-08-25', now)).toBe('7 d'))
  it('uses weeks under 3 months', () => expect(formatAge('2026-07-14', now)).toBe('7 wk'))
  it('uses months with weeks', () => expect(formatAge('2026-04-01', now)).toMatch(/^5 mo/))
  it('counts the weeks from the last whole calendar month, never 4 of them', () => {
    expect(formatAge('2026-03-31', new Date('2026-07-30T12:00:00'))).toBe('3 mo 3 wk') // a day short of 4 mo
    expect(formatAge('2026-03-31', new Date('2026-07-31T12:00:00'))).toBe('4 mo')
    expect(formatAge('2026-04-01', new Date('2026-07-15T12:00:00'))).toBe('3 mo 2 wk')
  })
  it('uses years past 24 months', () => expect(formatAge('2024-06-01', now)).toBe('2 yr 3 mo'))
})
