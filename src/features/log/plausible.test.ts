import { describe, expect, it } from 'vitest'
import { bottleCheck, pumpingCheck, temperatureCheck } from './plausible'

describe('plausibility lines', () => {
  it('flags a bottle or a pumping session far beyond one feed, in the phone unit', () => {
    expect(bottleCheck(240, 'ml')).toBeNull()
    expect(bottleCheck(99999, 'ml')).toMatch(/99999 mL is a lot for one bottle/)
    expect(bottleCheck(8, 'oz')).toBeNull()
    expect(bottleCheck(15, 'oz')).toMatch(/15 oz/)
    expect(pumpingCheck(450, 'ml')).toBeNull()
    expect(pumpingCheck(700, 'ml')).toMatch(/one session/)
  })

  it('flags a temperature no baby has (a slipped decimal)', () => {
    expect(temperatureCheck(98.6, 'f')).toBeNull()
    expect(temperatureCheck(9.86, 'f')).toMatch(/9.86 °F is outside/)
    expect(temperatureCheck(37.2, 'c')).toBeNull()
    expect(temperatureCheck(98.6, 'c')).toMatch(/34.5–41.5 °C/)
    expect(temperatureCheck(0, 'f')).toBeNull() // nothing typed yet
  })
})
