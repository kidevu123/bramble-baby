import { describe, expect, it } from 'vitest'
import { decodeGrowthNote, diaperInUnit, diaperText, encodeGrowthNote, growthEntryTime, growthNoteTime } from './growth-note'
import type { Weight } from './api/types'

const at = (h: number, m: number) => new Date(2026, 9, 6, h, m, 0, 0)

describe('decodeGrowthNote', () => {
  it('reads the companion’s Hatch note as written today: source word, then the clock', () => {
    expect(decodeGrowthNote('Hatch Grow scale · 8:38 AM')).toEqual({ time: { hours: 8, minutes: 38 }, text: 'Hatch Grow scale', slot: 1, diaperGrams: null })
    expect(decodeGrowthNote('Hatch Grow scale · 9:30 AM · after bath')).toEqual({ time: { hours: 9, minutes: 30 }, text: 'Hatch Grow scale · after bath', slot: 1, diaperGrams: null })
    expect(decodeGrowthNote('Hatch app · 2:05 PM')).toEqual({ time: { hours: 14, minutes: 5 }, text: 'Hatch app', slot: 1, diaperGrams: null })
  })
  it('reads a clock written first by the growth sheet', () => {
    expect(decodeGrowthNote('8:38 AM · after bath')).toEqual({ time: { hours: 8, minutes: 38 }, text: 'after bath', slot: 0, diaperGrams: null })
    expect(decodeGrowthNote('8:38 AM')).toEqual({ time: { hours: 8, minutes: 38 }, text: '', slot: 0, diaperGrams: null })
  })
  it('handles midnight and noon in 12-hour form', () => {
    expect(decodeGrowthNote('12:05 AM').time).toEqual({ hours: 0, minutes: 5 })
    expect(decodeGrowthNote('12:05 PM').time).toEqual({ hours: 12, minutes: 5 })
    expect(decodeGrowthNote('11:59 PM').time).toEqual({ hours: 23, minutes: 59 })
  })
  it('tolerates a narrow no-break space, lower case and dotted a.m.', () => {
    expect(decodeGrowthNote('8:38 AM').time).toEqual({ hours: 8, minutes: 38 })
    expect(decodeGrowthNote('8:38am · note').time).toEqual({ hours: 8, minutes: 38 })
    expect(decodeGrowthNote('8:38 p.m.').time).toEqual({ hours: 20, minutes: 38 })
  })
  it('leaves notes without a clock untouched', () => {
    expect(decodeGrowthNote(null)).toEqual({ time: null, text: '', slot: 0, diaperGrams: null })
    expect(decodeGrowthNote('')).toEqual({ time: null, text: '', slot: 0, diaperGrams: null })
    expect(decodeGrowthNote('weighed at the clinic')).toEqual({ time: null, text: 'weighed at the clinic', slot: 0, diaperGrams: null })
    // A clock inside a sentence is prose, not a marker.
    expect(decodeGrowthNote('fed at 8:00 AM, then weighed')).toEqual({ time: null, text: 'fed at 8:00 AM, then weighed', slot: 0, diaperGrams: null })
    // An impossible clock is not a marker either.
    expect(decodeGrowthNote('13:00 PM · note').time).toBeNull()
    expect(decodeGrowthNote('8:60 AM').time).toBeNull()
    expect(decodeGrowthNote('0:30 AM').time).toBeNull()
  })
  it('keeps every other segment byte for byte, including line breaks', () => {
    expect(decodeGrowthNote('8:38 AM · two words ·  odd spacing\nsecond line').text).toBe('two words ·  odd spacing\nsecond line')
  })
})

