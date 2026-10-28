import { describe, expect, it } from 'vitest'
import { convertVolume, formatVolume, formatWeight, joinPounds, roundTo, splitPounds } from './units'

describe('units', () => {
  it('formats volume in the chosen unit', () => {
    expect(formatVolume(4.25, 'oz')).toBe('4.25 oz')
    expect(formatVolume(120.4, 'ml')).toBe('120 mL')
  })
  it('converts ml to oz', () => expect(roundTo(convertVolume(118.294, 'ml', 'oz'), 2)).toBe(4))
  it('formats pounds and ounces', () => {
    expect(formatWeight(7.5, 'lb')).toBe('7 lb 8 oz')
    expect(formatWeight(8, 'lb')).toBe('8 lb')
  })
})

describe('pounds and ounces', () => {
  it('joins what the hospital writes into decimal pounds', () => {
    expect(joinPounds('5', '15')).toBe(5.9375)
    expect(joinPounds('5', '15.5')).toBeCloseTo(5.96875, 6)
    expect(joinPounds('6', '')).toBe(6)
    expect(joinPounds('', '12')).toBe(0.75)
  })
  it('refuses nothing typed, 16 ounces or more, and negatives', () => {
    expect(joinPounds('', '')).toBeNull()
    expect(joinPounds('5', '16')).toBeNull()
    expect(joinPounds('5', '-1')).toBeNull()
  })
  it('splits a stored weight back to the quarter ounce, as the Hatch reports it', () => {
    expect(splitPounds(5.9375)).toEqual({ lb: '5', oz: '15' })
    expect(splitPounds(5.94)).toEqual({ lb: '5', oz: '15' }) // read back at 0.01 lb
    expect(splitPounds(5.36)).toEqual({ lb: '5', oz: '5.75' }) // 2431 g from the Hatch
    expect(splitPounds(5.995)).toEqual({ lb: '6', oz: '0' })
  })
})
