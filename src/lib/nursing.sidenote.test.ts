import { describe, expect, it } from 'vitest'
import { parseSideNote } from './nursing'

describe('parseSideNote', () => {
  it('reads both sides and keeps the free-text notes', () => {
    expect(parseSideNote('Left 5m · Right 7m\nfussy')).toEqual({ left: 5, right: 7, rest: 'fussy', found: true })
  })
  it('reads a single side', () => {
    expect(parseSideNote('Right 12m')).toEqual({ left: 0, right: 12, rest: '', found: true })
    expect(parseSideNote('Left 4m')).toMatchObject({ left: 4, right: 0, found: true })
  })
  it('reads hour-long sides written by the timer', () => {
    expect(parseSideNote('Left 1h 5m · Right 7m')).toMatchObject({ left: 65, right: 7, found: true })
    expect(parseSideNote('Left 1h')).toMatchObject({ left: 60, right: 0, found: true })
  })
  it('leaves ordinary notes alone', () => {
    expect(parseSideNote('Left side was sore')).toEqual({ left: 0, right: 0, rest: 'Left side was sore', found: false })
    expect(parseSideNote('')).toEqual({ left: 0, right: 0, rest: '', found: false })
    expect(parseSideNote(null)).toMatchObject({ found: false })
  })
})

describe('parseSideNote seconds', () => {
  it('rounds a seconds-only side up to one minute', () => {
    expect(parseSideNote('Left 40s · Right 12m')).toMatchObject({ left: 1, right: 12, found: true })
  })
})