describe('encodeGrowthNote', () => {
  it('writes the clock first on a new entry', () => {
    expect(encodeGrowthNote('after bath', at(8, 38))).toBe('8:38 AM · after bath')
    expect(encodeGrowthNote('', at(8, 38))).toBe('8:38 AM')
    expect(encodeGrowthNote('', at(0, 5))).toBe('12:05 AM')
    expect(encodeGrowthNote('', at(12, 0))).toBe('12:00 PM')
  })
  it('without a time it is just the text', () => {
    expect(encodeGrowthNote('after bath', null)).toBe('after bath')
    expect(encodeGrowthNote('', null)).toBe('')
  })
  it('keeps the clock where the companion put it when a Hatch entry is edited', () => {
    const original = 'Hatch Grow scale · 8:38 AM · after bath'
    const { text, time, slot } = decodeGrowthNote(original)
    expect(encodeGrowthNote(text, at(time!.hours, time!.minutes), slot)).toBe(original)
    expect(encodeGrowthNote(text, at(9, 0), slot)).toBe('Hatch Grow scale · 9:00 AM · after bath')
    expect(encodeGrowthNote('Hatch Grow scale', at(9, 0), slot)).toBe('Hatch Grow scale · 9:00 AM')
  })
  it('never doubles the clock, whatever the text already holds', () => {
    expect(encodeGrowthNote('8:38 AM · after bath', at(9, 0))).toBe('9:00 AM · after bath')
    expect(encodeGrowthNote('Hatch Grow scale · 8:38 AM', at(9, 0), 1)).toBe('Hatch Grow scale · 9:00 AM')
  })
  it('falls back to the end when the slot is past the text', () => {
    expect(encodeGrowthNote('', at(9, 0), 1)).toBe('9:00 AM')
    expect(encodeGrowthNote('only', at(9, 0), 5)).toBe('only · 9:00 AM')
  })
  it('round-trips', () => {
    for (const note of ['8:38 AM · after bath', 'Hatch Grow scale · 2:05 PM', 'Hatch app · 9:30 AM · fussy', '12:00 AM']) {
      const d = decodeGrowthNote(note)
      expect(encodeGrowthNote(d.text, at(d.time!.hours, d.time!.minutes), d.slot)).toBe(note)
    }
  })
})

describe('growthEntryTime', () => {
  const weight = (notes: string | null): Weight => ({ id: 1, child: 1, weight: 5.9, date: '2026-10-06', notes, tags: [] })
  it('places the clock on the entry’s local date', () => {
    expect(growthEntryTime(weight('Hatch Grow scale · 8:38 AM'))).toEqual(new Date(2026, 9, 6, 8, 38, 0, 0))
    expect(growthNoteTime('2026-10-06', '8:38 AM')).toEqual(new Date(2026, 9, 6, 8, 38, 0, 0))
  })
  it('is null when the note has no clock', () => {
    expect(growthEntryTime(weight(null))).toBeNull()
    expect(growthEntryTime(weight('clinic'))).toBeNull()
  })
})

describe('the diaper segment', () => {
  it('reads the grams taken off and keeps them out of the text', () => {
    const n = decodeGrowthNote('8:38 AM · at the clinic · diaper −25 g')
    expect(n.diaperGrams).toBe(25)
    expect(n.text).toBe('at the clinic')
    expect(n.time).toEqual({ hours: 8, minutes: 38 })
    expect(decodeGrowthNote('diaper -22.5 g').diaperGrams).toBe(22.5)
    expect(decodeGrowthNote('a diaper note').diaperGrams).toBeNull()
  })

  it('writes it last, after the clock, and never doubles it', () => {
    const t = new Date(2026, 10, 4, 9, 5)
    expect(encodeGrowthNote('at the clinic', t, 0, 25)).toBe('9:05 AM · at the clinic · diaper −25 g')
    expect(encodeGrowthNote('at the clinic · diaper −25 g', t, 0, 30)).toBe('9:05 AM · at the clinic · diaper −30 g')
    expect(encodeGrowthNote('9:05 AM · diaper −25 g', null, 0, null)).toBe('')
  })

  it('says the diaper in the phone unit', () => {
    expect(diaperText(25, 'lb')).toBe('25 g (0.9 oz)')
    expect(diaperText(25, 'kg')).toBe('25 g')
    expect(diaperInUnit(25, 'kg')).toBeCloseTo(0.025, 6)
    expect(diaperInUnit(25, 'lb')).toBeCloseTo(0.0551, 3)
  })
})
