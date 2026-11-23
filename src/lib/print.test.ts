import { describe, expect, it } from 'vitest'
import type { PrintJob } from './api/companion'
import { formatSince, partlyPrinted, printInOrder, printJobTone } from './print'

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

describe('printInOrder', () => {
  const codes = ['A1', 'A2', 'A3', 'A4', 'A5']

  it('sends every label once, in order, and says how far it is', async () => {
    const out: string[] = []
    const steps: string[] = []
    const done = new Set<string>()
    const sent = await printInOrder(codes, (c) => c, async (c) => void out.push(c), done, (n, of) => steps.push(`${n}/${of}`))
    expect(sent).toBe(5)
    expect(out).toEqual(codes)
    expect(steps).toEqual(['0/5', '1/5', '2/5', '3/5', '4/5', '5/5'])
    expect([...done]).toEqual(codes)
  })

  it('stops at the first failure, and the next tap sends only the rest: nothing comes out twice', async () => {
    const out: string[] = []
    const done = new Set<string>()
    let refuse = true
    const send = async (c: string) => {
      if (c === 'A3' && refuse) throw new Error('Could not reach the Zebra')
      out.push(c)
    }
    let last = { sent: 0, of: 0 }
    await expect(printInOrder(codes, (c) => c, send, done, (sent, of) => (last = { sent, of }))).rejects.toThrow('Could not reach the Zebra')
    expect(out).toEqual(['A1', 'A2'])
    expect(last).toEqual({ sent: 2, of: 5 })
    expect(partlyPrinted(last.sent, last.of)).toBe('2 of 5 went to the printer. Tap again to send the other 3; the ones already printed are not sent twice.')
    refuse = false
    expect(await printInOrder(codes, (c) => c, send, done)).toBe(5)
    expect(out).toEqual(codes)
  })

  it('has nothing to add when none or all went out', () => {
    expect(partlyPrinted(0, 20)).toBeNull()
    expect(partlyPrinted(20, 20)).toBeNull()
  })
})

