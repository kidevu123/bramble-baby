import { describe, expect, it } from 'vitest'
import { autoPrintWanted, labelInputFor } from './auto-print'

describe('autoPrintWanted', () => {
  const base = { prefs: { autoPrint: true }, printerConfigured: true, editing: false, amount: 60, bagAlready: false }
  it('prints a new entry with a volume when the phone asked and the server has a printer', () => {
    expect(autoPrintWanted(base)).toBe(true)
  })
  it('never prints when switched off, without a server printer, on an edit, without a volume, or when the label sheet already made the bag', () => {
    expect(autoPrintWanted({ ...base, prefs: { autoPrint: false } })).toBe(false)
    expect(autoPrintWanted({ ...base, printerConfigured: false })).toBe(false)
    expect(autoPrintWanted({ ...base, editing: true })).toBe(false)
    expect(autoPrintWanted({ ...base, amount: 0 })).toBe(false)
    expect(autoPrintWanted({ ...base, amount: null })).toBe(false)
    expect(autoPrintWanted({ ...base, bagAlready: true })).toBe(false)
  })
})

describe('labelInputFor', () => {
  it('builds the label from the saved entry in the phone unit with the bag code', () => {
    const input = labelInputFor({ first_name: 'Ada', birth_date: '2026-09-01' }, { start: '2026-10-08T13:00:00Z', notes: 'left side' }, 60, 'ml', 'ABC234')
    expect(input).toMatchObject({ childName: 'Ada', amount: 60, unit: 'ml', notes: 'left side', code: 'ABC234', birthDate: '2026-09-01' })
    expect(input.pumpedAt.toISOString()).toBe('2026-10-08T13:00:00.000Z')
  })
})
