import { describe, expect, it } from 'vitest'
import { ageContext, compareDiapers, describePercentile, compareFeeds, compareSleep, diaperNormFor, expectedWeightGain, feedingByWeight, feedingNormFor, feverStatus, judgeByWeight, gestationInfo, percentile, sleepNormFor, valueAtPercentile, zScore, SOURCES, SOURCE_BY_ID, SLEEP_NORMS, FEEDING_NORMS, DIAPER_NORMS, SOLIDS_GUIDANCE, SAFE_SLEEP, LABOR_SIGNS, TUMMY_TIME } from './index'

describe('sources', () => {
  it('every referenced source id exists', () => {
    const ids = new Set(SOURCES.map((s) => s.id))
    const refs = [...SLEEP_NORMS, ...FEEDING_NORMS, ...DIAPER_NORMS, ...SOLIDS_GUIDANCE, ...SAFE_SLEEP, ...LABOR_SIGNS, ...TUMMY_TIME].flatMap((x) => x.sources)
    for (const r of refs) expect(ids.has(r), r).toBe(true)
    expect(SOURCE_BY_ID.get('aasm-2016')?.url).toContain('aasm')
  })
})

describe('sleep norms', () => {
  it('follows AASM totals', () => {
    expect(sleepNormFor(0.5).totalHours).toEqual([14, 17])
    expect(sleepNormFor(8).totalHours).toEqual([12, 16])
    expect(sleepNormFor(15).totalHours).toEqual([11, 14])
    expect(sleepNormFor(48).totalHours).toEqual([10, 13])
  })
  it('classifies totals', () => {
    expect(compareSleep(9 * 3600, 8).status).toBe('low')
    expect(compareSleep(14 * 3600, 8).status).toBe('typical')
    expect(compareSleep(18 * 3600, 8).status).toBe('high')
  })
})

describe('feeding norms', () => {
  it('uses day-of-life norms for newborns', () => {
    expect(feedingNormFor(0, 1).ozPerFeed?.[1]).toBeLessThan(1)
    expect(feedingNormFor(0.2, 7).ozPerFeed).toEqual([1, 3])
    // Day 15 is 0.49 months: between the day rows and the half-month row, still a newborn (never the toddler row).
    for (let d = 0; d <= 31; d++) {
      const ctx = ageContext('2026-09-01', new Date(2026, 8, 1 + d, 12))
      expect(feedingNormFor(ctx.ageMonths, ctx.dayOfLife).feedsPerDay[0]).toBeGreaterThanOrEqual(7)
    }
    expect(feedingNormFor(0.3).feedsPerDay).toEqual([8, 12])
    expect(feedingNormFor(5).ozPerDay).toEqual([24, 32])
  })
  it('prorates feed counts by time of day', () => {
    expect(compareFeeds(2, null, 1, 40, 6).status).toBe('typical')
    expect(compareFeeds(2, null, 1, 40, 20).status).toBe('low')
    expect(compareFeeds(14, null, 5, 150, 24).status).toBe('high')
  })
})

describe('diaper norms', () => {
  it('ramps with day of life', () => {
    expect(diaperNormFor(1).wetPerDay[0]).toBe(1)
    expect(diaperNormFor(5).wetPerDay[0]).toBe(6)
    expect(diaperNormFor(60).dirtyPerDay[0]).toBe(0)
  })
  it('only flags low late in the day', () => {
    expect(compareDiapers(1, 0, 10, 8).status).toBe('typical')
    expect(compareDiapers(1, 0, 10, 20).status).toBe('low')
    expect(compareDiapers(6, 2, 10, 20).status).toBe('typical')
  })
})

