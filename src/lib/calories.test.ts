import { describe, expect, it } from 'vitest'
import { dayCalories, feedKcal, feedStrength, judgeCalories, kcalOf, mlForGoal, weightForDay, withKcalTag } from './calories'
import type { FortifySettings } from './fortify'

const fortify: FortifySettings = { kcalPerOz: 24, with: 'powder', powder: 'standard' }
const bottle = (type: 'breast milk' | 'formula' | 'fortified breast milk', amount: number, tags: string[] = []) => ({ type, method: 'bottle' as const, amount, tags })

describe('calories', () => {
  it('reads and writes the strength tag beside the others', () => {
    expect(withKcalTag(['caregiver:sam', 'kcal:22'], 24)).toEqual(['caregiver:sam', 'kcal:24'])
    expect(withKcalTag(['caregiver:sam', 'kcal:22'], null)).toEqual(['caregiver:sam'])
    expect(kcalOf(['kcal:24'])).toBe(24)
    expect(kcalOf(['kcal:x'])).toBeNull()
  })

  it('counts plain milk and formula at 20, fortified at its tag, else the household strength', () => {
    expect(feedStrength(bottle('breast milk', 60))).toEqual({ kcalPerOz: 20, unknown: false })
    expect(feedStrength(bottle('fortified breast milk', 60, ['kcal:26']), fortify)?.kcalPerOz).toBe(26)
    expect(feedStrength(bottle('fortified breast milk', 60), fortify)?.kcalPerOz).toBe(24)
    expect(feedStrength(bottle('fortified breast milk', 60))).toEqual({ kcalPerOz: 20, unknown: true })
    expect(feedStrength({ type: 'breast milk', method: 'left breast', tags: [] })).toBeNull()
    expect(feedKcal(bottle('fortified breast milk', 3, ['kcal:24']), 'oz')).toBeCloseTo(72, 5)
    expect(feedKcal(bottle('breast milk', 90), 'ml')).toBeCloseTo(60.9, 1)
  })

  it('adds up a day, and says when nursing leaves calories out', () => {
    const d = dayCalories([bottle('fortified breast milk', 3, ['kcal:24']), bottle('formula', 2), { type: 'breast milk', method: 'both breasts', amount: null, tags: [] }], 'oz', fortify)
    expect(d.kcal).toBeCloseTo(112, 5)
    expect(d.bottles).toBe(2)
    expect(d.nursing).toBe(true)
  })

  it('judges only against the doctor goal, and never with nursing', () => {
    expect(judgeCalories(110, 120, false)).toBe('under')
    expect(judgeCalories(116, 120, false)).toBe('met')
    expect(judgeCalories(110, 120, true)).toBeNull()
    expect(judgeCalories(110, null, false)).toBeNull()
  })

  it('takes the weighing that applied that day', () => {
    const w = [{ kg: 2.5, at: new Date(2026, 9, 1) }, { kg: 2.7, at: new Date(2026, 9, 10) }]
    expect(weightForDay(w, new Date(2026, 9, 5))).toBe(2.5)
    expect(weightForDay(w, new Date(2026, 8, 20))).toBe(2.5)
    expect(weightForDay(w, new Date(2026, 9, 12))).toBe(2.7)
    // 120 kcal/kg for 2.7 kg at 24 kcal/oz: about 399 mL a day.
    expect(mlForGoal(120, 2.7, 24)).toBeCloseTo(399, 0)
  })
})
