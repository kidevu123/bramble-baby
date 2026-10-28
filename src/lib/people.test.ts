import { describe, expect, it } from 'vitest'
import type { Person } from './api/companion'
import { ApiError } from './api/client'
import { capitalise, isUnavailableError, labelsFor, peopleErrorText, peopleSummary, personLabel, sortPeople, validateNewPerson, withTaggedLogins } from './people'

const person = (over: Partial<Person>): Person => ({ username: 'x', role: null, name: '', user_id: null, active: true, staff: false, label: '', you: false, screen: 'full', simpleActions: ['bottle', 'diaper'], ...over })

describe('people labels', () => {
  it('shows the role, the name for Other, else the username made presentable', () => {
    expect(personLabel({ username: 'mom', role: 'mom', name: 'Sara' })).toBe('Mom')
    expect(personLabel({ username: 'jo', role: 'other', name: 'Auntie Jo' })).toBe('Auntie Jo')
    expect(personLabel({ username: 'jo', role: 'other', name: '  ' })).toBe('Jo')
    expect(personLabel({ username: 'admin', role: null, name: '' })).toBe('Admin')
    expect(capitalise('')).toBe('')
  })
  it('maps usernames to labels case-insensitively, preferring the server label', () => {
    const names = labelsFor([person({ username: 'Admin', role: 'dad', name: '', label: 'Dad' }), person({ username: 'mom', role: 'mom', name: 'Sara' })])
    expect(names).toEqual({ admin: 'Dad', mom: 'Mom' })
  })
})

describe('logins only seen in tags', () => {
  it('are added as unnamed people once, without duplicating the listing', () => {
    const listing = [person({ username: 'admin', role: 'dad', label: 'Dad', you: true })]
    const merged = withTaggedLogins(listing, ['admin', 'ADMIN', ' mom ', 'nanny', ''])
    expect(merged.map((p) => p.username)).toEqual(['admin', 'mom', 'nanny'])
    expect(merged[1]).toMatchObject({ role: null, label: 'Mom', active: true, you: false })
    expect(withTaggedLogins(listing, ['admin'])).toBe(listing)
  })
})

describe('settings row summary', () => {
  it('names the roles that are set, or says what to do', () => {
    expect(peopleSummary(undefined)).toBe('Who logs what')
    expect(peopleSummary([person({ username: 'admin', you: true })])).toBe('Set who you are')
    expect(peopleSummary([person({ username: 'admin' }), person({ username: 'mom' })])).toBe('2 logins · set who’s who')
    expect(peopleSummary([person({ username: 'admin', role: 'dad', label: 'Dad' }), person({ username: 'mom', role: 'mom', label: 'Mom' }), person({ username: 'old', role: 'nanny', label: 'Nanny', active: false })])).toBe('Dad, Mom')
    const many = ['Dad', 'Mom', 'Grandma', 'Grandpa', 'Nanny'].map((label, i) => person({ username: `u${i}`, role: 'other', label }))
    expect(peopleSummary(many)).toBe('Dad, Mom, Grandma +2')
  })
})

describe('new person validation', () => {
  const existing = [person({ username: 'Admin' })]
  it('checks the username, the name for Other and the password before anything is sent', () => {
    expect(validateNewPerson({ role: 'mom', name: '', username: 'mom', password: 'walnut-cradle-77' }, existing)).toEqual({})
    expect(validateNewPerson({ role: 'mom', name: '', username: '', password: '' }, existing)).toMatchObject({ username: expect.stringContaining('username'), password: expect.stringContaining('password') })
    expect(validateNewPerson({ role: 'mom', name: '', username: 'mom sara', password: 'walnut-cradle-77' }, existing).username).toContain('no spaces')
    expect(validateNewPerson({ role: 'mom', name: '', username: 'admin', password: 'walnut-cradle-77' }, existing).username).toContain('already in the household')
    expect(validateNewPerson({ role: 'other', name: ' ', username: 'jo', password: 'walnut-cradle-77' }, existing).name).toContain('Other')
    expect(validateNewPerson({ role: 'dad', name: '', username: 'dad', password: 'short' }, existing).password).toContain('8')
    expect(validateNewPerson({ role: 'dad', name: '', username: 'dad', password: '12345678' }, existing).password).toContain('numbers')
    expect(validateNewPerson({ role: 'dad', name: '', username: 'sam', password: 'sam-sam-sam' }, existing).password).toContain('username')
  })
})

describe('server errors', () => {
  it('passes the server’s plain language through and recognises an unavailable channel', () => {
    const refused = new ApiError(400, { detail: 'This password is too short.' })
    expect(peopleErrorText(refused)).toBe('This password is too short.')
    const unavailable = new ApiError(503, { detail: 'Put BABYBUDDY_HOME=… in /opt/bramble-server/data/env', unavailable: true })
    expect(isUnavailableError(unavailable)).toBe(true)
    expect(isUnavailableError(refused)).toBe(false)
    expect(peopleErrorText(new ApiError(404, null))).toContain('needs updating')
  })
})

describe('sorting', () => {
  it('puts you first, removed people last, and roles in household order', () => {
    const rows = sortPeople([person({ username: 'old', role: 'nanny', label: 'Nanny', active: false }), person({ username: 'mom', role: 'mom', label: 'Mom' }), person({ username: 'jo', role: 'other', label: 'Auntie Jo' }), person({ username: 'admin', role: 'dad', label: 'Dad', you: true }), person({ username: 'new', role: null, label: 'New' })])
    expect(rows.map((p) => p.username)).toEqual(['admin', 'mom', 'jo', 'new', 'old'])
  })
})
