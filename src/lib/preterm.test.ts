import { describe, expect, it } from 'vitest'
import { ageBasis, ageHold, correctedAgeText, describeWeeks, holdLine, judgedAge, judgedMonths, normsFrom, pretermState, whoFrom } from './preterm'

// Born Jul 1 at 25 wk 3 d (178 days): due 102 days later, Oct 11. In the NICU from the birth to Sep 20.
const child = { birth_date: '2026-07-01' }
const basis = ageBasis(child, { bornAtDays: 178, nicu: { since: '2026-07-01', home: '2026-09-20' } })
const at = (s: string) => new Date(`${s}T12:00:00`)

describe('ageBasis', () => {
  it('works out the due date from the weeks at birth', () => {
    expect(basis.due).toBe('2026-10-11')
    expect(describeWeeks(178)).toBe('25 wk 3 d')
    expect(describeWeeks(175)).toBe('25 wk')
  })
  it('ignores weeks that are not born early (37 or more) or nonsense, so a term baby reads as before', () => {
    expect(ageBasis(child, { bornAtDays: 37 * 7 }).due).toBeNull()
    expect(ageBasis(child, { bornAtDays: 100 }).due).toBeNull()
    expect(ageBasis(child, { bornAtDays: 178.5 }).due).toBeNull()
    expect(ageBasis(child, {}).due).toBeNull()
  })
})

describe('ageHold', () => {
  it('holds in the NICU, then before the due date at home, then never', () => {
    expect(ageHold(basis, at('2026-08-01'))).toBe('nicu')
    expect(ageHold(basis, at('2026-09-19'))).toBe('nicu')
    expect(ageHold(basis, at('2026-09-20'))).toBe('before-term') // the day they came home is home
    expect(ageHold(basis, at('2026-10-11'))).toBeNull()
  })
  it('holds a term baby in the NICU, and nothing else', () => {
    const term = ageBasis(child, { nicu: { since: '2026-07-01', home: null } })
    expect(ageHold(term, at('2026-12-01'))).toBe('nicu')
    expect(ageHold('2026-07-01', at('2026-08-01'))).toBeNull()
  })
})

describe('corrected age', () => {
  it('counts the age-typical tables from the due date, until two years from the birth', () => {
    expect(normsFrom(basis, at('2026-12-11'))).toBe('2026-10-11')
    expect(judgedAge(basis, at('2026-12-11')).ageMonths).toBeCloseTo(61 / 30.4375)
    expect(judgedMonths(basis, at('2026-12-11'))).toBeCloseTo(61 / 30.4375)
    expect(normsFrom(basis, at('2028-07-01'))).toBe('2026-07-01')
  })
  it('gives no WHO age before term and the corrected one after', () => {
    expect(whoFrom(basis, at('2026-09-01'))).toBeNull()
    expect(whoFrom(basis, at('2026-10-11'))).toBe('2026-10-11')
    expect(whoFrom('2026-07-01', at('2026-09-01'))).toBe('2026-07-01')
  })
  it('judges nothing before term (no negative ages reach the tables)', () => {
    const ctx = judgedAge(basis, at('2026-09-25'))
    expect(ctx.hold).toBe('before-term')
    expect(ctx.expecting).toBe(false)
    expect(judgedMonths(basis, at('2026-09-25'))).toBe(0)
    // In the NICU before the due date too: never read as expecting (that hides every tile).
    expect(judgedAge(basis, at('2026-08-01'))).toMatchObject({ expecting: false, hold: 'nicu', ageMonths: 0 })
  })
  it('says the age beside the real one: weeks before term, corrected after', () => {
    expect(correctedAgeText(basis, at('2026-08-01'))).toBe('29 wk 6 d corrected') // 178 + 31 days
    expect(correctedAgeText(basis, at('2026-12-11'))).toBe('8 wk 5 d corrected')
    expect(correctedAgeText(basis, at('2028-08-01'))).toBeNull()
    expect(correctedAgeText(ageBasis(child, {}), at('2026-12-11'))).toBeNull()
  })
})

describe('lines', () => {
  it('reads the NICU stay and the hold for the band and Settings', () => {
    expect(holdLine(basis, at('2026-08-01'))).toBe('In the NICU · 29 wk 6 d corrected · due Oct 11')
    expect(holdLine(basis, at('2026-10-20'))).toBeNull()
    expect(pretermState(basis, at('2026-08-01'))).toBe('Born at 25 wk 3 d · in the NICU since Jul 1')
    expect(pretermState(basis, at('2026-10-01'))).toBe('Born at 25 wk 3 d · home since Sep 20')
    expect(pretermState(ageBasis(child, {}), at('2026-10-01'))).toBe('Off')
  })
})
