import { describe, expect, it } from 'vitest'
import { nursingTotals, type NursingState } from '../../lib/nursing'
import { shiftNursingStart } from './nursing-start'

const now = new Date('2026-10-10T12:00:00Z')

describe('shiftNursingStart', () => {
  it('gives a start moved 20 minutes back to the side that is running, so the note matches the duration', () => {
    const running: NursingState = { kind: 'nursing', leftSeconds: 0, rightSeconds: 0, activeSide: 'right', activeSince: new Date(now.getTime() - 4_000).toISOString() }
    const moved = shiftNursingStart(running, 20 * 60, now)
    expect(Math.round(nursingTotals(moved, now).right)).toBe(20 * 60 + 4)
    expect(nursingTotals(moved, now).left).toBe(0)
  })

  it('on a paused timer gives the gap to the side that has the time', () => {
    const paused: NursingState = { kind: 'nursing', leftSeconds: 60, rightSeconds: 300, activeSide: null, activeSince: null }
    expect(shiftNursingStart(paused, 600, now)).toMatchObject({ leftSeconds: 60, rightSeconds: 900 })
    expect(shiftNursingStart(paused, -1000, now)).toMatchObject({ rightSeconds: 0 })
  })
})
