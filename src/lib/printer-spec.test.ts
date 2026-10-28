import { describe, expect, it } from 'vitest'
import { buildPrinterSpec, parsePrinterSpec, printerFormProblem } from './printer-spec'

describe('printer address <-> the Settings form', () => {
  it('round-trips the kinds the form shows field by field', () => {
    for (const spec of ['zebra://192.0.2.2:9100', 'brother_ql://tcp/192.0.2.9?model=QL-810W&label=29x62', 'bridge://192.0.2.190:8110?token=••••']) {
      const form = parsePrinterSpec(spec)
      expect(form.kind).not.toBe('other')
      expect(buildPrinterSpec(form)).toBe(spec)
    }
    expect(parsePrinterSpec('zebra://printer.local').port).toBe('9100')
    expect(parsePrinterSpec(null).kind).toBe('none')
    expect(buildPrinterSpec(parsePrinterSpec(''))).toBe('none')
    expect(parsePrinterSpec('none').kind).toBe('none')
  })
  it('keeps anything else as typed', () => {
    const odd = parsePrinterSpec('zebra://192.0.2.2:9100?darkness=22')
    expect(odd.kind).toBe('other')
    expect(buildPrinterSpec(odd)).toBe('zebra://192.0.2.2:9100?darkness=22')
  })
  it('says what is missing', () => {
    expect(printerFormProblem({ ...parsePrinterSpec('zebra://x:9100'), host: '' })).toMatch(/IP address/)
    expect(printerFormProblem({ ...parsePrinterSpec('zebra://x:9100'), port: '91OO' })).toMatch(/port/)
    expect(printerFormProblem({ ...parsePrinterSpec('bridge://x:8110?token=a'), token: ' ' })).toMatch(/token/)
    expect(printerFormProblem({ ...parsePrinterSpec(null), kind: 'other', raw: 'lpr' })).toMatch(/address/)
    expect(printerFormProblem(parsePrinterSpec('zebra://192.0.2.2:9100'))).toBeNull()
  })
})

describe('a Brother address with a port (sweep 2026-10-21)', () => {
  it('opens as Other with the address kept whole, so it can be saved as it is', () => {
    const f = parsePrinterSpec('brother_ql://tcp/192.0.2.5:9100?model=QL-810W&label=62')
    expect(f.kind).toBe('other')
    expect(printerFormProblem(f)).toBeNull()
    expect(buildPrinterSpec(f)).toBe('brother_ql://tcp/192.0.2.5:9100?model=QL-810W&label=62')
  })
})
