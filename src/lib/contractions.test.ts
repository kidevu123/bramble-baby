import { describe, expect, it } from 'vitest'
import { analyzeContractions } from './contractions'
import type { Contraction } from './api/companion'

const mk = (i: number, startMin: number, durSec: number): Contraction => {
  const start = new Date(Date.UTC(2026, 8, 1, 10, 0, 0) + startMin * 60_000)
  return { id: i, child: 1, start: start.toISOString(), end: new Date(start.getTime() + durSec * 1000).toISOString(), intensity: null, notes: '' }
}
const now = new Date(Date.UTC(2026, 8, 1, 11, 0, 0))

describe('analyzeContractions', () => {
  it('handles empty input', () => expect(analyzeContractions([], now).count).toBe(0))
  it('computes averages', () => {
    const s = analyzeContractions([mk(1, 0, 40), mk(2, 8, 50), mk(3, 16, 60)], now)
    expect(Math.round(s.avgDurationSec)).toBe(50)
    expect(Math.round(s.avgIntervalSec)).toBe(480)
    expect(s.fiveOneOne).toBe(false)
    expect(s.summary).toBe('Every 8m · lasting 50s')
  })
  it('detects 5-1-1', () => {
    const items = Array.from({ length: 13 }, (_, i) => mk(i, i * 5, 60))
    expect(analyzeContractions(items, new Date(Date.UTC(2026, 8, 1, 11, 0, 0))).fiveOneOne).toBe(true)
  })
})
