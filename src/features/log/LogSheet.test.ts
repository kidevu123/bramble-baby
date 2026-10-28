import { describe, expect, it } from 'vitest'
import type { TimelineItem } from '../../lib/events'
import { likelyDuplicate } from './LogSheet'

const now = new Date('2026-10-08T15:00:00')
const item = (kind: TimelineItem['kind'], minutesAgo: number, by: string | null): TimelineItem =>
  ({ key: `${kind}-${minutesAgo}`, kind, at: new Date(now.getTime() - minutesAgo * 60_000), end: null, title: kind, detail: '', raw: {}, by }) as unknown as TimelineItem

describe('likelyDuplicate', () => {
  it('warns about a same-kind entry by someone else in the last 30 minutes, never about your own', () => {
    const recent = [item('bottle', 14, 'admin'), item('nursing', 50, 'sara')]
    expect(likelyDuplicate('nursing', recent, now, 'admin')).toBeNull() // the only recent one is mine
    expect(likelyDuplicate('nursing', recent, now, 'Sara')?.by).toBe('admin') // case does not matter
    expect(likelyDuplicate('nursing', recent, now)?.by).toBe('admin') // unknown signed-in user: warn as before
    expect(likelyDuplicate('diaper', recent, now, 'sara')).toBeNull()
  })
})
