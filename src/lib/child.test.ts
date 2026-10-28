import { describe, expect, it } from 'vitest'
import { describeDueDate, describeGestation, isExpecting } from './child'
import type { Child } from './api/types'

const child = (birth: string): Child => ({ id: 1, first_name: 'Baby', last_name: '', birth_date: birth, birth_time: null, slug: 'baby', picture: null })
const now = new Date('2026-09-01T12:00:00')

describe('expecting mode', () => {
  it('detects future due dates', () => {
    expect(isExpecting(child('2026-09-27'), now)).toBe(true)
    expect(isExpecting(child('2026-05-01'), now)).toBe(false)
    expect(isExpecting(child('2026-09-02'), now)).toBe(true) // due tomorrow
    expect(isExpecting(child('2026-09-01'), now)).toBe(false) // due today: born
    expect(isExpecting(child('2026-09-02'), new Date('2026-09-01T23:59:59'))).toBe(true)
  })
  // Only meaningful where the clocks change (run with TZ=America/New_York): the spring-forward day is 23 h.
  const dstZone = new Date(2027, 2, 14, 12).getTimezoneOffset() !== new Date(2027, 2, 13, 12).getTimezoneOffset()
  it.runIf(dstZone)('agrees with the age on a 23-hour day', () => {
    expect(isExpecting(child('2027-03-15'), new Date(2027, 2, 14, 10, 0))).toBe(true)
    expect(isExpecting(child('2027-03-14'), new Date(2027, 2, 14, 10, 0))).toBe(false)
  })
  it('describes the due date', () => {
    expect(describeDueDate(child('2026-09-27'), now)).toBe('Due in 3 weeks and 5 days')
    expect(describeDueDate(child('2026-09-02'), now)).toBe('Due tomorrow')
  })
  it('computes gestation from a 40 week term', () => {
    expect(describeGestation(child('2026-09-27'), now)).toBe('36 weeks, 2 days')
  })
})
