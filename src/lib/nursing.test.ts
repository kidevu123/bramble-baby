import { describe, expect, it } from 'vitest'
import { decodeNursing, encodeNursing, freshNursing, nursingMethod, nursingTotals, pauseNursing, toggleSide } from './nursing'

describe('nursing state', () => {
  const t0 = new Date('2026-09-01T10:00:00Z')
  const t1 = new Date('2026-09-01T10:05:00Z')

  it('round-trips through the timer name', () => {
    const s = freshNursing('left', t0)
    expect(decodeNursing(encodeNursing(s))).toEqual(s)
  })
  it('returns null for non-nursing names', () => {
    expect(decodeNursing('sleep')).toBeNull()
    expect(decodeNursing(null)).toBeNull()
  })
  it('accumulates live time on the active side', () => {
    const s = freshNursing('left', t0)
    expect(nursingTotals(s, t1)).toEqual({ left: 300, right: 0, total: 300 })
  })
  it('switches sides and keeps the first total', () => {
    const s = toggleSide(freshNursing('left', t0), 'right', t1)
    expect(s.leftSeconds).toBe(300)
    expect(s.activeSide).toBe('right')
    expect(s.activeSince).toBe(t1.toISOString())
  })
  it('pauses when tapping the running side', () => {
    const s = toggleSide(freshNursing('right', t0), 'right', t1)
    expect(s.activeSide).toBeNull()
    expect(s.rightSeconds).toBe(300)
  })
  it('derives the feeding method', () => {
    expect(nursingMethod(pauseNursing(freshNursing('left', t0), t1))).toBe('left breast')
    expect(nursingMethod(toggleSide(freshNursing('left', t0), 'right', t1))).toBe('both breasts')
  })
})
