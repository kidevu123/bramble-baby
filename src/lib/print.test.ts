import { describe, expect, it } from 'vitest'
import type { PrintJob } from './api/companion'
import { formatSince, printJobTone } from './print'

const job = (over: Partial<PrintJob>): PrintJob => ({ id: 1, backend: 'zebra', bag: 'AB23CD', state: 'sent', checking: false, detail: '', sent_at: '2026-10-06T06:00:00Z', checked_at: null, ...over })

describe('printJobTone', () => {
  it('is waiting while the printer has not answered, and a problem once it never did', () => {
    expect(printJobTone(job({ state: 'sent', checking: true }))).toBe('waiting')
    expect(printJobTone(job({ state: 'busy' }))).toBe('waiting')
    expect(printJobTone(job({ state: 'no_answer', checking: true }))).toBe('waiting')
    expect(printJobTone(job({ state: 'no_answer' }))).toBe('problem') // final: nothing pulses forever
  })
  it('is good once the printer says it is done, and for backends with nothing to ask', () => {
    expect(printJobTone(job({ state: 'ready' }))).toBe('good')
    expect(printJobTone(job({ backend: 'file', state: 'sent', checking: false }))).toBe('good')
  })
  it('flags what the caregiver has to fix at the printer', () => {
    for (const state of ['paper_out', 'head_open', 'paused', 'temperature'] as const) expect(printJobTone(job({ state }))).toBe('problem')
  })
})

describe('formatSince', () => {
  const at = new Date('2026-10-06T06:00:00Z')
  const after = (ms: number) => new Date(at.getTime() + ms)
  it('rounds to what a tapping thumb cares about', () => {
    expect(formatSince(at, after(0))).toBe('just now')
    expect(formatSince(at, after(4_400))).toBe('just now')
    expect(formatSince(at, after(12_000))).toBe('12 s ago')
    expect(formatSince(at, after(59_400))).toBe('59 s ago')
    expect(formatSince(at, after(3 * 60_000 + 20_000))).toBe('3 min ago')
    expect(formatSince(at, after(2 * 3_600_000 + 5 * 60_000))).toBe('2 h ago')
  })
  it('never goes negative when the phone clock is behind the server', () => {
    expect(formatSince(at, after(-30_000))).toBe('just now')
  })
})
