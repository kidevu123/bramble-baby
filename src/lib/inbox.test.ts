import { describe, expect, it } from 'vitest'
import type { Reminder } from './api/companion'
import { groupReminders } from './inbox'

let id = 0
const rem = (title: string, at: string, tag: string, over: Partial<Reminder> = {}): Reminder => ({ id: ++id, child: 1, at, title, body: '', tag, sent: false, ...over })

describe('the Inbox groups milk reminders that fall together', () => {
  it('four premade bottles made together are one row for "expiring soon" and one for "expired"', () => {
    // The owner's Inbox (2026-11-11): bottles 2 to 5, each with two reminders, among a nap alert and a diaper check.
    const rows = groupReminders([
      rem('Nap window now · 12:47 AM', '2026-11-11T05:47:00Z', 'nap:now'),
      rem('No wet diaper in 7 h', '2026-11-11T10:02:00Z', 'nudge:diaper'),
      ...[2, 3, 4, 5].map((n) => rem(`Milk expiring soon · 71 mL (2.4 oz) (premade bottle ${n})`, '2026-11-11T14:16:00Z', `milk:${n}`)),
      ...[2, 3, 4, 5].map((n) => rem(`Milk expired · 71 mL (2.4 oz) (premade bottle ${n})`, '2026-11-12T02:16:00Z', `milk:${n}`)),
    ])
    expect(rows.map((r) => [r.title, r.detail, r.count])).toEqual([
      ['Nap window now · 12:47 AM', null, 1],
      ['No wet diaper in 7 h', null, 1],
      ['Milk expiring soon · 4 premade bottles', 'Bottles 2, 3, 4 and 5 · 71 mL (2.4 oz) each', 4],
      ['Milk expired · 4 premade bottles', 'Bottles 2, 3, 4 and 5 · 71 mL (2.4 oz) each', 4],
    ])
    expect(rows[2].first.tag).toBe('milk:2')
  })

  it('only what falls within ten minutes of each other, of one kind, for one child, sent or not', () => {
    const a = rem('Milk expiring soon · 60 mL (2.0 oz) (J23PFX)', '2026-11-11T14:00:00Z', 'milk:1')
    const rows = groupReminders([
      a,
      rem('Milk expiring soon · 90 mL (3.0 oz) (K7WQ2M)', '2026-11-11T14:08:00Z', 'milk:2'),
      rem('Milk expiring soon · 80 mL (2.7 oz) (premade bottle 1)', '2026-11-11T14:09:00Z', 'milk:3'),
      rem('Milk expiring soon · 50 mL (1.7 oz) (ABC234)', '2026-11-11T15:30:00Z', 'milk:4'), // an hour and a half later
      rem('Milk expiring soon · 50 mL (1.7 oz) (XYZ789)', '2026-11-11T14:05:00Z', 'milk:5', { child: 2 }), // another child
      rem('Milk expiring soon · 50 mL (1.7 oz) (QRS456)', '2026-11-11T14:05:00Z', 'milk:6', { sent: true }), // already sent
    ])
    expect(rows.map((r) => [r.title, r.detail])).toEqual([
      ['Milk expiring soon · 3 containers', 'J23PFX, K7WQ2M and bottle 1'],
      ['Milk expiring soon · 50 mL (1.7 oz) (ABC234)', null],
      ['Milk expiring soon · 50 mL (1.7 oz) (XYZ789)', null],
      ['Milk expiring soon · 50 mL (1.7 oz) (QRS456)', null],
    ])
    // Two bags alone are "bags"; a reminder that only looks like milk (a hand-made one) is left alone.
    expect(groupReminders([rem('Milk expired · 60 mL (2.0 oz) (J23PFX)', a.at, 'milk:1'), rem('Milk expired · 30 mL (1.0 oz) (ABC234)', a.at, 'milk:2')])[0].title).toBe('Milk expired · 2 bags')
    expect(groupReminders([rem('Milk expired · 60 mL (2.0 oz) (J23PFX)', a.at, 'reminder:bottle'), rem('Milk expired · 30 mL (1.0 oz) (ABC234)', a.at, 'reminder:bottle')])).toHaveLength(2)
    expect(groupReminders([])).toEqual([])
  })
})
