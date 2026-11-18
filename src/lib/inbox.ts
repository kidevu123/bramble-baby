import type { Reminder } from './api/companion'

/** Milk reminders of one kind within this of each other are one row (the companion sends them as one push: MILK_TOGETHER). */
const TOGETHER_MS = 10 * 60_000
/** "<heading> · <volume> (<name>)", as server/milk.py writes a bag's or a premade bottle's reminder. */
const MILK_TITLE = /^(.+?) · (.+) \(([^()]+)\)$/

export interface InboxRow {
  /** The first reminder of the row: its id keys the row, its tag names the kind, its time is when the row is due. */
  first: Reminder
  /** Every reminder the row stands for (one, or a merged row's batch): what removing the row removes. */
  all: Reminder[]
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
      open.all.push(r)
      open.count += 1
      open.volumes.push(m[2])
      open.names.push(m[3])
      continue
    }
    rows.push({ first: r, all: [r], title: r.title, detail: null, count: 1, head: m ? m[1] : null, volumes: m ? [m[2]] : [], names: m ? [m[3]] : [], at0: at })
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

/** Upcoming rows due within this lead the Inbox; the rest (a freezer stash's use-by dates, months out) fold into one line. */
export const SOON_HOURS = 24

/**
 * The Inbox's Upcoming list in two parts: what is due in the next day, and everything later. A stash of forty bags
 * plans eighty use-by reminders, months ahead for the freezer; listed in full they bury the three that matter today.
 */
export function splitUpcoming(rows: InboxRow[], now: Date): { soon: InboxRow[]; later: InboxRow[]; laterNote: string } {
  const edge = now.getTime() + SOON_HOURS * 3_600_000
  const soon = rows.filter((r) => new Date(r.first.at).getTime() <= edge)
  const later = rows.filter((r) => new Date(r.first.at).getTime() > edge)
  const milk = later.filter((r) => r.first.tag.startsWith('milk:')).length
  const what = later.length === 0 ? '' : milk === later.length ? (milk === 1 ? 'a milk use-by date' : 'milk use-by dates') : milk > later.length / 2 ? 'mostly milk use-by dates' : ''
  return { soon, later, laterNote: later.length ? `${later.length} later${what ? ` · ${what}` : ''}` : '' }
}

/** What a removal names to the companion: each reminder by id, and by tag and moment in case its id has changed. */
export const skipItems = (rows: InboxRow[]) => rows.flatMap((row) => row.all.map((r) => ({ id: r.id, tag: r.tag, at: r.at })))

/** The question Clear asks before anything is dropped, naming what would not be sent. */
export function clearQuestion(rows: InboxRow[]): string {
  const n = rows.reduce((sum, r) => sum + r.count, 0)
  const milk = rows.filter((r) => r.first.tag.startsWith('milk:')).reduce((sum, r) => sum + r.count, 0)
  const lead = n === 1 ? 'Take this one off the list? It will not be sent.' : `Take these ${n} off the list? They will not be sent.`
  const milkLine = milk ? ` ${milk === n ? (n === 1 ? 'It is a milk use-by alert' : 'They are milk use-by alerts') : `${milk} of them ${milk === 1 ? 'is a milk use-by alert' : 'are milk use-by alerts'}`}: the Stash tab still shows what is due.` : ''
  return `${lead}${milkLine} New ones are planned as usual.`
}
