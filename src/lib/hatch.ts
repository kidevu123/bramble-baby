/**
 * Wording and state for Settings › Hatch scale. The companion (server/hatch.py) does the work; this
 * turns its status into the one screen the sheet shows and the few words the Settings row shows.
 */
import { ApiError, describeApiError } from './api/client'
import type { HatchBaby, HatchProblemCode, HatchStatus } from './api/companion'
import { formatAgo } from './time'

export type HatchView = 'loading' | 'signin' | 'signin-again' | 'choose' | 'connected'

/** Babies the owner has not answered for yet. `child: 0` ("do not import") is an answer. */
export const unmappedBabies = (status: HatchStatus): HatchBaby[] => status.babies.filter((b) => b.child === null)

export function hatchView(status: HatchStatus | undefined): HatchView {
  if (!status) return 'loading'
  if (!status.connected) return 'signin'
  if (status.needsLogin) return 'signin-again'
  return unmappedBabies(status).length ? 'choose' : 'connected'
}

/** Problems that clear up on their own (the companion retries) versus ones that need a person. */
const PASSING: HatchProblemCode[] = ['hatch_unreachable', 'rate_limited', 'babybuddy', 'babybuddy_auth']

export const problemTone = (code: HatchProblemCode): 'warn' | 'error' => (PASSING.includes(code) ? 'warn' : 'error')

const weights = (n: number): string => `${n} weight${n === 1 ? '' : 's'}`

export function hatchTotals(status: HatchStatus): string[] {
  const parts = [status.imported ? `${weights(status.imported)} imported` : 'No weights imported yet']
  if (status.matched) parts.push(`${status.matched} already in Bramble`)
  if (status.pending) parts.push(`${status.pending} waiting`)
  return parts
}

/** The value line of the Settings row. */
export function hatchRowSummary(status: HatchStatus | undefined, now: Date = new Date()): string {
  const view = hatchView(status)
  if (!status || view === 'loading') return 'Weights from the Hatch Grow scale'
  if (view === 'signin') return 'Not connected'
  if (view === 'signin-again') return 'Sign in again'
  if (view === 'choose') return 'Choose which child'
  if (status.problem && problemTone(status.problem.code) === 'error') return 'Needs attention'
  if (status.syncing) return 'Checking Hatch…'
  if (!status.imported) return 'Connected · no weights yet'
  return `${weights(status.imported)} imported${status.lastSuccess ? ` · checked ${formatAgo(status.lastSuccess, now)}` : ''}`
}

/** A failed Hatch call in words. The companion writes its own sentences for everything it expects. */
export function hatchErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = err.body && typeof err.body === 'object' ? (err.body as { detail?: unknown }).detail : null
    // A companion from before this feature answers 404 (or the SPA's HTML) for /hatch.
    if (err.status === 404 || err.status === 502) return 'The Bramble server needs updating before it can talk to Hatch. Deploy the latest version, then try again.'
    if (typeof detail === 'string' && detail && err.status !== 401 && err.status !== 403) return detail
  }
  return describeApiError(err)
}
