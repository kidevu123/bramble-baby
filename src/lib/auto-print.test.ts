import { describe, expect, it } from 'vitest'
import { autoPrintWanted, labelInputFor, labelInputForBag, reprintOnMoveWanted } from './auto-print'

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

describe('reprintOnMoveWanted', () => {
  const on = { prefs: { reprintOnFreezer: true }, printerConfigured: true }
  it('prints when a bag goes into the freezer or comes out of it to thaw', () => {
    expect(reprintOnMoveWanted({ ...on, from: 'fridge', to: 'freezer' })).toBe(true)
    expect(reprintOnMoveWanted({ ...on, from: 'room', to: 'freezer' })).toBe(true)
    expect(reprintOnMoveWanted({ ...on, from: 'freezer', to: 'fridge' })).toBe(true)
  })
  it('leaves counter and fridge moves alone, and needs the switch and a server printer', () => {
    expect(reprintOnMoveWanted({ ...on, from: 'fridge', to: 'room' })).toBe(false)
    expect(reprintOnMoveWanted({ ...on, from: 'freezer', to: 'freezer' })).toBe(false)
    expect(reprintOnMoveWanted({ ...on, prefs: { reprintOnFreezer: false }, from: 'fridge', to: 'freezer' })).toBe(false)
    expect(reprintOnMoveWanted({ ...on, printerConfigured: false, from: 'fridge', to: 'freezer' })).toBe(false)
  })
})

describe('labelInputForBag', () => {
  const child = { first_name: 'Ada', birth_date: '2026-09-01' }
  const bag = { pumped_at: '2026-10-20T13:00:00Z', volume_ml: 120, notes: '', code: 'ABC123', thawed: false, thawed_at: null }
  it('is the bag as the label sheet draws it, in the phone unit', () => {
    const input = labelInputForBag(child, bag, 'ml')
    expect([input.amount, input.code, input.thawedAt, input.pumpedAt.toISOString()]).toEqual([120, 'ABC123', null, '2026-10-20T13:00:00.000Z'])
  })
  it('a thawed bag gets the thaw clock, so the label says THAWED with its own use-by times', () => {
    const input = labelInputForBag(child, { ...bag, thawed: true, thawed_at: '2026-10-27T09:00:00Z' }, 'ml')
    expect(input.thawedAt?.toISOString()).toBe('2026-10-27T09:00:00.000Z')
  })
})
