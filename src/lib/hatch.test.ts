import { describe, expect, it } from 'vitest'
import { ApiError } from './api/client'
import type { HatchStatus } from './api/companion'
import { hatchErrorText, hatchRowSummary, hatchTotals, hatchView, problemTone, unmappedBabies } from './hatch'

const now = new Date('2026-10-05T12:00:00Z')
const status = (over: Partial<HatchStatus> = {}): HatchStatus => ({
  connected: true,
  email: 'owner@example.com',
  needsLogin: false,
  syncing: false,
  babies: [{ id: 501, name: 'Ada', child: 3, imported: 12, matched: 4, pending: 0 }],
  imported: 12,
  matched: 4,
  pending: 0,
  lastSync: '2026-10-05T11:55:00+00:00',
  lastSuccess: '2026-10-05T11:55:00+00:00',
  sessionExpires: null,
  pollMinutes: 15,
  problem: null,
  report: 'Bramble / Hatch report',
  ...over,
})
const OFF = status({ connected: false, email: null, babies: [], imported: 0, matched: 0, lastSync: null, lastSuccess: null, report: null })

describe('hatchView', () => {
  it('picks the one screen the sheet shows', () => {
    expect(hatchView(undefined)).toBe('loading')
    expect(hatchView(OFF)).toBe('signin')
    expect(hatchView(status())).toBe('connected')
    expect(hatchView(status({ needsLogin: true }))).toBe('signin-again')
  })
  it('asks which child only while a baby has no answer yet', () => {
    const two = status({ babies: [{ id: 501, name: 'Ada', child: null, imported: 0, matched: 0, pending: 0 }, { id: 502, name: 'Nico', child: 0, imported: 0, matched: 0, pending: 0 }] })
    expect(hatchView(two)).toBe('choose')
    expect(unmappedBabies(two).map((b) => b.name)).toEqual(['Ada'])
    // "do not import" (0) is an answer
    expect(hatchView(status({ babies: [{ id: 502, name: 'Nico', child: 0, imported: 0, matched: 0, pending: 0 }] }))).toBe('connected')
  })
  it('signing in again wins over choosing', () => {
    expect(hatchView(status({ needsLogin: true, babies: [{ id: 501, name: 'Ada', child: null, imported: 0, matched: 0, pending: 0 }] }))).toBe('signin-again')
  })
})

describe('hatchRowSummary (the Settings row)', () => {
  it('says what state the connection is in, in a few words', () => {
    expect(hatchRowSummary(undefined, now)).toBe('Weights from the Hatch Grow scale')
    expect(hatchRowSummary(OFF, now)).toBe('Not connected')
    expect(hatchRowSummary(status(), now)).toBe('12 weights imported · checked 5m ago')
    expect(hatchRowSummary(status({ imported: 1 }), now)).toBe('1 weight imported · checked 5m ago')
    expect(hatchRowSummary(status({ imported: 0, lastSuccess: null }), now)).toBe('Connected · no weights yet')
    expect(hatchRowSummary(status({ syncing: true }), now)).toBe('Checking Hatch…')
  })
  it('puts what needs the owner first', () => {
    expect(hatchRowSummary(status({ needsLogin: true, problem: { code: 'needs_login', message: 'x', at: '' } }), now)).toBe('Sign in again')
    expect(hatchRowSummary(status({ babies: [{ id: 1, name: 'Ada', child: null, imported: 0, matched: 0, pending: 0 }] }), now)).toBe('Choose which child')
    expect(hatchRowSummary(status({ problem: { code: 'shape', message: 'x', at: '' } }), now)).toBe('Needs attention')
    // a passing hiccup is not the owner's job
    expect(hatchRowSummary(status({ problem: { code: 'hatch_unreachable', message: 'x', at: '' } }), now)).toBe('12 weights imported · checked 5m ago')
  })
})

describe('hatchTotals', () => {
  it('counts in words, singular and plural', () => {
    expect(hatchTotals(status())).toEqual(['12 weights imported', '4 already in Bramble'])
    expect(hatchTotals(status({ imported: 1, matched: 0 }))).toEqual(['1 weight imported'])
    expect(hatchTotals(status({ imported: 0, matched: 0 }))).toEqual(['No weights imported yet'])
    expect(hatchTotals(status({ imported: 2, matched: 0, pending: 3 }))).toEqual(['2 weights imported', '3 waiting'])
  })
})

describe('problemTone', () => {
  it('separates "will sort itself out" from "someone has to act"', () => {
    expect(problemTone('hatch_unreachable')).toBe('warn')
    expect(problemTone('rate_limited')).toBe('warn')
    expect(problemTone('babybuddy')).toBe('warn')
    expect(problemTone('needs_login')).toBe('error')
    expect(problemTone('shape')).toBe('error')
    expect(problemTone('no_route')).toBe('error')
    expect(problemTone('units')).toBe('error')
  })
})

describe('hatchErrorText', () => {
  it('shows the companion’s own sentence when there is one', () => {
    expect(hatchErrorText(new ApiError(400, { detail: 'Hatch did not accept that email and password.' }))).toBe('Hatch did not accept that email and password.')
    expect(hatchErrorText(new ApiError(429, { detail: 'Too many sign-in attempts. Wait ten minutes and try again.' }))).toMatch(/Too many/)
  })
  it('explains a missing or old companion instead of a bare status code', () => {
    expect(hatchErrorText(new ApiError(404, { detail: 'Not found.' }))).toMatch(/Bramble server needs updating/)
    expect(hatchErrorText(new ApiError(502, 'Unexpected HTML response'))).toMatch(/Bramble server needs updating/)
    expect(hatchErrorText(new TypeError('Failed to fetch'))).toBe('Cannot reach the server. Check your connection.')
  })
})
