import { describe, expect, it } from 'vitest'
import { ageWakeWindow, observedWakeWindows, predictNap, suggestBedtime } from './nap-window'
import type { Sleep } from './api/types'

const sleep = (id: number, start: string, end: string, nap = true): Sleep => ({
  id,
  child: 1,
  start,
  end,
  duration: '00:45:00',
  nap,
  notes: null,
  tags: [],
})

describe('ageWakeWindow', () => {
  it('gives short windows to newborns', () => expect(ageWakeWindow(0.5).maxMinutes).toBe(60))
  it('gives long windows to toddlers', () => expect(ageWakeWindow(15).napsPerDay).toBe(1))
})

describe('observedWakeWindows', () => {
  it('measures daytime gaps between sleeps and ignores night gaps', () => {
    const now = new Date('2026-09-01T12:00:00')
    const sleeps = [
      sleep(1, '2026-08-31T19:00:00', '2026-09-01T06:30:00', false),
      sleep(2, '2026-09-01T08:00:00', '2026-09-01T08:45:00'),
      sleep(3, '2026-09-01T10:15:00', '2026-09-01T11:00:00'),
    ]
    expect(observedWakeWindows(sleeps, now)).toEqual([90, 90])
  })
  it('skips implausible gaps', () => {
    const now = new Date('2026-09-01T12:00:00')
    const sleeps = [sleep(1, '2026-09-01T07:00:00', '2026-09-01T07:30:00'), sleep(2, '2026-09-01T07:35:00', '2026-09-01T08:00:00')]
    expect(observedWakeWindows(sleeps, now)).toEqual([])
  })
})

describe('predictNap', () => {
  const now = new Date('2026-09-01T11:30:00')
  it('reports no data with no sleeps', () => {
    expect(predictNap([], 4, now).state).toBe('no-data')
  })
  it('predicts from the age prior when there is little history', () => {
    const s = predictNap([sleep(1, '2026-09-01T09:00:00', '2026-09-01T10:00:00')], 4, now)
    expect(s.state).toBe('predicted')
    expect(s.source).toBe('age')
    // 4 months → 120-150 window, midpoint 135 → 12:15
    expect(s.at?.getHours()).toBe(12)
    expect(s.at?.getMinutes()).toBe(15)
  })
  it('learns from observed windows', () => {
    const sleeps: Sleep[] = []
    for (let d = 26; d <= 31; d++) {
      sleeps.push(sleep(d * 10, `2026-08-${d}T08:00:00`, `2026-08-${d}T08:45:00`))
      sleeps.push(sleep(d * 10 + 1, `2026-08-${d}T10:45:00`, `2026-08-${d}T11:30:00`))
      sleeps.push(sleep(d * 10 + 2, `2026-08-${d}T13:30:00`, `2026-08-${d}T14:30:00`))
    }
    sleeps.push(sleep(999, '2026-09-01T09:00:00', '2026-09-01T10:00:00'))
    const s = predictNap(sleeps, 4, now)
    expect(s.source).toBe('learned')
    expect(s.samples).toBeGreaterThanOrEqual(12)
    expect(s.wakeWindowMinutes).toBeLessThan(135)
    expect(s.wakeWindowMinutes).toBeGreaterThan(120)
  })
  it('flags overdue when the window has passed', () => {
    const s = predictNap([sleep(1, '2026-09-01T06:00:00', '2026-09-01T07:00:00')], 4, now)
    expect(s.state).toBe('overdue')
  })
  it('stops predicting when no sleep has been logged for half a day', () => {
    const s = predictNap([sleep(1, '2026-08-21T06:00:00', '2026-08-21T07:00:00')], 4, now)
    expect(s.state).toBe('stale')
    expect([s.at, s.windowStart]).toEqual([null, null])
    expect(s.lastWakeAt?.getDate()).toBe(21)
    expect(predictNap([sleep(1, '2026-09-01T00:00:00', '2026-09-01T00:30:00')], 4, now).state).toBe('overdue')
  })
  it('reports asleep for an open sleep', () => {
    const open = { ...sleep(1, '2026-09-01T11:00:00', ''), end: '' }
    expect(predictNap([open], 4, now).state).toBe('asleep')
  })
})

describe('suggestBedtime', () => {
  it('never suggests later than 9pm', () => {
    const now = new Date('2026-09-01T18:00:00')
    const bedtime = suggestBedtime(14, now, new Date('2026-09-01T16:30:00'))
    expect(bedtime.getHours()).toBeLessThanOrEqual(21)
  })
})
