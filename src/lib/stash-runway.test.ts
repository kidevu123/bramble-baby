import { describe, expect, it } from 'vitest'
import type { MilkBag } from './api/companion'
import type { Feeding, Pumping } from './api/types'
import { coverageText, goalLine, runwayHeadline, runwayLine, stashRunway } from './stash-runway'

const now = new Date('2026-10-09T15:00:00')
const iso = (d: string) => new Date(d).toISOString()
const bag = (id: number, ml: number, status: MilkBag['status'] = 'stored', expires = '2026-12-01T00:00:00'): MilkBag =>
  ({ id, child: 1, code: `B${id}`, volume_ml: ml, remaining_ml: ml, location: 'freezer', status, pumped_at: iso('2026-10-01T09:00:00'), expires_at: iso(expires), thawed: false, thawed_at: null, uses: [] }) as unknown as MilkBag
const bottle = (id: number, day: string, ml: number, type: Feeding['type'] = 'breast milk'): Feeding => ({ id, child: 1, start: iso(`${day}T09:00:00`), end: iso(`${day}T09:00:00`), type, method: 'bottle', amount: ml, duration: '00:00:00', notes: '', tags: [] })
const pump = (id: number, day: string, ml: number): Pumping => ({ id, child: 1, start: iso(`${day}T08:00:00`), end: iso(`${day}T08:20:00`), amount: ml, duration: '00:20:00', notes: '', tags: [] })
const week = ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']

describe('stashRunway', () => {
  const bags = [bag(1, 120), bag(2, 120), bag(3, 120, 'used'), bag(4, 100, 'stored', '2026-10-01T00:00:00')]
  const feedings = week.flatMap((d, i) => [bottle(i * 10 + 1, d, 60), bottle(i * 10 + 2, d, 60), bottle(i * 10 + 3, d, 30, 'formula')])
  const pumping = week.map((d, i) => pump(100 + i, d, 180))
  it('divides the usable stash by the breast-milk bottle intake of the last full week', () => {
    const r = stashRunway(bags, feedings, pumping, 'ml', null, now)
    expect(r.usableMl).toBe(240) // used and expired bags do not count
    expect(r.intakeMlPerDay).toBe(120) // formula is not stash milk
    expect(r.intakeDays).toBe(7)
    expect(r.daysCovered).toBe(2)
    expect(r.pumpedMlPerDay).toBe(180)
    expect(r.netMlPerDay).toBe(60)
    expect(r.goalDays).toBeNull()
  })
  it('reads amounts in the phone’s unit', () => {
    const r = stashRunway(bags, [bottle(1, '2026-10-08', 4)], [], 'oz', null, now)
    expect(r.intakeMlPerDay).toBeCloseTo(118.3, 1)
  })
  it('falls back to today when the week has no bottles yet, and copes with nothing at all', () => {
    const r = stashRunway(bags, [bottle(1, '2026-10-09', 80)], [], 'ml', null, now)
    expect(r.intakeMlPerDay).toBe(80)
    expect(r.intakeDays).toBe(1)
    expect(r.daysCovered).toBe(3)
    const none = stashRunway([], [], [], 'ml', 5, now)
    expect(none).toMatchObject({ usableMl: 0, intakeMlPerDay: null, daysCovered: null, goalDays: 5, goalMl: null, goalProgress: null, goalReachedOn: null })
  })
  it('measures the goal at today’s intake and dates it from the net surplus', () => {
    const r = stashRunway(bags, feedings, pumping, 'ml', 10, now)
    expect(r.goalMl).toBe(1200)
    expect(r.goalProgress).toBeCloseTo(0.2, 5)
    expect(r.goalReachedOn).toEqual(new Date('2026-10-25T00:00:00')) // (1200 − 240) / 60 = 16 days
    const shrinking = stashRunway(bags, feedings, week.map((d, i) => pump(100 + i, d, 100)), 'ml', 10, now)
    expect(shrinking.netMlPerDay).toBe(-20)
    expect(shrinking.goalReachedOn).toBeNull()
    expect(stashRunway(bags, feedings, pumping, 'ml', 1, now).goalProgress).toBe(1)
  })
  it('takes the net over the same days for pumped and drunk', () => {
    // 120 mL bottles every day of the week (840 mL), one 300 mL session: shrinking, not "180 a day more"
    const daily = week.map((d, i) => bottle(i + 1, d, 120))
    const r = stashRunway([bag(1, 240)], daily, [pump(1, '2026-10-08', 300)], 'ml', 10, now)
    expect(r.pumpedMlPerDay).toBe(300)
    expect(r.netMlPerDay).toBeCloseTo((300 - 840) / 7, 5)
    expect(r.goalReachedOn).toBeNull()
    expect(goalLine(r, 'ml', 'Ada', now)).toContain('shrinking by 77 mL a day')
  })
})

