import { describe, expect, it } from 'vitest'
import { clearDeliveredNotifications, inboxClearedAt, markInboxCleared, pushSupport, recentlySent } from './push'

describe('pushSupport', () => {
  it('reports insecure contexts', () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    expect(pushSupport()).toBe('insecure')
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  })
  it('reports unsupported when PushManager is missing', () => {
    expect(['unsupported', 'ok', 'ios-needs-install']).toContain(pushSupport())
  })
})

describe('clearing old notifications', () => {
  it('takes every delivered notification off the phone\u2019s list, and says how many', async () => {
    const closed: string[] = []
    const shown = ['nudge:feed:3', 'nudge:activity:bottle:12:8', 'milk:4'].map((tag) => ({ tag, close: () => closed.push(tag) }))
    Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: async () => ({ getNotifications: async () => shown }) }, configurable: true })
    expect(await clearDeliveredNotifications()).toBe(3)
    expect(closed).toEqual(['nudge:feed:3', 'nudge:activity:bottle:12:8', 'milk:4'])
    // A browser that cannot list them (or no service worker yet): nothing closed, nothing thrown.
    Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: async () => ({}) }, configurable: true })
    expect(await clearDeliveredNotifications()).toBe(0)
    Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: async () => { throw new Error('no') } }, configurable: true })
    expect(await clearDeliveredNotifications()).toBe(0)
  })

  it('the Inbox shows what was sent since the last Clear, newest first', () => {
    localStorage.clear()
    const sent = [
      { id: 1, at: '2026-11-11T08:00:00Z', sent: true },
      { id: 2, at: '2026-11-11T12:00:00Z', sent: true },
      { id: 3, at: '2026-11-11T18:00:00Z', sent: false }, // still to come: never under "sent"
      { id: 4, at: '2026-11-11T14:00:00Z', sent: true },
    ]
    expect(inboxClearedAt()).toBe('')
    expect(recentlySent(sent, inboxClearedAt()).map((r) => r.id)).toEqual([4, 2, 1])
    const at = markInboxCleared(new Date('2026-11-11T13:00:00Z'))
    expect(inboxClearedAt()).toBe(at)
    expect(recentlySent(sent, at).map((r) => r.id)).toEqual([4])
    expect(recentlySent(sent, '', 2).map((r) => r.id)).toEqual([4, 2])
  })
})
