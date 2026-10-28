import { format } from 'date-fns'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottleIcon, CheckIcon, DiaperIcon, DropIcon, MixedIcon, PooIcon } from '../../components/icons'
import { useChildren } from '../../hooks/useChildren'
import { rangeDays, useChildEvents, useInvalidateChild } from '../../hooks/useEvents'
import { useInvalidateMilk, useMilkStash } from '../../hooks/useMilk'
import { useNow } from '../../hooks/useNow'
import { usePeople } from '../../hooks/usePeople'
import { usePrefs } from '../../hooks/usePrefs'
import { useUnitBoundary } from '../../hooks/useStorageUnits'
import { logout } from '../../lib/api/auth'
import { describeApiError } from '../../lib/api/client'
import { companion, type MilkBag, type SimpleAction } from '../../lib/api/companion'
import { changes as changesApi, feedings as feedingsApi } from '../../lib/api/endpoints'
import { kcalTag } from '../../lib/calories'
import type { Feeding } from '../../lib/api/types'
import { formatMl, summarizeStash } from '../../lib/milk'
import { bottleNote, drankMl, type BottleLeft } from '../../lib/bottle-finish'
import { agoText, diaperBody, lastBottle, lastDiaper, whenText, type DiaperKind } from '../../lib/simple-screen'
import { toIso } from '../../lib/time'
import { convertVolume } from '../../lib/units'
import './simple.css'

type Step =
  | { kind: 'home' }
  | { kind: 'bottle' }
  | { kind: 'finish'; bottle: MilkBag }
  | { kind: 'left'; bottle: MilkBag }
  | { kind: 'diaper' }
  | { kind: 'saved'; what: string; undo: () => Promise<void> }
  | { kind: 'undone' }
  | { kind: 'account' }

const DIAPER_WORD: Record<DiaperKind, string> = { pee: 'Pee', poop: 'Poop', both: 'Pee and poop' }

/**
 * The whole app for a grandparent: big buttons, the time is always now, no pickers, no tab bar, no Settings.
 * Bottle means a premade bottle from the fridge spots (the number on the sticker is the number on the button);
 * Diaper is one tap on Pee, Poop or Both. After each save one screen says what was saved, with Done and a way
 * to take it back. Entries carry the person's own login, so the timeline and the parents' pings name them.
 * The way out is "Signed in as …" at the bottom: it opens one screen whose big button is Back and whose
 * smaller one signs out, so a stray tap never ends the session.
 */
