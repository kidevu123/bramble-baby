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
