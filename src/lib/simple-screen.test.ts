import { afterEach, describe, expect, it } from 'vitest'
import type { Person } from './api/companion'
import { agoText, diaperBody, myScreen, readCachedScreen, whenText, writeCachedScreen } from './simple-screen'

const person = (over: Partial<Person>): Person => ({ username: 'x', role: null, name: '', user_id: null, active: true, staff: false, label: '', you: false, screen: 'full', simpleActions: ['bottle', 'diaper'], ...over })

afterEach(() => localStorage.clear())

describe('the simple screen', () => {
  it('follows the signed-in person, and is the full app for anyone else or no listing yet', () => {
    expect(myScreen(undefined)).toBeNull()
    expect(myScreen([person({ username: 'nana', you: true, screen: 'simple', simpleActions: ['diaper'] })])).toEqual({ screen: 'simple', actions: ['diaper'] })
    expect(myScreen([person({ username: 'nana', screen: 'simple' }), person({ username: 'dad', you: true })])).toEqual({ screen: 'full', actions: ['bottle', 'diaper'] })
    expect(myScreen([])).toEqual({ screen: 'full', actions: ['bottle', 'diaper'] })
    // No buttons left is no simple screen: it would be a blank page.
    expect(myScreen([person({ you: true, screen: 'simple', simpleActions: [] })])?.screen).toBe('full')
  })
  it('remembers the answer per login on the phone', () => {
    writeCachedScreen('Nana', { screen: 'simple', actions: ['bottle'] })
    expect(readCachedScreen('nana')).toEqual({ screen: 'simple', actions: ['bottle'] })
    expect(readCachedScreen('dad')).toBeNull()
    localStorage.setItem('bramble.screen', '{bad')
    expect(readCachedScreen('nana')).toBeNull()
  })
  it('writes a diaper at the moment of the tap, nothing else to choose', () => {
    const now = new Date('2026-10-22T15:12:00')
    expect(diaperBody(3, 'pee', now)).toMatchObject({ child: 3, wet: true, solid: false, color: '', amount: null })
    expect(diaperBody(3, 'poop', now)).toMatchObject({ wet: false, solid: true })
    expect(diaperBody(3, 'both', now)).toMatchObject({ wet: true, solid: true })
  })
  it('says when in words', () => {
    const now = new Date(2026, 9, 22, 15, 12)
    expect(whenText(new Date(2026, 9, 22, 13, 5), now)).toBe('1:05 PM')
    expect(whenText(new Date(2026, 9, 21, 21, 40), now)).toBe('yesterday 9:40 PM')
    expect(agoText(new Date(2026, 9, 22, 15, 11), now)).toBe('just now')
    expect(agoText(new Date(2026, 9, 22, 14, 32), now)).toBe('40 minutes ago')
    expect(agoText(new Date(2026, 9, 22, 14, 2), now)).toBe('an hour ago')
    expect(agoText(new Date(2026, 9, 22, 12, 0), now)).toBe('3 hours ago')
  })
})
