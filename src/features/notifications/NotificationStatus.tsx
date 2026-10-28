import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { BellIcon, CheckIcon, CloseIcon } from '../../components/icons'
import { describeApiError } from '../../lib/api/client'
import { useNotifications, type PushState } from './useNotifications'
import './notifications.css'

const EXPLAIN: Record<string, string> = {
  insecure: 'Notifications need HTTPS. Open the app from its https:// address.',
  unsupported: 'This browser does not support web push notifications.',
  'ios-needs-install': 'On iPhone, add Bramble to your Home Screen (Share → Add to Home Screen), then open it from there to enable notifications.',
  denied: 'Notifications are blocked for this site. Allow them in your browser settings (iPhone: Settings → Notifications → Bramble), then try again.',
  'server-push-unconfigured': 'The companion server has no push keys yet. Re-run the deploy so it installs pywebpush, then check Settings → Notification checks.',
  'sw-timeout': 'The app’s background worker did not start. Close the app fully, reopen it and try again.',
}

/**
 * Enable/disable push with plain-language guidance. Used in Settings, the inbox, the child's settings and
 * (compact) the reminder sheet. One slim box: the state in a line, then its buttons in a row with the
 * "Notification checks" link beside them.
 */
export function NotificationStatus({ child, compact }: { child: number | null; compact?: boolean }) {
  const { state, enableFromTap, enable, disable, test } = useNotifications(child)
  const [showChecks, setShowChecks] = useState(false)
  if (!state) return null

  const blocked = state.support !== 'ok' || state.permission === 'denied'
  const reason = state.permission === 'denied' ? EXPLAIN.denied : EXPLAIN[state.support]
  const on = state.subscribed && state.permission === 'granted'
  const serverProblem = state.serverReachable === false ? 'The companion service is not reachable, so nothing can be delivered.' : state.serverPush === false ? `The server cannot send pushes yet${state.health?.problem ? ` (${state.health.problem})` : ''}.` : state.registered === false ? 'This device is not registered on the server. Turn notifications off and on again.' : null

  const checksToggle = (
    <button type="button" className="notif-link" onClick={() => setShowChecks((v) => !v)} aria-expanded={showChecks}>
      {showChecks ? 'Hide checks' : 'Notification checks'}
    </button>
  )

  if (on) {
    if (compact && !serverProblem) return null
    return (
      <div className="notif-wrap">
        <div className={`notif-box ${serverProblem ? 'warn' : 'on'}`}>
          <span className="notif-icon">
            <BellIcon />
          </span>
          <span className="notif-text">
            <span className="strong">{serverProblem ? 'Notifications need attention' : 'Notifications are on'}</span>
            <span className="small muted">{serverProblem ?? `Reminders reach this phone via ${state.provider ?? 'web push'}.`}</span>
            <TestResult test={test} />
          </span>
          <div className="notif-actions">
            <Button variant="secondary" onClick={() => test.mutate()} loading={test.isPending}>
              Test
            </Button>
            <Button variant="ghost" onClick={() => disable.mutate()} loading={disable.isPending}>
              Off
            </Button>
            {checksToggle}
          </div>
        </div>
        {showChecks ? <Checks state={state} /> : null}
      </div>
    )
  }

  return (
    <div className="notif-wrap">
      <div className="notif-box">
        <span className="notif-icon">
          <BellIcon />
        </span>
        <span className="notif-text">
          <span className="strong">{blocked ? 'Notifications unavailable here' : 'Turn on notifications'}</span>
          <span className="small muted">{blocked ? reason : 'A heads-up before the nap window and for reminders. Each caregiver turns this on once, on their own phone.'}</span>
          {enable.isError ? <span className="small text-health">{EXPLAIN[(enable.error as Error).message] ?? describeApiError(enable.error)}</span> : null}
        </span>
        {!blocked || !compact ? (
          <div className="notif-actions">
            {!blocked ? (
              <Button onClick={enableFromTap} loading={enable.isPending}>
                Enable
              </Button>
            ) : null}
            {!compact ? checksToggle : null}
          </div>
        ) : null}
      </div>
      {!compact && showChecks ? <Checks state={state} /> : null}
    </div>
  )
}

function TestResult({ test }: { test: ReturnType<typeof useNotifications>['test'] }) {
  if (test.isError) {
    return <span className="small text-health">Test failed: {describeApiError(test.error)}</span>
  }
  if (!test.isSuccess) return null
  const r = test.data
  if (r.sent > 0) {
    return (
      <span className="small text-growth">
        Sent to {r.sent} of {r.subscriptions} device{r.subscriptions === 1 ? '' : 's'}. If nothing appeared, check the phone’s notification settings for Bramble.
      </span>
    )
  }
  return (
    <span className="small text-health">
      Nothing was sent ({r.subscriptions} registered device{r.subscriptions === 1 ? '' : 's'}). {r.errors[0] ?? (r.push ? 'The push service rejected it.' : 'Server push is not configured.')}
    </span>
  )
}

/** Each link in the chain, pass/fail, so "notifications don't work" becomes one concrete step. */
function Checks({ state }: { state: PushState }) {
  const rows: { label: string; ok: boolean | null; note?: string }[] = [
    { label: 'Secure (https) page', ok: state.support !== 'insecure' },
    { label: 'Opened from the Home Screen (iPhone)', ok: state.support !== 'ios-needs-install', note: state.support === 'ios-needs-install' ? 'Required on iOS' : undefined },
    { label: 'Browser supports web push', ok: state.support !== 'unsupported' },
    { label: 'Permission granted', ok: state.permission === 'granted' ? true : state.permission === 'denied' ? false : null, note: state.permission === 'default' ? 'Not asked yet' : undefined },
    { label: 'Subscribed on this device', ok: state.subscribed, note: state.provider ? `via ${state.provider}` : undefined },
    { label: 'Companion service reachable', ok: state.serverReachable },
    {
      label: 'Server can send (VAPID keys + pywebpush)',
      ok: state.serverPush,
      note: state.health?.problem ?? (state.health?.webpush === false ? 'pywebpush missing' : state.health?.vapid === false ? 'no keys' : undefined),
    },
    { label: 'This device registered on the server', ok: state.registered, note: state.health?.subscriptions !== undefined ? `${state.health.subscriptions} device(s) total` : undefined },
  ]
  return (
    <ul className="notif-checks">
      {rows.map((r) => (
        <li key={r.label} className={r.ok === true ? 'ok' : r.ok === false ? 'fail' : 'unknown'}>
          <span className="notif-check-icon">{r.ok === true ? <CheckIcon /> : r.ok === false ? <CloseIcon /> : '·'}</span>
          <span className="grow">
            {r.label}
            {r.note ? <span className="xs muted"> · {r.note}</span> : null}
          </span>
        </li>
      ))}
      {state.health?.lastPushError ? (
        <li className="fail">
          <span className="notif-check-icon">
            <CloseIcon />
          </span>
          <span className="grow xs">Last server push error: {state.health.lastPushError}</span>
        </li>
      ) : null}
    </ul>
  )
}
