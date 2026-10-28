/**
 * What the phone says while a label prints on its own (after a pumping is saved): a small store any
 * screen can show, because the sheet that triggered the print has already closed and the timer page has
 * already left. One notice at a time; a new print replaces the last.
 */
import type { PrintJob } from './api/companion'

export type PrintNoticeState = 'sending' | 'sent' | 'failed'

export interface PrintNotice {
  id: number
  at: Date
  state: PrintNoticeState
  /** "60 mL", for the line. */
  volumeText: string
  bagCode: string | null
  /** The printer's own answer, once it has one. */
  job: PrintJob | null
  /** Why it did not go, in the server's words. */
  error: string | null
}

type Listener = (notice: PrintNotice | null) => void

let current: PrintNotice | null = null
let seq = 0
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l(current)
}

export function currentPrintNotice(): PrintNotice | null {
  return current
}

export function subscribePrintNotice(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** A print has started: the notice shows at once, before the bag exists. */
export function beginPrintNotice(volumeText: string): number {
  current = { id: ++seq, at: new Date(), state: 'sending', volumeText, bagCode: null, job: null, error: null }
  emit()
  return current.id
}

/** Only the print that is still current may change the notice: a later print has replaced an earlier one. */
export function updatePrintNotice(id: number, patch: Partial<Omit<PrintNotice, 'id' | 'at'>>) {
  if (!current || current.id !== id) return
  current = { ...current, ...patch }
  emit()
}

export function dismissPrintNotice(id?: number) {
  if (id !== undefined && current?.id !== id) return
  current = null
  emit()
}

/** Test support: forget everything. */
export function resetPrintNotices() {
  current = null
  seq = 0
  listeners.clear()
}
