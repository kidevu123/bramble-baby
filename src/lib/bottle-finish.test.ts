import { describe, expect, it } from 'vitest'
import { bottleFinish, bottleNote, drankMl } from './bottle-finish'

describe('finished or not', () => {
  it('records what she drank from what is left in the bottle', () => {
    expect([drankMl(60, 'none'), drankMl(60, 'little'), drankMl(60, 'half'), drankMl(60, 'most')]).toEqual([60, 45, 30, 15])
    expect(drankMl(45, 'half')).toBe(23)
  })
  it('writes the mark in the note and reads it back', () => {
    expect(bottleNote(2, 'none')).toBe('Premade bottle 2 · finished')
    expect(bottleNote(1, 'half')).toBe('Premade bottle 1 · not finished, about half left')
    expect(bottleFinish(bottleNote(2, 'none'))).toBe('finished')
    expect(bottleFinish(bottleNote(1, 'most'))).toBe('not finished')
    expect(bottleFinish('Premade bottle 1 · finished · burped twice')).toBe('finished')
    expect(bottleFinish('Premade bottle 1')).toBeNull()
    expect(bottleFinish('she finished her nap')).toBeNull()
    expect(bottleFinish(null)).toBeNull()
  })
})
