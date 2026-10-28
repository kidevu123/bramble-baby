import type { NursingState } from '../../lib/nursing'

/**
 * A running nursing timer's start moved by `deltaSeconds` (positive: started earlier, "forgot to start it").
 * The gap goes to the side that was running, or, when paused, to the side that has the time, so the
 * per-side note always adds up to the duration Baby Buddy computes from the timer's start.
 */
export function shiftNursingStart(state: NursingState, deltaSeconds: number, now: Date = new Date()): NursingState {
  if (state.activeSide && state.activeSince) {
    const since = new Date(state.activeSince).getTime() - deltaSeconds * 1000
    return { ...state, activeSince: new Date(Math.min(since, now.getTime())).toISOString() }
  }
  if (state.rightSeconds > state.leftSeconds) return { ...state, rightSeconds: Math.max(0, state.rightSeconds + deltaSeconds) }
  return { ...state, leftSeconds: Math.max(0, state.leftSeconds + deltaSeconds) }
}
