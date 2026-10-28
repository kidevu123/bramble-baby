import { useRef, useState, type FormEvent } from 'react'
import { CheckIcon, ScaleIcon } from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Field'
import { Sheet } from '../../components/ui/Sheet'
import { useChildren } from '../../hooks/useChildren'
import { useHatch } from '../../hooks/useHatch'
import type { HatchStatus } from '../../lib/api/companion'
import type { Child } from '../../lib/api/types'
import { hatchErrorText, hatchTotals, hatchView, problemTone } from '../../lib/hatch'
import { formatAgo } from '../../lib/time'
import { useAutofocus } from './useAutofocus'
import './connection.css'

type Hatch = ReturnType<typeof useHatch>

/**
 * Settings › Hatch scale. Sign in to the Hatch account once; the Bramble server then brings every
 * weighing from the Hatch Grow into the child's weights. Everything about the connection lives here:
 * which baby, when it last checked, how many weights came in, Sync now, Disconnect, and one
 * plain-language line when something is wrong.
 */
export function HatchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const hatch = useHatch(open)
  const { children } = useChildren()
  const view = hatchView(hatch.status)
  return (
    <Sheet open={open} title="Hatch scale" onClose={onClose}>
      <div className="stack conn-sheet" data-hatch-view={view}>
        {view === 'loading' ? <Unavailable hatch={hatch} /> : null}
        {view === 'signin' ? <SignIn hatch={hatch} childName={children.length === 1 ? children[0].first_name : null} /> : null}
        {hatch.status && view !== 'loading' && view !== 'signin' ? <Connected hatch={hatch} status={hatch.status} view={view} kids={children} /> : null}
      </div>
    </Sheet>
  )
}

function Band({ tone, title, line }: { tone: 'idle' | 'on' | 'warn' | 'error'; title: string; line: string }) {
  return (
    <div className={`conn-band ${tone}`}>
      <span className="conn-band-icon">
        <ScaleIcon />
      </span>
      <span className="grow">
        <span className="conn-band-title">{title}</span>
        <span className="small conn-band-line">{line}</span>
      </span>
    </div>
  )
}

function Unavailable({ hatch }: { hatch: Hatch }) {
  if (hatch.error) {
    return (
      <>
        <Band tone="error" title="Hatch is not available" line="Bramble could not ask its server about the Hatch connection." />
        <p className="small conn-error" role="alert">
          {hatchErrorText(hatch.error)}
        </p>
      </>
    )
  }
  return <p className="small muted">Checking the Hatch connection…</p>
}

