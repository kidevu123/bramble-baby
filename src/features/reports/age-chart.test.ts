import { describe, expect, it } from 'vitest'
import { ageTicks, ageWindowEnd, fullWindow, linesAround } from './age-chart'

describe('the growth chart by age', () => {
  it('runs a week past a newborn and a sixth past an older baby, never beyond two years', () => {
    expect(ageWindowEnd(1)).toBeCloseTo(1 + 7 / 30.4375, 6)
    expect(ageWindowEnd(9)).toBeCloseTo(10.5, 6)
    expect(ageWindowEnd(0)).toBe(0.5)
    expect(ageWindowEnd(23)).toBe(24)
  })
  it('fits the height to the lines around the measurements, one more each side', () => {
    // Lines at 10, 20, 30, 40, 50 (flat): a baby under the lowest sees the two lowest.
    const lines = (k: number) => 10 + k * 10
    expect(linesAround([5, 6], lines, 5)).toEqual([0, 1])
    // At 25: between lines 1 and 2, plus 0 and 3.
    expect(linesAround([25], lines, 5)).toEqual([0, 1, 2, 3])
    // Above the top: the two highest.
    expect(linesAround([60], lines, 5)).toEqual([3, 4])
    expect(linesAround([], lines, 3)).toEqual([0, 1, 2])
  })
  it('opens on the whole chart, birth to 3, 6, 12 or 24 months', () => {
    expect(fullWindow(1.5)).toBe(3)
    expect(fullWindow(2.9)).toBe(6)
    expect(fullWindow(11)).toBe(12)
    expect(fullWindow(30)).toBe(24)
    expect(ageTicks(3, true).map((t) => t.label)).toEqual(['Birth', '1 mo', '2 mo', '3 mo'])
  })
  it('counts weeks for the first months and months after, at most five ticks', () => {
    expect(ageTicks(1.63).map((t) => t.label)).toEqual(['Birth', '2 wk', '4 wk', '6 wk'])
    expect(ageTicks(10.5).map((t) => t.label)).toEqual(['Birth', '3 mo', '6 mo', '9 mo'])
    expect(ageTicks(24).length).toBeLessThanOrEqual(5)
  })
})
