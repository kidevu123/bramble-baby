import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Sheet } from '../../components/ui/Sheet'
import { TrashIcon, BellIcon } from '../../components/icons'
import { ck, useInvalidateCompanion } from '../../hooks/useCompanionEvents'
import { companion } from '../../lib/api/companion'
import type { Child } from '../../lib/api/types'
import { Button } from '../../components/ui/Button'
import { clearQuestion, groupReminders, skipItems, splitUpcoming, type InboxRow } from '../../lib/inbox'
import { clearDeliveredNotifications, inboxClearedAt, markInboxCleared, recentlySent } from '../../lib/push'
import { formatWhen } from '../../lib/time'
import { NotificationStatus } from '../notifications/NotificationStatus'
import { useSaver } from '../log/useSaver'
import '../log/activity.css'

/** What each computed reminder kind is called in the list (server/nudges.py kinds). */
const NUDGE_LABEL: Record<string, string> = { feed: 'Feeding due', pump: 'Pump due', diaper: 'Diaper check', summary: 'Evening summary', weight: 'Hatch weight', supply: 'Pumping down', morning: 'Morning report', guide: 'What to expect' }

/** The envelope icon in the header: every upcoming reminder and alert for this child, in one place. */
export function InboxSheet({ open, child, onClose }: { open: boolean; child: Child; onClose: () => void }) {
  const invalidate = useInvalidateCompanion()
  const { run, busy, error } = useSaver(child.id, () => invalidate(child.id))
  // Always read afresh, and again while the sheet is open: the planners rewrite their rows (new ids, new moments),
  // and a list a quarter of a minute old had a trash that pointed at rows no longer there.
  const reminders = useQuery({ queryKey: ck.reminders(child.id), queryFn: () => companion.reminders.list(child.id).catch(() => []), enabled: open, staleTime: 0, refetchInterval: open ? 30_000 : false })
  const [clearedAt, setClearedAt] = useState(inboxClearedAt)
  const [showLater, setShowLater] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // Milk reminders that fall together are one row (a batch of premade bottles has a reminder each at the same minute).
  const upcoming = groupReminders((reminders.data ?? []).filter((r) => !r.sent).sort((a, b) => a.at.localeCompare(b.at)))
  // The next day leads; a stash's use-by dates weeks and months out are one line, a tap away.
  const { soon, later, laterNote } = splitUpcoming(upcoming, new Date())
  const shownUpcoming = showLater ? upcoming : soon
  // Remove (one row) and Clear (the rows listed): they leave the plan and are never sent. Named by id and by tag and
  // moment, so a row re-planned under a new id since the list was read is still found. A failure reads the list again.
  const remove = (rows: InboxRow[]) =>
    run(() =>
      companion.reminders.skip(child.id, skipItems(rows)).catch((err: unknown) => {
        invalidate(child.id)
        throw err
      }),
    ).then(() => setConfirming(false))
  const recent = groupReminders(recentlySent(reminders.data ?? [], clearedAt, 40)).slice(0, 10)
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
  return (
    <Sheet open={open} title="Notifications" onClose={onClose}>
      <NotificationStatus child={child.id} />
      <section className="stack">
        <div className="inbox-head">
          <h3>Upcoming</h3>
          {shownUpcoming.length && !confirming ? (
            <button type="button" className="link-btn" data-testid="inbox-clear" disabled={busy} onClick={() => setConfirming(true)}>
              Clear
            </button>
          ) : null}
        </div>
        {upcoming.length === 0 ? <p className="small muted">Nothing scheduled. Nap window alerts appear here automatically once a sleep is logged; tap the alarm on any tile to add a reminder.</p> : null}
        {upcoming.length > 0 && shownUpcoming.length === 0 ? <p className="small muted">Nothing in the next 24 hours.</p> : null}
        {confirming && shownUpcoming.length ? (
          <div className="stack inbox-confirm" data-testid="inbox-confirm">
            <p className="small">{clearQuestion(shownUpcoming)}</p>
            <div className="row gap">
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
                Keep them
              </Button>
              <Button onClick={() => remove(shownUpcoming)} loading={busy}>
                Take them off
              </Button>
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="log-error" role="alert">
            {error}
          </p>
        ) : null}
        <ul className="reminder-list">
          {shownUpcoming.map((row) => (
            <li key={row.first.id} className="reminder-item">
              <span className="icon-circle sm tone-sleep">
                <BellIcon />
              </span>
              <span className="grow">
                <span className="strong">{row.title}</span>
                {row.detail ? (
                  <span className="xs" style={{ display: 'block' }} data-testid="inbox-detail">
                    {row.detail}
                  </span>
                ) : null}
                <span className="xs muted" style={{ display: 'block' }}>
                  {label(row.first)} · {formatWhen(row.first.at)}
                </span>
              </span>
              <button type="button" className="sheet-icon-btn" aria-label={`Remove: ${row.title}`} disabled={busy} onClick={() => remove([row])}>
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
        {later.length ? (
          <button type="button" className="link-btn" data-testid="inbox-more" onClick={() => setShowLater(!showLater)}>
            {showLater ? 'Show only the next 24 hours' : `${laterNote} · Show`}
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
            {recent.map((row) => (
              <li key={row.first.id} className="reminder-item" style={{ opacity: 0.7 }}>
                <span className="grow">
                  <span className="strong">{row.title}</span>
                  {row.detail ? (
                    <span className="xs" style={{ display: 'block' }}>
                      {row.detail}
                    </span>
                  ) : null}
                  <span className="xs muted" style={{ display: 'block' }}>
                    {formatWhen(row.first.at)}
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