/** Email + password, used for the first sign-in and again when Hatch ends the session. */
function SignInForm({ hatch, email: knownEmail, submitLabel }: { hatch: Hatch; email?: string | null; submitLabel: string }) {
  const [email, setEmail] = useState(knownEmail ?? '')
  const [password, setPassword] = useState('')
  const canSubmit = email.includes('@') && password.length > 0 && !hatch.connect.isPending
  const formRef = useRef<HTMLFormElement>(null)
  useAutofocus(formRef)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    hatch.connect.mutate({ email: email.trim(), password }, { onSuccess: () => setPassword('') })
  }
  return (
    <form ref={formRef} className="stack conn-form" onSubmit={submit} noValidate>
      <TextField label="Hatch email" type="email" name="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus={knownEmail ? undefined : ''} aria-invalid={hatch.connect.isError || undefined} />
      <TextField label="Hatch password" type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-autofocus={knownEmail ? '' : undefined} aria-invalid={hatch.connect.isError || undefined} />
      {hatch.connect.isError ? (
        <p className="small conn-error" role="alert">
          {hatchErrorText(hatch.connect.error)}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" block disabled={!canSubmit} loading={hatch.connect.isPending}>
        {submitLabel}
      </Button>
      <p className="xs muted">Your password goes to your own Bramble server once, to sign in to Hatch, and is not kept. The server keeps only the session Hatch hands back. An unofficial connection: Bramble is not made by or affiliated with Hatch.</p>
    </form>
  )
}

function SignIn({ hatch, childName }: { hatch: Hatch; childName: string | null }) {
  return (
    <>
      <Band tone="idle" title="Weights from the Hatch Grow" line="Not connected yet" />
      <p className="small muted">
        Sign in to your Hatch account once. After that, every weighing on the changing pad shows up in {childName ? `${childName}’s` : 'your child’s'} weights on its own, a few minutes after the Hatch app has it.
      </p>
      <SignInForm hatch={hatch} submitLabel="Sign in to Hatch" />
    </>
  )
}

function Connected({ hatch, status, view, kids }: { hatch: Hatch; status: HatchStatus; view: 'signin-again' | 'choose' | 'connected'; kids: Child[] }) {
  const [confirming, setConfirming] = useState(false)
  const problem = status.problem && status.problem.code !== 'needs_login' ? status.problem : null
  const tone = view === 'signin-again' ? 'warn' : problem && problemTone(problem.code) === 'error' ? 'error' : view === 'choose' ? 'idle' : 'on'
  const title = view === 'signin-again' ? 'Hatch signed Bramble out' : view === 'choose' ? 'Signed in to Hatch' : tone === 'error' ? 'Connected, but not importing' : 'Connected'
  const busy = status.syncing || hatch.sync.isPending
  // With a problem showing, "last checked" would read as "all fine": say when it last worked instead.
  const checked = !status.lastSuccess ? 'Not checked yet' : problem ? `Last worked ${formatAgo(status.lastSuccess)}` : `Checked ${formatAgo(status.lastSuccess)}`
  const actionError = hatch.sync.error ?? hatch.disconnect.error ?? hatch.mapBabies.error

  return (
    <>
      <Band tone={tone} title={title} line={status.email ?? 'Hatch account'} />

      {view === 'signin-again' ? (
        <>
          <p className="small">Sign in again to keep weights coming. Nothing already imported is lost, and nothing will be imported twice.</p>
          <SignInForm hatch={hatch} email={status.email} submitLabel="Sign in again" />
        </>
      ) : null}

      {view !== 'signin-again' ? <Babies hatch={hatch} status={status} kids={kids} choosing={view === 'choose'} /> : null}

      {view !== 'choose' ? (
        <ul className="conn-stats" aria-label="Imported so far">
          {hatchTotals(status).map((line) => {
            const [count, ...rest] = line.split(' ')
            const numeric = /^\d+$/.test(count)
            return (
              <li key={line} className="conn-stat">
                {numeric ? <span className="conn-stat-n">{count}</span> : null}
                <span className="conn-stat-label">{numeric ? rest.join(' ') : line}</span>
              </li>
            )
          })}
        </ul>
      ) : null}

      {problem ? <Problem status={status} /> : null}

      {view === 'connected' ? (
        <div className="conn-sync">
          <p className="xs muted conn-checked" aria-live="polite">
            {busy ? 'Checking Hatch…' : `${checked} · every\u00a0${status.pollMinutes}\u00a0min`}
          </p>
          <Button variant="secondary" onClick={() => hatch.sync.mutate()} loading={busy} disabled={busy}>
            Sync now
          </Button>
        </div>
      ) : null}

      {actionError ? (
        <p className="small conn-error" role="alert">
          {hatchErrorText(actionError)}
        </p>
      ) : null}

      {view === 'connected' && !problem ? (
        <p className="xs muted">Each weighing becomes a weight entry marked “Hatch Grow scale” with the time it was taken. Days where a weight was already typed in by hand were left as they are.</p>
      ) : null}

      {status.report ? <Report text={status.report} open={Boolean(problem && problemTone(problem.code) === 'error')} /> : null}

      <div className="conn-disconnect">
        {confirming ? (
          <div className="conn-confirm" role="group" aria-label="Disconnect Hatch">
            <p className="small">Disconnect Hatch? Bramble forgets the Hatch sign-in. Weights already imported stay.</p>
            <div className="row">
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Keep
              </Button>
              <Button variant="danger" onClick={() => hatch.disconnect.mutate(undefined, { onSettled: () => setConfirming(false) })} loading={hatch.disconnect.isPending}>
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" className="conn-disconnect-btn" onClick={() => setConfirming(true)}>
            Disconnect
          </Button>
        )}
      </div>
    </>
  )
}

/** Which Bramble child each Hatch baby feeds. One baby and one child needs no question. */
function Babies({ hatch, status, kids, choosing }: { hatch: Hatch; status: HatchStatus; kids: Child[]; choosing: boolean }) {
  if (!status.babies.length) return <p className="small muted">This Hatch account has no baby yet. Add one in the Hatch app, then sign in here again.</p>
  const simple = status.babies.length === 1 && kids.length === 1 && status.babies[0].child === kids[0].id
  if (simple) {
    return (
      <p className="small conn-map-line">
        <CheckIcon className="conn-map-check" />
        <span>
          <span className="strong">{status.babies[0].name || 'Your baby'}</span> on Hatch is <span className="strong">{kids[0].first_name}</span> in Bramble.
        </span>
      </p>
    )
  }
  return (
    <section className="stack conn-babies" aria-label="Babies">
      {choosing ? <p className="small strong">Which child is each Hatch baby? Nothing is imported until you choose.</p> : null}
      {status.babies.map((b) => (
        <label key={b.id} className="conn-baby">
          <span className="conn-baby-name">
            {b.name || `Baby ${b.id}`}
            <span className="xs muted"> on Hatch</span>
          </span>
          <select className="text-input conn-select" value={b.child === null ? '' : String(b.child)} disabled={hatch.mapBabies.isPending} onChange={(e) => e.target.value !== '' && hatch.mapBabies.mutate([{ id: b.id, child: Number(e.target.value) }])} aria-label={`Bramble child for ${b.name || 'this baby'}`}>
            {b.child === null ? <option value="">Choose…</option> : null}
            {kids.map((c) => (
              <option key={c.id} value={c.id}>
                {c.first_name}
              </option>
            ))}
            <option value="0">Don’t import</option>
          </select>
        </label>
      ))}
    </section>
  )
}

function Problem({ status }: { status: HatchStatus }) {
  const problem = status.problem
  if (!problem) return null
  const tone = problemTone(problem.code)
  return (
    <div className={`conn-problem ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="conn-problem-title">{tone === 'error' ? 'Weights are not coming in' : 'A temporary hiccup'}</span>
      <span className="small">{problem.message}</span>
    </div>
  )
}

/** Routes, status codes and key names of Hatch's last answers: what a maintainer needs, and no secrets. */
function Report({ text, open }: { text: string; open: boolean }) {
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no')
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('yes')
    } catch {
      setCopied('failed') // no clipboard permission: the text stays selectable below
    }
  }
  return (
    <details className="conn-report" open={open || undefined}>
      <summary>Connection report</summary>
      <div className="conn-report-body">
        <p className="xs muted">What Bramble asked Hatch and the shape of each answer. It holds no password, no sign-in token and no weights.</p>
        <Button variant="secondary" block onClick={() => void copy()}>
          {copied === 'yes' ? 'Copied' : 'Copy report'}
        </Button>
        {copied === 'failed' ? <p className="xs conn-error">Could not copy. Press and hold the text below to select it.</p> : null}
        <pre className="conn-report-text" tabIndex={0}>
          {text}
        </pre>
      </div>
    </details>
  )
}