describe('runway words', () => {
  it('says how long the stash lasts in days or hours', () => {
    expect(coverageText(4.26)).toBe('4.3 days')
    expect(coverageText(2)).toBe('2 days')
    expect(coverageText(1.2)).toBe('1.2 days')
    expect(coverageText(1.9)).toBe('1.9 days') // not floored to "1 day"
    expect(coverageText(1.99)).toBe('2 days')
    expect(coverageText(1.02)).toBe('1 day')
    expect(coverageText(0.99)).toBe('1 day')
    expect(coverageText(0.75)).toBe('18 hours')
    expect(coverageText(0.02)).toBe('about an hour')
  })
  it('writes the headline, the basis line and the goal line', () => {
    const bags = [bag(1, 240)]
    const feedings = week.flatMap((d, i) => [bottle(i * 10 + 1, d, 120)])
    const pumping = week.map((d, i) => pump(100 + i, d, 180))
    const r = stashRunway(bags, feedings, pumping, 'ml', 10, now)
    expect(runwayHeadline(r)).toBe('2 days')
    expect(runwayLine(r, 'ml', 'Ada')).toBe('240 mL in the stash at Ada’s 120 mL a day by bottle (over 7 days).')
    expect(goalLine(r, 'ml', 'Ada', now)).toBe('Goal: 10 days of bottles (1200 mL) · 20% there. Pumping 60 mL a day more than Ada drinks, you get there by Oct 25.')
    expect(goalLine(stashRunway(bags, feedings, [], 'ml', 10, now), 'ml', 'Ada', now)).toBe('Goal: 10 days of bottles (1200 mL) · 20% there. Log pumping and this says when you get there.')
    expect(goalLine(stashRunway(bags, feedings, week.map((d, i) => pump(100 + i, d, 100)), 'ml', 10, now), 'ml', 'Ada', now)).toBe('Goal: 10 days of bottles (1200 mL) · 20% there. The stash is shrinking by 20 mL a day, so it is not growing towards the goal.')
    expect(goalLine(stashRunway(bags, feedings, pumping, 'ml', 2, now), 'ml', 'Ada', now)).toBe('Goal reached: 2 days of bottles (240 mL) are banked.')
    expect(goalLine(r, 'ml', 'Ada', now)).not.toBeNull()
    expect(goalLine(stashRunway(bags, feedings, pumping, 'ml', null, now), 'ml', 'Ada', now)).toBeNull()
    expect(runwayHeadline(stashRunway([], feedings, pumping, 'ml', null, now))).toBe('Nothing to pour')
    expect(runwayHeadline(stashRunway(bags, [], [], 'ml', null, now))).toBe('No bottles logged yet')
    expect(runwayLine(stashRunway(bags, [], [], 'ml', null, now), 'ml', 'Ada')).toBe('240 mL in the stash. Log Ada’s bottles and this says how many days it covers.')
    expect(goalLine(stashRunway(bags, [], [], 'ml', 10, now), 'ml', 'Ada', now)).toBe('Goal: 10 days of bottles banked. Once bottles are logged, this shows how close the stash is.')
  })
})
