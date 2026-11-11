import type { Reminder } from './api/companion'

/** Milk reminders of one kind within this of each other are one row (the companion sends them as one push: MILK_TOGETHER). */
const TOGETHER_MS = 10 * 60_000
/** "<heading> · <volume> (<name>)", as server/milk.py writes a bag's or a premade bottle's reminder. */
const MILK_TITLE = /^(.+?) · (.+) \(([^()]+)\)$/

export interface InboxRow {
  /** The first reminder of the row: its id keys the row, its tag names the kind, its time is when the row is due. */
  first: Reminder
  title: string
  /** Which containers a merged row stands for; null on a row that is one reminder. */
  detail: string | null
  count: number
}

/** "2, 3, 4 and 5" */
const listed = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

/**
 * The Inbox's rows from the reminders, in the order given: a batch of premade bottles made together has a reminder
 * each at the same minute, twice over (expiring soon, expired), and eight near-identical rows bury everything else.
 * Milk reminders of one kind that fall together become one row, "Milk expiring soon · 4 premade bottles", with the
 * bottles named under it. Everything else is a row of its own.
 */
export function groupReminders(reminders: Reminder[]): InboxRow[] {
  const rows: (InboxRow & { head: string | null; names: string[]; volumes: string[]; at0: number })[] = []
  for (const r of reminders) {
    const m = r.tag.startsWith('milk:') ? MILK_TITLE.exec(r.title) : null
    const at = new Date(r.at).getTime()
    const open = m ? rows.find((g) => g.head === m[1] && g.first.child === r.child && g.first.sent === r.sent && Math.abs(at - g.at0) <= TOGETHER_MS) : undefined
    if (open && m) {
      open.count += 1
      open.volumes.push(m[2])
      open.names.push(m[3])
      continue
    }
    rows.push({ first: r, title: r.title, detail: null, count: 1, head: m ? m[1] : null, volumes: m ? [m[2]] : [], names: m ? [m[3]] : [], at0: at })
  }
  return rows.map(({ head, names, volumes, at0: _at0, ...row }) => {
    if (row.count < 2 || !head) return row
    const spots = names.map((n) => /^premade bottle (\d+)$/.exec(n)?.[1])
    const allBottles = spots.every(Boolean)
    const things = allBottles ? 'premade bottles' : spots.some(Boolean) ? 'containers' : 'bags'
    const which = allBottles ? `Bottles ${listed(spots as string[])}` : listed(names.map((n) => (n.startsWith('premade bottle ') ? n.replace('premade bottle', 'bottle') : n)))
    const same = volumes.every((v) => v === volumes[0])
    return { ...row, title: `${head} · ${row.count} ${things}`, detail: same ? `${which} · ${volumes[0]} each` : which }
  })
}
