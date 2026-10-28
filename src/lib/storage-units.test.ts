import { describe, expect, it } from 'vitest'
import { bodyToStorage, convertValue, entryToDisplay, listToDisplay } from './storage-units'
import type { UnitPrefs } from './units'

const US: UnitPrefs = { volume: 'oz', temp: 'f', weight: 'lb', length: 'in' }
const METRIC: UnitPrefs = { volume: 'ml', temp: 'c', weight: 'kg', length: 'cm' }
const MIXED: UnitPrefs = { volume: 'ml', temp: 'f', weight: 'lb', length: 'in' }

describe('storage units', () => {
  it('shows a stored pound value in kilograms without touching the row shape', () => {
    const row = { id: 5, child: 6, date: '2026-09-30', weight: 5.39, notes: null, tags: [] }
    expect(entryToDisplay('weight', row, US, METRIC)).toEqual({ ...row, weight: 2.445 })
    expect(entryToDisplay('weight', row, US, US)).toBe(row)
  })
  it('round-trips what the user typed', () => {
    const typed = 7.5 // lb, on a phone set to lb, household storing kg
    const stored = bodyToStorage('weight', { child: 1, weight: typed }, METRIC, US).weight
    expect(stored).toBe(3.401943)
    expect(entryToDisplay('weight', { weight: stored }, METRIC, US).weight).toBe(7.5)
  })
  it('writes in the storage unit when the phone displays another', () => {
    // Household stores lb (legacy US install); Mom's phone shows kg and types 3 kg.
    expect(bodyToStorage('weight', { child: 1, weight: 3 }, US, METRIC).weight).toBeCloseTo(6.613868, 5)
    expect(bodyToStorage('feeding', { amount: 120, method: 'bottle' }, US, METRIC).amount).toBeCloseTo(4.057683, 5)
    expect(bodyToStorage('temperature', { temperature: 38 }, US, METRIC)).toEqual({ temperature: 100.4 })
    expect(bodyToStorage('height', { height: 50.8 }, US, METRIC)).toEqual({ height: 20 })
    expect(bodyToStorage('head', { head_circumference: 34.3 }, US, METRIC).head_circumference).toBeCloseTo(13.503937, 5)
    // And a phone showing kg reads that 3 kg back as exactly 3.
    expect(entryToDisplay('weight', { weight: 6.613868 }, US, METRIC).weight).toBe(3)
  })
  it('leaves null amounts and untouched dimensions alone', () => {
    expect(bodyToStorage('feeding', { amount: null }, US, METRIC)).toEqual({ amount: null })
    // Volume stored in mL, phone shows oz, but weight is lb on both sides: only volume converts.
    expect(convertValue('pumping', 10, MIXED, US)).toBe(0.34)
    expect(convertValue('weight', 5.39, MIXED, US)).toBe(5.39)
  })
  it('rounds displayed values to what the unit expresses', () => {
    expect(entryToDisplay('feeding', { amount: 5 }, US, METRIC).amount).toBe(148)
    expect(entryToDisplay('weight', { weight: 8 }, US, METRIC).weight).toBe(3.629)
    expect(entryToDisplay('height', { height: 20.5 }, US, METRIC).height).toBe(52.1)
    expect(entryToDisplay('temperature', { temperature: 99.1 }, US, METRIC).temperature).toBe(37.3)
  })
  it('converts whole lists and returns the same array when nothing changes', () => {
    const rows = [{ id: 1, amount: 10 }, { id: 2, amount: null }]
    expect(listToDisplay('pumping', rows, MIXED, US)).toEqual([{ id: 1, amount: 0.34 }, { id: 2, amount: null }])
    expect(listToDisplay('pumping', rows, MIXED, MIXED)).toBe(rows)
  })
})
