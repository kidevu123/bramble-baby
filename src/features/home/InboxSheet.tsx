import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Sheet } from '../../components/ui/Sheet'
import { TrashIcon, BellIcon } from '../../components/icons'
import { ck, useInvalidateCompanion } from '../../hooks/useCompanionEvents'
import { companion } from '../../lib/api/companion'
import type { Child } from '../../lib/api/types'
import { clearDeliveredNotifications, inboxClearedAt, markInboxCleared, recentlySent } from '../../lib/push'
import { formatWhen } from '../../lib/time'
import { NotificationStatus } from '../notifications/NotificationStatus'
import { useSaver } from '../log/useSaver'
import '../log/activity.css'

/** What each computed reminder kind is called in the list (server/nudges.py kinds). */
const NUDGE_LABEL: Record<string, string> = { feed: 'Feeding due', pump: 'Pump due', diaper: 'Diaper check', summary: 'Evening summary', weight: 'Hatch weight', supply: 'Pumping down', morning: 'Morning report', guide: 'What to expect' }

/** How many upcoming reminders lead the list before "Show N more". */
const UPCOMING_PREVIEW = 5

/** The envelope icon in the header: every upcoming reminder and alert for this child, in one place. */
export function InboxSheet({ open, child, onClose }: { open: boolean; child: Child; onClose: () => void }) {
  const invalidate = useInvalidateCompanion()
  const { run, busy } = useSaver(child.id, () => invalidate(child.id))
  const reminders = useQuery({ queryKey: ck.reminders(child.id), queryFn: () => companion.reminders.list(child.id).catch(() => []), enabled: open })
  const [clearedAt, setClearedAt] = useState(inboxClearedAt)
  const [allUpcoming, setAllUpcoming] = useState(false)
  const upcoming = (reminders.data ?? []).filter((r) => !r.sent).sort((a, b) => a.at.localeCompare(b.at))
  // A stash of twenty bags plans forty expiry reminders: the next few lead, the rest are a tap away.
  const shownUpcoming = allUpcoming || upcoming.length <= UPCOMING_PREVIEW + 1 ? upcoming : upcoming.slice(0, UPCOMING_PREVIEW)
  const recent = recentlySent(reminders.data ?? [], clearedAt)
  // Clear: this phone's list of what was sent, and Bramble's notifications still on its lock screen. The server
  // keeps its record of what went out (it is what stops a note from being sent twice).
  const clear = () => {
    setClearedAt(markInboxCleared())
    void clearDeliveredNotifications()
  }
  const label = (r: { tag: string; title: string }) => {
    const tag = r.tag
    if (tag.startsWith('nap')) return 'Nap window'
    if (tag === 'nudge:activity') {
      // "Dad logged a bottle" → "Logged by Dad"
      const who = /^(.+?) logged\b/.exec(r.title)?.[1]
      return who ? `Logged by ${who}` : 'Caregiver ping'
    }
    if (tag.startsWith('nudge:')) return NUDGE_LABEL[tag.slice(6)] ?? 'Reminder'
    if (tag.startsWith('milk:')) return 'Milk'
    if (tag.startsWith('reminder:') && tag.length > 9) return tag.slice(9)[0].toUpperCase() + tag.slice(10)
    return 'Reminder'
  }
  // Computed reminders are re-planned on every server poll; they are switched off in Settings › Notifications, not deleted here.
  const computed = (tag: string) => tag.startsWith('nudge:') || tag.startsWith('milk:')

  return (
    <Sheet open={open} title="Notifications" onClose={onClose}>
      <NotificationStatus child={child.id} />
      <section className="stack">
        <h3>Upcoming</h3>
        {upcoming.length === 0 ? <p className="small muted">Nothing scheduled. Nap window alerts appear here automatically once a sleep is logged; tap the alarm on any tile to add a reminder.</p> : null}
        <ul className="reminder-list">
          {shownUpcoming.map((r) => (
            <li key={r.id} className="reminder-item">
              <span className="icon-circle sm tone-sleep">
                <BellIcon />
              </span>
              <span className="grow">
                <span className="strong">{r.title}</span>
                <span className="xs muted" style={{ display: 'block' }}>
                  {label(r)} · {formatWhen(r.at)}
                </span>
              </span>
              {computed(r.tag) ? null : (
                <button type="button" className="sheet-icon-btn" aria-label="Delete" disabled={busy} onClick={() => run(() => companion.reminders.remove(r.id))}>
                  <TrashIcon />
                </button>
              )}
            </li>
          ))}
        </ul>
        {upcoming.length > shownUpcoming.length ? (
          <button type="button" className="link-btn" data-testid="inbox-more" onClick={() => setAllUpcoming(true)}>
            Show {upcoming.length - shownUpcoming.length} more
          </button>
        ) : null}
      </section>
      {recent.length ? (
        <section className="stack" data-testid="inbox-sent">
          <div className="inbox-head">
            <h3>Recently sent</h3>
            <button type="button" className="link-btn" onClick={clear}>
              Clear
            </button>
          </div>
          <ul className="reminder-list">
            {recent.map((r) => (
              <li key={r.id} className="reminder-item" style={{ opacity: 0.7 }}>
                <span className="grow">
                  <span className="strong">{r.title}</span>
                  <span className="xs muted" style={{ display: 'block' }}>
                    {formatWhen(r.at)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Sheet>
  )
}
