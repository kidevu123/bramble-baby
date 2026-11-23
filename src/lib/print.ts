import type { PrintJob } from './api/companion'

/** How the label sheet colours a print job's answer: good news, still waiting / nothing known, or the printer needs a hand. */
export type PrintTone = 'good' | 'waiting' | 'problem'

const PROBLEM_STATES: ReadonlySet<PrintJob['state']> = new Set(['paper_out', 'head_open', 'paused', 'temperature'])

export function printJobTone(job: PrintJob): PrintTone {
  if (PROBLEM_STATES.has(job.state)) return 'problem'
  if (job.checking || job.state === 'busy') return 'waiting'
  if (job.state === 'no_answer') return 'problem' // final: the label probably printed, but nothing confirmed it
  return 'good'
}

/** "just now", "12 s ago", "3 min ago", "2 h ago": how long since the label was sent, for the Print again button. */
export function formatSince(from: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds} s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ago`
}

/**
 * Several labels to the server printer, one at a time and in order. `done` holds the keys already sent, so a tap
 * after a failure sends only the rest and nothing comes out twice (two stickers with one code would be two bags
 * claiming it). Stops at the first failure and throws it; returns how many of `items` have gone out in all.
 */
export async function printInOrder<T>(items: T[], keyOf: (item: T) => string, send: (item: T) => Promise<unknown>, done: Set<string>, onProgress?: (sent: number, of: number) => void): Promise<number> {
  let sent = items.filter((i) => done.has(keyOf(i))).length
  onProgress?.(sent, items.length)
  for (const item of items) {
    const key = keyOf(item)
    if (done.has(key)) continue
    await send(item)
    done.add(key)
    sent += 1
    onProgress?.(sent, items.length)
  }
  return sent
}

/** What to say when a run of labels stopped part-way: how many went out, and that another tap sends the rest. */
export function partlyPrinted(sent: number, of: number): string | null {
  if (sent <= 0 || sent >= of) return null
  return `${sent} of ${of} went to the printer. Tap again to send the other ${of - sent}; the ones already printed are not sent twice.`
}
