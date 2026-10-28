import { describe, expect, it } from 'vitest'
import { decodeSolidsNotes, encodeSolidsNotes, foodsTried } from './foods'

describe('solids notes encoding', () => {
  it('round-trips foods with reaction and amount', () => {
    const s = encodeSolidsNotes(['avocado', 'banana'], 'loved', 'most', 'messy!')
    expect(s).toBe('avocado, banana | loved | most | messy!')
    expect(decodeSolidsNotes(s)).toEqual({ foods: ['avocado', 'banana'], reaction: 'loved', amount: 'most', note: 'messy!' })
  })
  it('keeps plain food lists readable', () => {
    expect(encodeSolidsNotes(['pear'], null, null, '')).toBe('pear')
    expect(decodeSolidsNotes('pear').foods).toEqual(['pear'])
  })
  it('lists foods tried, newest first and unique', () => {
    expect(foodsTried(['pear | ok', 'avocado, pear', null])).toEqual(['pear', 'avocado'])
  })
})
