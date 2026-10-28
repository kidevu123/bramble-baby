import { describe, expect, it } from 'vitest'
import { parseQuickText } from './quick-text'
import type { UnitPrefs } from './units'

const now = new Date('2026-10-09T15:30:00')
const ml: UnitPrefs = { volume: 'ml', weight: 'lb', length: 'in', temp: 'f' }
const oz: UnitPrefs = { volume: 'oz', weight: 'kg', length: 'cm', temp: 'c' }
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 9, 9 + dayOffset, h, m, 0)
const parse = (s: string, u: UnitPrefs = ml) => parseQuickText(s, u, now)

describe('parseQuickText', () => {
  it('reads a bottle with its amount, milk and time', () => {
    expect(parse('60 ml bottle 3pm')).toEqual({ prefill: { kind: 'bottle', amount: 60, milk: undefined, at: at(15) }, summary: 'Bottle · 60 mL · 3:00 PM' })
    expect(parse('bottle 2 oz formula at 2:15')).toEqual({ prefill: { kind: 'bottle', amount: 59, milk: 'formula', at: at(14, 15) }, summary: 'Bottle · 59 mL formula · 2:15 PM' })
    expect(parse('fed 90')?.prefill).toEqual({ kind: 'bottle', amount: 90, milk: undefined, at: undefined })
    expect(parse('fed 90')?.summary).toBe('Bottle · 90 mL · just now')
    expect(parse('80 ml', oz)?.prefill).toMatchObject({ kind: 'bottle', amount: 2.71 })
    expect(parse('3 oz bm 20 min ago', oz)).toEqual({ prefill: { kind: 'bottle', amount: 3, milk: 'breast milk', at: at(15, 10) }, summary: 'Bottle · 3 oz breast milk · 3:10 PM' })
  })
  it('reads nursing with the side and the minutes', () => {
    expect(parse('nursed left 12 min 2:40pm')).toEqual({ prefill: { kind: 'nursing', side: 'left', minutes: 12, at: at(14, 40) }, summary: 'Nursing · left · 12 min · 2:40 PM' })
    expect(parse('both sides 1:10-1:35')?.prefill).toEqual({ kind: 'nursing', side: 'both', minutes: 25, at: at(13, 10) })
    expect(parse('breastfed right')?.summary).toBe('Nursing · right · just now')
  })
  it('reads diapers', () => {
    expect(parse('wet diaper')).toEqual({ prefill: { kind: 'diaper', what: 'pee', at: undefined }, summary: 'Diaper · wet · just now' })
    expect(parse('poop 1h ago')?.prefill).toEqual({ kind: 'diaper', what: 'poo', at: at(14, 30) })
    expect(parse('wet and dirty diaper at 7')?.prefill).toEqual({ kind: 'diaper', what: 'mixed', at: at(7) })
    expect(parse('dry diaper yesterday 11pm')?.prefill).toEqual({ kind: 'diaper', what: 'dry', at: at(23, 0, -1) })
  })
  it('reads pumping with the volume, length and finish time', () => {
    expect(parse('pump 90')).toEqual({ prefill: { kind: 'pumping', amount: 90, minutes: undefined, end: undefined }, summary: 'Pumping · 90 mL · finished just now' })
    expect(parse('pumped 4 oz 20 min 1pm')).toEqual({ prefill: { kind: 'pumping', amount: 118, minutes: 20, end: at(13) }, summary: 'Pumping · 118 mL · 20 min · finished 1:00 PM' })
    expect(parse('pumping 12:00-12:25 100ml')?.prefill).toEqual({ kind: 'pumping', amount: 100, minutes: 25, end: at(12, 25) })
  })
  it('reads sleep as a range, a wake time or a length', () => {
    expect(parse('nap 1:30-2:15')).toEqual({ prefill: { kind: 'sleep', start: at(13, 30), end: at(14, 15), nap: true }, summary: 'Nap · 1:30 PM–2:15 PM' })
    expect(parse('woke 7am')?.prefill).toEqual({ kind: 'sleep', start: undefined, end: at(7), nap: undefined })
    expect(parse('slept 45 min')?.prefill).toEqual({ kind: 'sleep', start: at(14, 45), end: now, nap: undefined })
    expect(parse('night sleep 8pm to 6am')?.prefill).toEqual({ kind: 'sleep', start: at(20, 0, -1), end: at(6), nap: false })
    expect(parse('asleep at 1pm for 40 min')?.prefill).toEqual({ kind: 'sleep', start: at(13), end: at(13, 40), nap: undefined })
  })
  it('reads tummy time', () => {
    expect(parse('tummy time 5 min')?.prefill).toEqual({ kind: 'tummy', minutes: 5, end: undefined })
  })
  it('reads weight, height and head in any unit into the phone’s', () => {
    expect(parse('weight 5 lb 6 oz')).toEqual({ prefill: { kind: 'growth', growthKind: 'weight', value: 5.375, at: undefined }, summary: 'Weight · 5 lb 6 oz' })
    expect(parse('weighs 2450 g')?.prefill).toMatchObject({ growthKind: 'weight', value: 5.401 })
    expect(parse('2.5 kg', oz)?.prefill).toMatchObject({ growthKind: 'weight', value: 2.5 })
    expect(parse('weight 5.4')?.prefill).toMatchObject({ growthKind: 'weight', value: 5.4 })
    expect(parse('height 19.5 in')?.prefill).toMatchObject({ growthKind: 'height', value: 19.5 })
    expect(parse('length 50 cm')?.prefill).toMatchObject({ growthKind: 'height', value: 19.7 })
    expect(parse('head 35 cm', oz)?.prefill).toMatchObject({ growthKind: 'head', value: 35 })
  })
  it('reads a temperature, guessing the scale from the number', () => {
    expect(parse('temp 99.1')).toEqual({ prefill: { kind: 'temperature', value: 99.1, at: undefined }, summary: 'Temperature · 99.1°F · just now' })
    expect(parse('fever 38.2 at 3')?.prefill).toEqual({ kind: 'temperature', value: 100.8, at: at(15) })
    expect(parse('temp 101f', oz)?.prefill).toMatchObject({ value: 38.3 })
  })
  it('reads a note and gives up on the rest', () => {
    expect(parse('note hiccups after the bottle')?.prefill).toEqual({ kind: 'note', text: 'hiccups after the bottle', at: undefined })
    expect(parse('hello there')).toBeNull()
    expect(parse('')).toBeNull()
  })
  it('reads a clock with no am/pm as the latest such time that already happened', () => {
    expect(parse('bottle at 3')?.prefill).toMatchObject({ at: at(15) }) // 3:30 PM now: 3 PM, not 3 AM
    expect(parse('bottle at 4')?.prefill).toMatchObject({ at: at(4) }) // 4 PM has not come: 4 AM
    expect(parse('bottle 11:45')?.prefill).toMatchObject({ at: at(11, 45) })
    expect(parse('bottle 16:05')?.prefill).toMatchObject({ at: at(16, 5, -1) }) // later today than now: yesterday
  })
  it('reads decimal hours ago and never throws on a runaway number', () => {
    expect(parse('bottle 60 ml 1.5 h ago')?.prefill).toMatchObject({ kind: 'bottle', at: at(14, 0) })
    expect(parse('bottle 60 ml 1,5 hours ago')?.prefill).toMatchObject({ at: at(14, 0) })
    expect(() => parse('bottle 60 ml 99999999999 h ago')).not.toThrow()
    expect(parse('bottle 60 ml 99999999999 h ago')?.prefill).toMatchObject({ at: at(15, 30, -7) }) // a week back at most
    expect(() => parse('nap 9999999999999999999999 min')).not.toThrow()
    expect(() => parse('bottle 9999999999999999999999999999999999 ml')).not.toThrow()
  })
  it('tells a diaper from nursing and breast milk', () => {
    expect(parse('diaper both')?.prefill).toEqual({ kind: 'diaper', what: 'mixed', at: undefined })
    expect(parse('dirty diaper bm')?.prefill).toMatchObject({ kind: 'diaper', what: 'poo' })
    expect(parse('diaper bm')?.prefill).toMatchObject({ kind: 'diaper', what: 'poo' })
    expect(parse('wet dirty diaper')?.prefill).toMatchObject({ kind: 'diaper', what: 'mixed' })
    expect(parse('bm 60')?.prefill).toMatchObject({ kind: 'bottle', milk: 'breast milk', amount: 60 })
    expect(parse('formula left 30')?.prefill).toMatchObject({ kind: 'bottle', milk: 'formula', amount: 30 })
    expect(parse('left 12 min')?.prefill).toMatchObject({ kind: 'nursing', side: 'left', minutes: 12 })
  })
  it('reads a range as one span that has already ended', () => {
    const evening = new Date(2026, 9, 9, 19, 0)
    expect(parseQuickText('night 11pm-6', ml, evening)?.prefill).toMatchObject({ start: at(23, 0, -1), end: at(6) })
    expect(parse('nap 11-1pm')?.prefill).toMatchObject({ start: at(11), end: at(13) })
    expect(parse('nap 0:30-1:15')?.prefill).toMatchObject({ start: at(0, 30), end: at(1, 15) }) // a 24-hour 0:30 is half past midnight
    expect(parse('nap 1:30-1:30')?.prefill).toEqual({ kind: 'sleep', start: undefined, end: undefined, nap: true }) // an empty span is no range
    // "2 to 3 oz" is an amount, not 2:00–3:00
    expect(parse('pump 2 to 3 oz')?.prefill).toEqual({ kind: 'pumping', amount: 89, minutes: undefined, end: undefined })
  })
  it('never ends a sleep in the future', () => {
    const three = new Date(2026, 9, 9, 3, 0)
    const p = parseQuickText('slept 10pm for 8 h', ml, three)?.prefill
    expect(p).toMatchObject({ start: at(22, 0, -1), end: three })
  })
  it('keeps the ounces of "5lb6oz", reads a big bare weight as grams and a big bare volume on an oz phone as mL', () => {
    expect(parse('weight 5lb6oz')?.prefill).toMatchObject({ value: 5.375 })
    expect(parse('weight 3400')?.prefill).toMatchObject({ growthKind: 'weight', value: 7.496 })
    expect(parse('weight 3400', oz)?.prefill).toMatchObject({ value: 3.4 })
    expect(parse('pump 90', { ...ml, volume: 'oz' })?.prefill).toMatchObject({ amount: 3.04 })
    expect(parse('pump 4', { ...ml, volume: 'oz' })?.prefill).toMatchObject({ amount: 4 })
    expect(parse('bottle 2 oz')?.prefill).toMatchObject({ amount: 59 }) // whole mL, as the sheet shows it
  })
  it('fills both sides of a two-sided feed and keeps an hour before the amount', () => {
    expect(parse('nursed left 10 min right 5 min')).toEqual({ prefill: { kind: 'nursing', side: 'both', minutes: 15, left: 10, right: 5, at: undefined }, summary: 'Nursing · left 10 min, right 5 min · just now' })
    expect(parse('5 min right 10 min left')?.prefill).toMatchObject({ left: 10, right: 5 })
    expect(parse('pump 1 h 90 ml')?.prefill).toMatchObject({ minutes: 60, amount: 90 })
    expect(parse('nap 1 h 30')?.prefill).toMatchObject({ kind: 'sleep' }) // "1 h 30" is not an hour and an amount
  })
  it('keeps the times inside a note and takes only one at its edge as when', () => {
    expect(parse('note Spit up after the 3pm bottle')?.prefill).toEqual({ kind: 'note', text: 'Spit up after the 3pm bottle', at: undefined })
    expect(parse('note slept badly 3pm')?.prefill).toEqual({ kind: 'note', text: 'slept badly 3pm', at: at(15) })
    expect(parse('note 20 min ago hiccups')?.prefill).toMatchObject({ text: '20 min ago hiccups', at: at(15, 10) })
  })
})