describe('WHO growth', () => {
  it('matches WHO medians (z = 0 at M)', () => {
    expect(zScore('weight', 'male', 0, 3.3464)).toBeCloseTo(0, 3)
    expect(percentile('weight', 'male', 0, 3.3464)).toBeCloseTo(50, 0)
    expect(percentile('length', 'female', 12, 74.0)).toBeGreaterThan(45)
    expect(percentile('length', 'female', 12, 74.0)).toBeLessThan(55)
    expect(percentile('head', 'male', 6, 43.3)).toBeGreaterThan(45)
    expect(percentile('head', 'male', 6, 43.3)).toBeLessThan(55)
  })
  it('is monotonic and inverse-consistent', () => {
    expect(percentile('weight', 'female', 3, 5.0)).toBeLessThan(percentile('weight', 'female', 3, 6.5))
    const v = valueAtPercentile('weight', 'male', 6, 85)
    expect(percentile('weight', 'male', 6, v)).toBeCloseTo(85, 0)
  })
  it('interpolates between months and refuses ages beyond the table', () => {
    const a = zScore('weight', 'male', 2, 5.5)
    const b = zScore('weight', 'male', 3, 5.5)
    const mid = zScore('weight', 'male', 2.5, 5.5)
    expect(mid).toBeLessThan(a)
    expect(mid).toBeGreaterThan(b)
    // 30 months used to be silently scored against the 24-month row (a 3-year-old at 14 kg read "89th").
    expect(Number.isNaN(zScore('weight', 'male', 30, 12))).toBe(true)
    expect(Number.isFinite(zScore('weight', 'male', 24, 12))).toBe(true)
  })
  it('describes weight gain by age', () => {
    expect(expectedWeightGain(1).gramsPerWeek).toEqual([150, 200])
    expect(expectedWeightGain(8).gramsPerWeek).toEqual([70, 90])
  })
})

describe('health', () => {
  it('flags fever by age', () => {
    expect(feverStatus(38.2, 1).level).toBe('urgent')
    expect(feverStatus(38.2, 8).level).toBe('fever')
    expect(feverStatus(37.6, 8).level).toBe('low-grade')
    expect(feverStatus(36.8, 8).level).toBe('normal')
    expect(feverStatus(40.1, 20).level).toBe('urgent')
  })
})

describe('pregnancy + age context', () => {
  it('assigns trimesters and kick-count guidance', () => {
    expect(gestationInfo(12).trimester).toBe(1)
    expect(gestationInfo(20).trimester).toBe(2)
    expect(gestationInfo(36).trimester).toBe(3)
    expect(gestationInfo(30).highlights.join(' ')).toMatch(/kick/i)
    expect(gestationInfo(38).highlights.join(' ')).toMatch(/5-1-1/)
  })
  it('computes age context for born and expecting', () => {
    const now = new Date('2026-09-01T12:00:00')
    expect(ageContext('2026-08-31', now).dayOfLife).toBe(1)
    const exp = ageContext('2026-09-27', now)
    expect(exp.expecting).toBe(true)
    expect(Math.floor(exp.gestationWeeks!)).toBe(36)
  })
})

describe('percentile words', () => {
  it('uses the right ordinal at every end of the curve', () => {
    expect(describePercentile(1.2)).toMatch(/^1st percentile · below/)
    expect(describePercentile(2.1)).toMatch(/^2nd percentile · below/)
    expect(describePercentile(0.2)).toMatch(/^below the 1st percentile · below/)
    expect(describePercentile(99.8)).toMatch(/^above the 99th percentile/)
    expect(describePercentile(98.2)).toMatch(/^98th percentile · above/)
    expect(describePercentile(11)).toBe('11th percentile (WHO)')
    expect(describePercentile(63)).toBe('63rd percentile (WHO)')
  })
})

describe('feeding by weight', () => {
  it('is 150–180 mL/kg a day with the AAP 2.5 oz per pound inside it', () => {
    const r = feedingByWeight(2.69, 1, 30)
    if (!r.applies) throw new Error('should apply')
    expect(Math.round(r.mlPerDay[0])).toBe(404)
    expect(Math.round(r.mlPerDay[1])).toBe(484)
    expect(Math.round(r.aapMl)).toBe(438)
    expect(r.capped).toBe(false)
  })
  it('caps at 32 oz and does not apply to newborns or once solids start', () => {
    const big = feedingByWeight(7, 5, 150)
    expect(big.applies && big.mlPerDay[1]).toBe(960)
    expect(big.applies && big.capped).toBe(true)
    expect(feedingByWeight(3, 0.3, 9)).toMatchObject({ applies: false, reason: 'newborn' })
    expect(feedingByWeight(8, 6.5, 200)).toMatchObject({ applies: false, reason: 'solids' })
    for (const id of feedingByWeight(3, 1, 30).sources) expect(SOURCE_BY_ID.has(id)).toBe(true)
  })
  it('allows a tenth either side of the band', () => {
    expect(judgeByWeight(370, [404, 484])).toBe('typical')
    expect(judgeByWeight(360, [404, 484])).toBe('low')
    expect(judgeByWeight(540, [404, 484])).toBe('high')
  })
})