export function SimplePage({ actions, username }: { actions: SimpleAction[]; username: string }) {
  const { child } = useChildren()
  const { people } = usePeople()
  const me = people?.find((p) => p.you)
  const who = me?.label || username
  const navigate = useNavigate()
  const now = useNow(30_000)
  const [step, setStep] = useState<Step>({ kind: 'home' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  // A bottle whose feeding was written but whose stash step failed: tapping again finishes it, never writes twice.
  const pending = useRef<{ bottle: number; feeding: Feeding } | null>(null)
  const { prefs } = usePrefs()
  const unit = prefs.units.volume
  const units = useUnitBoundary(child?.id ?? null)
  const invalidate = useInvalidateChild()
  const invalidateMilk = useInvalidateMilk()
  const stash = useMilkStash(child && actions.includes('bottle') ? child.id : null)
  const bottles = useMemo(() => summarizeStash(stash.data ?? [], now).bottles, [stash.data, now])
  const range = useMemo(() => rangeDays(3, now), [now])
  const events = useChildEvents(child?.id ?? null, range)
  if (!child) return null
  const name = child.first_name

  const go = (next: Step) => {
    setError(null)
    setStep(next)
  }
  const run = async (fn: () => Promise<void>) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(`That did not save. Check the Wi-Fi and tap again. (${describeApiError(err)})`)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const refresh = () => {
    invalidate(child.id)
    invalidateMilk(child.id)
  }

  const giveBottle = (bottle: MilkBag, left: BottleLeft) =>
    run(async () => {
      const drank = drankMl(bottle.remaining_ml, left)
      const amount = Math.round(convertVolume(drank, 'ml', unit) * (unit === 'oz' ? 10 : 1)) / (unit === 'oz' ? 10 : 1)
      const at = new Date()
      let feeding = pending.current?.bottle === bottle.id ? pending.current.feeding : null
      if (!feeding) {
        // A bottle mixed to a strength is fortified milk and keeps that strength on the feeding (calories in Reports).
        const fortified = bottle.kcal_per_oz ? { type: 'fortified breast milk', tags: [kcalTag(bottle.kcal_per_oz)] } : { type: 'breast milk' }
        const body = { child: child.id, start: toIso(at), end: toIso(at), method: 'bottle', amount, notes: bottleNote(bottle.spot, left), ...fortified }
        feeding = await feedingsApi.create(units.toStorage('feeding', body))
        pending.current = { bottle: bottle.id, feeding }
      }
      // A premade bottle leaves its spot whole: what she does not finish is thrown away.
      await companion.milk.setTakes(feeding.id, [{ bag: bottle.id, amount_ml: bottle.remaining_ml }])
      pending.current = null
      refresh()
      const saved = feeding
      go({
        kind: 'saved',
        what:
          left === 'none'
            ? `Bottle ${bottle.spot} · finished · ${formatMl(drank, unit)} · ${format(at, 'h:mm a')}`
            : `Bottle ${bottle.spot} · not finished · she drank about ${formatMl(drank, unit)} · ${format(at, 'h:mm a')}`,
        // Milk back first: a retry after a dropped connection then finds the feeding still there to delete.
        undo: async () => {
          await companion.milk.setTakes(saved.id, [])
          await feedingsApi.remove(saved.id)
          refresh()
        },
      })
    })

  const logDiaper = (kind: DiaperKind) =>
    run(async () => {
      const at = new Date()
      const entry = await changesApi.create(diaperBody(child.id, kind, at))
      refresh()
      go({
        kind: 'saved',
        what: `Diaper · ${DIAPER_WORD[kind].toLowerCase()} · ${format(at, 'h:mm a')}`,
        undo: async () => {
          await changesApi.remove(entry.id)
          refresh()
        },
      })
    })

  const last = (at: Date | null, word: string) => (at ? `Last ${word} ${whenText(at, now)} · ${agoText(at, now)}` : `No ${word} in the last few days`)

  let body: ReactNode
  if (step.kind === 'bottle') {
    body = (
      <Screen title="Which bottle?" onBack={() => go({ kind: 'home' })} busy={busy}>
        {stash.isLoading ? (
          <p className="simple-say">Looking in the fridge…</p>
        ) : bottles.length === 0 ? (
          <p className="simple-say" data-testid="simple-no-bottles">
            No bottles are ready in the fridge. Ask Mom or Dad to make some.
          </p>
        ) : (
          <>
            <p className="simple-hint">Take the bottle with this number on the fridge.</p>
            <div className="simple-spots">
              {bottles.map((b) => (
                <button key={b.id} type="button" className="simple-spot" onClick={() => go({ kind: 'finish', bottle: b })} aria-label={`Bottle ${b.spot}, ${formatMl(b.remaining_ml, unit)}`}>
                  <span className="simple-spot-num">{b.spot}</span>
                  <span className="simple-spot-ml">{formatMl(b.remaining_ml, unit)}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </Screen>
    )
  } else if (step.kind === 'finish') {
    const b = step.bottle
    body = (
      <Screen title={`Did ${name} finish bottle ${b.spot}?`} onBack={() => go({ kind: 'bottle' })} busy={busy}>
        <BigButton tone="feed" icon={<BottleLevel full={0} />} onClick={() => void giveBottle(b, 'none')} disabled={busy} sub={`She drank ${formatMl(b.remaining_ml, unit)}`}>
          Yes, all of it
        </BigButton>
        <BigButton tone="plain" icon={<BottleLevel full={0.5} />} onClick={() => go({ kind: 'left', bottle: b })} disabled={busy} sub="Milk is still in the bottle">
          No, she left some
        </BigButton>
      </Screen>
    )
  } else if (step.kind === 'left') {
    const b = step.bottle
    const option = (left: Exclude<BottleLeft, 'none'>, label: string, full: number) => (
      <BigButton tone="plain" icon={<BottleLevel full={full} />} onClick={() => void giveBottle(b, left)} disabled={busy} sub={`She drank about ${formatMl(drankMl(b.remaining_ml, left), unit)}`}>
        {label}
      </BigButton>
    )
    body = (
      <Screen title={`How much is left in bottle ${b.spot}?`} onBack={() => go({ kind: 'finish', bottle: b })} busy={busy}>
        {option('little', 'A little', 0.25)}
        {option('half', 'About half', 0.5)}
        {option('most', 'Most of it', 0.75)}
        <p className="simple-hint">Then pour what is left down the sink.</p>
      </Screen>
    )
  } else if (step.kind === 'diaper') {
    body = (
      <Screen title="What was in the diaper?" onBack={() => go({ kind: 'home' })} busy={busy}>
        <BigButton tone="pee" icon={<DropIcon />} onClick={() => void logDiaper('pee')} disabled={busy}>
          Pee
        </BigButton>
        <BigButton tone="poop" icon={<PooIcon />} onClick={() => void logDiaper('poop')} disabled={busy}>
          Poop
        </BigButton>
        <BigButton tone="both" icon={<MixedIcon />} onClick={() => void logDiaper('both')} disabled={busy}>
          Both
        </BigButton>
      </Screen>
    )
  } else if (step.kind === 'saved') {
    body = (
      <div className="simple-screen simple-done" data-testid="simple-saved">
        <span className="simple-check" aria-hidden>
          <CheckIcon />
        </span>
        <h1 className="simple-title">Saved</h1>
        <p className="simple-say">{step.what}</p>
        <BigButton tone="feed" onClick={() => go({ kind: 'home' })} disabled={busy}>
          Done
        </BigButton>
        <button type="button" className="simple-undo" onClick={() => void run(async () => { await step.undo(); go({ kind: 'undone' }) })} disabled={busy}>
          Oops, take it back
        </button>
      </div>
    )
  } else if (step.kind === 'account') {
    body = (
      <div className="simple-screen simple-done" data-testid="simple-account">
        <h1 className="simple-title">Signed in as {who}</h1>
        <p className="simple-say">Not {who}? Sign out here. Signing back in needs the password.</p>
        <BigButton tone="feed" onClick={() => go({ kind: 'home' })}>
          ‹ Back
        </BigButton>
        <button
          type="button"
          className="simple-undo"
          onClick={() => {
            logout()
            // The sign-in page clears the cache when it mounts, after this screen has gone.
            navigate('/signin', { replace: true })
          }}
        >
          Sign out
        </button>
      </div>
    )
  } else if (step.kind === 'undone') {
    body = (
      <div className="simple-screen simple-done" data-testid="simple-undone">
        <h1 className="simple-title">Taken back</h1>
        <p className="simple-say">Nothing was saved.</p>
        <BigButton tone="feed" onClick={() => go({ kind: 'home' })}>
          Done
        </BigButton>
      </div>
    )
  } else {
    body = (
      <div className="simple-screen">
        <header className="simple-head">
          <h1 className="simple-name">{name}</h1>
          <p className="simple-clock">{format(now, 'EEEE · h:mm a')}</p>
        </header>
        <p className="simple-prompt">Tap what you just did</p>
        {actions.includes('bottle') ? (
          <BigButton tone="feed" icon={<BottleIcon />} onClick={() => go({ kind: 'bottle' })} sub={last(lastBottle(events.feedings), 'bottle')}>
            Bottle
          </BigButton>
        ) : null}
        {actions.includes('diaper') ? (
          <BigButton tone="diaper" icon={<DiaperIcon />} onClick={() => go({ kind: 'diaper' })} sub={last(lastDiaper(events.changes), 'diaper')}>
            Diaper
          </BigButton>
        ) : null}
        {who ? (
          <button type="button" className="simple-who" onClick={() => go({ kind: 'account' })}>
            Signed in as {who} ›
          </button>
        ) : null}
      </div>
    )
  }
  return (
    <main className="simple" data-testid="simple-page">
      {body}
      {error ? (
        <p className="simple-error" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  )
}

function Screen({ title, onBack, busy, children }: { title: string; onBack: () => void; busy: boolean; children: ReactNode }) {
  return (
    <div className="simple-screen">
      <h1 className="simple-title">{title}</h1>
      {children}
      <button type="button" className="simple-back" onClick={onBack} disabled={busy}>
        ‹ Back
      </button>
    </div>
  )
}

function BigButton({ tone, icon, sub, onClick, disabled, children }: { tone: 'feed' | 'diaper' | 'pee' | 'poop' | 'both' | 'plain'; icon?: ReactNode; sub?: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" className={`simple-big is-${tone}`} onClick={onClick} disabled={disabled}>
      {icon ? <span className="simple-big-icon">{icon}</span> : null}
      <span className="simple-big-text">
        <span className="simple-big-label">{children}</span>
        {sub ? <span className="simple-big-sub">{sub}</span> : null}
      </span>
    </button>
  )
}

/** A bottle with milk up to `full` (0–1): what the person holding it sees. */
function BottleLevel({ full }: { full: number }) {
  const h = 14 * full
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden>
      <path d="M10 2.5h4l.6 2.5H9.4z" />
      <rect x="7" y="5" width="10" height="17" rx="2.5" />
      {h > 0 ? <rect x="8.4" y={20.6 - h} width="7.2" height={h} rx="1.2" fill="currentColor" stroke="none" /> : null}
    </svg>
  )
}
