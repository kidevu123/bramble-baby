import { useQuery } from '@tanstack/react-query'
import { Sheet } from '../../components/ui/Sheet'
import { TrashIcon, BellIcon } from '../../components/icons'
import { ck, useInvalidateCompanion } from '../../hooks/useCompanionEvents'
import { companion } from '../../lib/api/companion'
import type { Child } from '../../lib/api/types'
import { formatWhen } from '../../lib/time'
import { NotificationStatus } from '../notifications/NotificationStatus'
import { useSaver } from '../log/useSaver'
import '../log/activity.css'

/** What each computed reminder kind is called in the list (server/nudges.py kinds). */
const NUDGE_LABEL: Record<string, string> = { feed: 'Feeding due', pump: 'Pump due', diaper: 'Diaper check', summary: 'Evening summary', weight: 'Hatch weight', supply: 'Pumping down' }

/** The envelope icon in the header: every upcoming reminder and alert for this child, in one place. */
export function InboxSheet({ open, child, onClose }: { open: boolean; child: Child; onClose: () => void }) {
  const invalidate = useInvalidateCompanion()
  const { run, busy } = useSaver(child.id, () => invalidate(child.id))
  const reminders = useQuery({ queryKey: ck.reminders(child.id), queryFn: () => companion.reminders.list(child.id).catch(() => []), enabled: open })
  const upcoming = (reminders.data ?? []).filter((r) => !r.sent).sort((a, b) => a.at.localeCompare(b.at))
  const recent = (reminders.data ?? []).filter((r) => r.sent).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10)
  const label = (r: { tag: string; title: string }) => {
    const tag = r.tag
    if (tag.startsWith('sweetspot')) return 'Nap window'
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
          {upcoming.map((r) => (
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
      </section>
      {recent.length ? (
        <section className="stack">
          <h3>Recently sent</h3>
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
