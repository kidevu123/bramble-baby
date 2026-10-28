/**
 * Nursing timers track two sides. We keep that state inside the Baby Buddy
 * timer's `name` field (max 255 chars) so every device sees the same L/R state.
 */
export type Side = 'left' | 'right'

export interface NursingState {
  kind: 'nursing'
  leftSeconds: number
  rightSeconds: number
  activeSide: Side | null
  /** ISO time the active side started counting, if any. */
  activeSince: string | null
}

export const NURSING_PREFIX = 'nursing:'

export function encodeNursing(state: NursingState): string {
  const parts = [
    `L=${Math.round(state.leftSeconds)}`,
    `R=${Math.round(state.rightSeconds)}`,
    `A=${state.activeSide ?? '-'}`,
    `S=${state.activeSince ?? '-'}`,
  ]
  return NURSING_PREFIX + parts.join(';')
}

export function decodeNursing(name: string | null | undefined): NursingState | null {
  if (!name || !name.startsWith(NURSING_PREFIX)) return null
  const map = new Map<string, string>()
  for (const part of name.slice(NURSING_PREFIX.length).split(';')) {
    const [k, v] = part.split('=')
    if (k) map.set(k, v ?? '')
  }
  const side = map.get('A')
  const since = map.get('S')
  return {
    kind: 'nursing',
    leftSeconds: Number(map.get('L') ?? 0) || 0,
    rightSeconds: Number(map.get('R') ?? 0) || 0,
    activeSide: side === 'left' || side === 'right' ? side : null,
    activeSince: since && since !== '-' ? since : null,
  }
}

export function freshNursing(side: Side, now: Date = new Date()): NursingState {
  return { kind: 'nursing', leftSeconds: 0, rightSeconds: 0, activeSide: side, activeSince: now.toISOString() }
}

/** Live totals including the running side. */
export function nursingTotals(state: NursingState, now: Date = new Date()) {
  let left = state.leftSeconds
  let right = state.rightSeconds
  if (state.activeSide && state.activeSince) {
    const extra = Math.max(0, (now.getTime() - new Date(state.activeSince).getTime()) / 1000)
    if (state.activeSide === 'left') left += extra
    else right += extra
  }
  return { left, right, total: left + right }
}

/** Freeze the running side into its accumulated total. */
export function pauseNursing(state: NursingState, now: Date = new Date()): NursingState {
  const totals = nursingTotals(state, now)
  return { ...state, leftSeconds: totals.left, rightSeconds: totals.right, activeSide: null, activeSince: null }
}

/** Tap a side: switch to it, or pause it if it is already running. */
export function toggleSide(state: NursingState, side: Side, now: Date = new Date()): NursingState {
  const paused = pauseNursing(state, now)
  if (state.activeSide === side) return paused
  return { ...paused, activeSide: side, activeSince: now.toISOString() }
}

/** "Left 5m", "Left 1h 5m · Right 7m", "Right 12m" → minutes per side, plus the remaining free-text notes. */
export function parseSideNote(notes: string | null | undefined): { left: number; right: number; rest: string; found: boolean } {
  const text = notes ?? ''
  const [first = '', ...others] = text.split('\n')
  const dur = '(?:(\\d+)h\\s*)?(?:(\\d+)m)?(?:\\s*(\\d+)s)?'
  const re = new RegExp(`^(?:Left\\s+${dur})?(?:\\s*·\\s*)?(?:Right\\s+${dur})?$`, 'i')
  const m = first.trim().match(re)
  const hasSide = /^(Left|Right)\s+\d/i.test(first.trim())
  if (!m || !hasSide) return { left: 0, right: 0, rest: text, found: false }
  // Seconds-only sides ("Left 40s") round up to a minute so the edit form has something to show.
  const mins = (h?: string, mm?: string, ss?: string) => Number(h ?? 0) * 60 + Number(mm ?? 0) + (ss && !h && !mm ? 1 : 0)
  return { left: mins(m[1], m[2], m[3]), right: mins(m[4], m[5], m[6]), rest: others.join('\n'), found: true }
}

export function nursingMethod(state: NursingState): 'left breast' | 'right breast' | 'both breasts' {
  const { left, right } = nursingTotals(state)
  if (left > 0 && right > 0) return 'both breasts'
  return right > 0 ? 'right breast' : 'left breast'
}
