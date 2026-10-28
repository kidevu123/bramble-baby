import { describe, expect, it } from 'vitest'
import { agoChoice, lastSessionSeconds, minutesAgo, sessionEndingAt } from './quick-log'

const now = new Date('2026-10-08T09:41:00')

describe('minutesAgo / agoChoice', () => {
  it('sets the time that many minutes before now', () => {
    expect(minutesAgo(30, now)).toEqual(new Date('2026-10-08T09:11:00'))
    expect(minutesAgo(0, now)).toEqual(now)
  })
  it('recognises the chip a time came from, with a little drift', () => {
    expect(agoChoice(now, now)).toBe(0)
    expect(agoChoice(new Date('2026-10-08T09:40:00'), now)).toBe(0)
    expect(agoChoice(minutesAgo(15, now), now)).toBe(15)
    expect(agoChoice(new Date('2026-10-08T08:42:00'), now)).toBe(60)
  })
  it('matches no chip for a hand-set, far-off or future time', () => {
    expect(agoChoice(new Date('2026-10-08T09:20:00'), now)).toBeNull()
    expect(agoChoice(new Date('2026-10-07T09:41:00'), now)).toBeNull()
    expect(agoChoice(new Date('2026-10-08T09:50:00'), now)).toBeNull()
    expect(agoChoice(null, now)).toBeNull()
  })
})

describe('sessionEndingAt', () => {
  it('moves a session to end at the new time and keeps its length', () => {
    const moved = sessionEndingAt(new Date('2026-10-08T09:20:00'), new Date('2026-10-08T09:41:00'), minutesAgo(30, now))
    expect(moved.end).toEqual(new Date('2026-10-08T09:11:00'))
    expect(moved.start).toEqual(new Date('2026-10-08T08:50:00'))
  })
  it('never makes a session end before it starts', () => {
    const moved = sessionEndingAt(new Date('2026-10-08T09:50:00'), new Date('2026-10-08T09:41:00'), now)
    expect(moved.start).toEqual(now)
  })
})

describe('lastSessionSeconds', () => {
  const session = (start: string, minutes: number) => ({ start, end: new Date(new Date(start).getTime() + minutes * 60_000).toISOString() })
  it('takes the newest session by start, rounded to the minute', () => {
    expect(lastSessionSeconds([session('2026-10-07T08:00:00Z', 20), session('2026-10-07T13:00:00Z', 18), session('2026-10-07T10:00:00Z', 25)])).toBe(18 * 60)
  })
  it('skips sessions that cannot be a routine (timer left running, stopped at once)', () => {
    expect(lastSessionSeconds([session('2026-10-07T13:00:00Z', 20), session('2026-10-07T15:00:00Z', 0.5), session('2026-10-07T16:00:00Z', 400)])).toBe(20 * 60)
  })
  it('is null with nothing to copy', () => {
    expect(lastSessionSeconds([])).toBeNull()
    expect(lastSessionSeconds([session('2026-10-07T15:00:00Z', 0)])).toBeNull()
  })
})
