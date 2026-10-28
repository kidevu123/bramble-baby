import { BackButton } from '../../components/nav/BackButton'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../../components/ui/Button'
import { FieldGroup, PillChoice } from '../../components/ui/Field'
import { NoteField, ValueField } from '../log/LogFields'
import { Splash } from '../../components/ui/Splash'
import { PauseIcon, PlayIcon, StopIcon } from '../../components/icons'
import { useChildren } from '../../hooks/useChildren'
import { useInvalidateChild, useLastPumping, useTimers } from '../../hooks/useEvents'
import { DEFAULT_PUMPS, withPumpTag } from '../../lib/pumps'
import { useGoBack } from '../../hooks/useGoBack'
import { useNow } from '../../hooks/useNow'
import { usePrefs } from '../../hooks/usePrefs'
import { volumeLabel } from '../../lib/units'
import { useUnitBoundary } from '../../hooks/useStorageUnits'
import { useChildSettings } from '../../hooks/useChildSettings'
import * as ep from '../../lib/api/endpoints'
import { describeApiError } from '../../lib/api/client'
import { qk } from '../../lib/api/keys'
import type { Timer } from '../../lib/api/types'
import { decodeNursing, encodeNursing, nursingMethod, nursingTotals, pauseNursing, toggleSide, type NursingState, type Side } from '../../lib/nursing'
import { formatClock, formatDurationShort, formatTime, formatWhen, fromLocalInput, isDaytime, parseDate, toIso, toLocalInput } from '../../lib/time'
import { stashLabelHandoff } from '../../lib/labels'
import type { MilkLocation } from '../../lib/api/companion'
import { PLACE_OPTIONS, placeNote } from '../../lib/milk'
import { useMilkWindows } from '../../hooks/useMilk'
import { useAutoPrint } from '../../hooks/useAutoPrint'
import { timerKind } from './useTimerActions'
import { shiftNursingStart } from './nursing-start'
import '../log/log.css'
import './timer.css'

const TITLE = { sleep: 'Sleep', nursing: 'Nursing', pumping: 'Pumping', tummy: 'Tummy time', other: 'Timer' } as const
const TONE = { sleep: 'sleep', nursing: 'feeding', pumping: 'pumping', tummy: 'tummy', other: 'note' } as const

export function TimerPage() {
  const { id } = useParams()
  const timers = useTimers()
  const timer = timers.data?.find((t) => t.id === Number(id))
  const navigate = useNavigate()
  const goBack = useGoBack()
  // Set when the user leaves on purpose (Back, Stop, Discard), so the redirect below never fires a
  // second navigation once the timers refetch no longer finds this timer.
  const leaving = useRef(false)
  // Back to where the timer was started from (Home, Reports…). A stopped pumping timer goes Home
  // instead: Home is the page that opens the milk label for the entry just saved.
  const leave = (to: 'back' | 'home') => {
    leaving.current = true
    if (to === 'home') navigate('/', { replace: true })
    else goBack()
  }

  const location = useLocation()
  useEffect(() => {
    // The timer disappeared under us (stopped from another device, or a stale deep link): leave the way
    // the user would. Only while still on the timer route and not already leaving.
    if (timers.isSuccess && !timer && !leaving.current && location.pathname.startsWith('/timer/')) {
      leaving.current = true
      goBack()
    }
  }, [timers.isSuccess, timer, goBack, location.pathname])

  if (!timer) return <Splash message="Finding your timer…" />
  return <TimerView timer={timer} leave={leave} />
}

function TimerView({ timer, leave }: { timer: Timer; leave: (to: 'back' | 'home') => void }) {
  const kind = timerKind(timer.name)
  const tone = TONE[kind]
  const now = useNow()
  const qc = useQueryClient()
  const invalidate = useInvalidateChild()
  const { children } = useChildren()
  const { prefs } = usePrefs()
  const child = children.find((c) => c.id === timer.child) ?? null
  const units = useUnitBoundary(child?.id ?? null)
  const autoPrint = useAutoPrint()
  const { settings } = useChildSettings(child?.id ?? null)
  // The pump this session used: the last session's until one is tapped (a `pump:<name>` tag on the entry).
  const last = useLastPumping(kind === 'pumping' && child ? child.id : null)
  const [pump, setPump] = useState<string | null>(null)
  const pumpTouched = useRef(false)
  // Where the milk goes when the timer stops: the fridge unless it is kept out for a bottle due soon.
  const [place, setPlace] = useState<MilkLocation>('fridge')
  const windows = useMilkWindows()
  useEffect(() => {
    if (pumpTouched.current || !last.pump) return
    setPump(last.pump)
  }, [last.pump])
  const pumpOptions = useMemo(() => {
    const names = (settings.pumps ?? DEFAULT_PUMPS).map((p) => p.name)
    if (pump && !names.includes(pump)) names.push(pump)
    return names.map((n) => ({ value: n, label: n }))
  }, [settings.pumps, pump])
  const [notes, setNotes] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Local optimistic nursing state, keyed to the server value it was derived from.
  // When another device changes sides, timer.name changes and the server state wins.
  const [local, setLocal] = useState<{ base: string | null; state: NursingState } | null>(null)
  const nursing = local && local.base === timer.name ? local.state : decodeNursing(timer.name)
  const setNursing = (state: NursingState) => setLocal({ base: timer.name, state })

  const start = parseDate(timer.start)
  // The timer opens at its clock and Stop button, never where the page it was started from was scrolled to.
  useEffect(() => {
    const raf = requestAnimationFrame(() => window.scrollTo(0, 0))
    return () => cancelAnimationFrame(raf)
  }, [])
  const needsVolume = kind === 'pumping' && amount.trim() === ''
  const elapsed = nursing ? nursingTotals(nursing, now).total : (now.getTime() - start.getTime()) / 1000

  async function guarded(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(describeApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function changeStart(d: Date) {
    if (d.getTime() > Date.now()) return
    // A nursing timer moved back ("forgot to start it") gives the gap to a side, so the note matches the duration.
    const moved = nursing ? shiftNursingStart(nursing, (start.getTime() - d.getTime()) / 1000) : null
    if (moved) setNursing(moved)
    await guarded(async () => {
      try {
        await ep.timers.update(timer.id, moved ? { start: toIso(d), name: encodeNursing(moved) } : { start: toIso(d) })
      } catch (err) {
        setLocal(null) // the server's state wins
        throw err
      }
      await qc.invalidateQueries({ queryKey: qk.timers })
    })
  }

  async function tapSide(side: Side) {
    if (!nursing) return
    const next = toggleSide(nursing, side, new Date())
    setNursing(next)
    await guarded(async () => {
      try {
        await ep.timers.update(timer.id, { name: encodeNursing(next) })
      } catch (err) {
        // Not switched on the server (nor on the other phones): show what really runs, and say why.
        setLocal(null)
        throw err
      }
      await qc.invalidateQueries({ queryKey: qk.timers })
    })
  }

  async function stop() {
    if (!child) return
    await guarded(async () => {
      if (kind === 'sleep') {
        await ep.sleep.create({ child: child.id, timer: timer.id, nap: isDaytime(start, settings.dayStart, settings.dayEnd), notes })
      } else if (kind === 'pumping') {
        // Baby Buddy requires an amount on pumping entries; the Stop button stays disabled until one is typed.
        const volume = Number(amount) > 0 ? Number(amount) : 0
        const saved = await ep.pumping.create(units.toStorage('pumping', { child: child.id, timer: timer.id, amount: volume, notes, tags: withPumpTag([], pump) }))
        invalidate(child.id)
        if (volume && autoPrint.enabled) {
          // The sticker prints by itself; the PrintNotice bar follows it wherever the page goes.
          void autoPrint.run(child, saved, volume, { editing: false, bag: null, location: place })
        } else if (volume) {
          // Straight to the label: Home opens the milk-label sheet for the entry just saved (in this phone's units).
          stashLabelHandoff({ ...units.toDisplay('pumping', saved), location: place })
        }
        leave(volume && !autoPrint.enabled ? 'home' : 'back') // Home only when it is the page that opens the label
        return
      } else if (kind === 'tummy') {
        await ep.tummyTimes.create({ child: child.id, timer: timer.id, milestone: notes })
      } else if (kind === 'nursing' && nursing) {
        const final = pauseNursing(nursing, new Date())
        const totals = nursingTotals(final)
        // Whole minutes, but never "0m": a 40-second side is written as "40s" so the note stays honest.
        const side = (secs: number) => (secs >= 60 ? formatDurationShort(secs) : `${Math.round(secs)}s`)
        const sides = [totals.left ? `Left ${side(totals.left)}` : null, totals.right ? `Right ${side(totals.right)}` : null].filter(Boolean).join(' · ')
        await ep.feedings.create({
          child: child.id,
          timer: timer.id,
          type: 'breast milk',
          method: nursingMethod(final),
          amount: null,
          notes: [sides, notes].filter(Boolean).join('\n'),
        })
      } else {
        if (!window.confirm('This timer was not started by Bramble, so there is nothing to save. Delete it?')) return
        await ep.timers.remove(timer.id)
      }
      invalidate(child.id)
      leave('back')
    })
  }

  async function discard() {
    if (!window.confirm('Discard this timer without saving?')) return
    await guarded(async () => {
      await ep.timers.remove(timer.id)
      await qc.invalidateQueries({ queryKey: qk.timers })
      leave('back')
    })
  }

  return (
    <main className={`timer-page timer-${tone}`}>
      <header className="timer-head">
        <BackButton onClick={() => leave('back')} />
        <span className="timer-kind">{TITLE[kind]}</span>
        <span className="timer-child">{child?.first_name ?? ''}</span>
      </header>

      <section className="timer-clock-wrap" aria-live="off">
        <div className="timer-clock" aria-label={`Elapsed ${formatClock(elapsed)}`}>
          {formatClock(elapsed)}
        </div>
        {/* The start is said once, here, and a tap on it fixes it ("forgot to start it"). */}
        <StartedLine start={start} onChange={changeStart} />
      </section>

      {nursing ? (
        <div className="nursing-sides">
          {(['left', 'right'] as Side[]).map((side) => {
            const active = nursing.activeSide === side
            const secs = side === 'left' ? nursingTotals(nursing, now).left : nursingTotals(nursing, now).right
            return (
              <button key={side} type="button" className={active ? 'nurse-btn active' : 'nurse-btn'} onClick={() => tapSide(side)} disabled={busy}>
                {active ? <PauseIcon /> : <PlayIcon />}
                <span className="nurse-time">{formatClock(secs).slice(3)}</span>
                <span className="nurse-label">{side === 'left' ? 'Left' : 'Right'}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <button type="button" className="stop-btn" onClick={stop} disabled={busy || !child || needsVolume || (kind === 'pumping' && !units.ready)} aria-label="Stop and save">
          <StopIcon />
          <span>Stop</span>
          {/* Why it does not stop yet: Baby Buddy needs a volume on every pumping entry. */}
          {needsVolume ? <span className="stop-why">Volume first</span> : null}
        </button>
      )}

      <section className="timer-details card card-pad stack">
        {/* Pumping: what is typed or picked every time first (volume, pump, where the milk goes). */}
        {kind === 'pumping' ? (
          <div className="timer-volume">
            <ValueField label="Volume" unit={volumeLabel(prefs.units.volume)} name={`Volume in ${volumeLabel(prefs.units.volume)}`} type="number" inputMode="decimal" step="0.25" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            <p className="field-group-hint">0 if none came out · {autoPrint.enabled ? 'the sticker prints' : 'the label opens'} on Stop</p>
          </div>
        ) : null}
        {kind === 'pumping' && pumpOptions.length ? (
          <FieldGroup title="Pump">
            <PillChoice options={pumpOptions} value={pump} onChange={(name) => { pumpTouched.current = true; setPump(name === pump ? null : name) }} tone="purple" />
          </FieldGroup>
        ) : null}
        {kind === 'pumping' ? <PlaceChoice place={place} onPlace={setPlace} line={placeNote(place, start, windows)} /> : null}
        <NoteField label={kind === 'tummy' ? 'Milestone' : 'Notes'} addLabel={kind === 'tummy' ? 'Add a milestone' : 'Add a note'} value={notes} onChange={setNotes} />
        {error ? (
          <p className="log-error" role="alert">
            {error}
          </p>
        ) : null}
        {nursing ? (
          <Button size="lg" block onClick={stop} loading={busy} disabled={!child}>
            Finish &amp; save
          </Button>
        ) : null}
        <Button variant="ghost" onClick={discard} disabled={busy}>
          Discard timer
        </Button>
        <p className="xs muted" style={{ textAlign: 'center' }}>
          This timer lives on the server. Every caregiver sees it live, and closing the app never loses it.
        </p>
      </section>
    </main>
  )
}

/** "Started 3:36 PM" under the clock; the time is the tap target of a date-and-time picker. */
function StartedLine({ start, onChange }: { start: Date; onChange: (d: Date) => void }) {
  const [future, setFuture] = useState(false)
  const now = new Date()
  const when = start.toDateString() === now.toDateString() ? formatTime(start) : formatWhen(start, now)
  return (
    <>
      <label className="timer-sub timer-started">
        <span>Started</span>
        <span className="timer-started-time">
          {when}
          <input
            type="datetime-local"
            value={toLocalInput(start)}
            max={toLocalInput(now)}
            aria-label="Started"
            onChange={(e) => {
              if (!e.target.value) return
              const d = fromLocalInput(e.target.value)
              const late = d.getTime() > Date.now() + 60_000
              setFuture(late)
              if (!late) onChange(d)
            }}
          />
        </span>
      </label>
      {future ? (
        <p className="small muted timer-started-note" role="status">
          That was in the future · the start stays as it was
        </p>
      ) : null}
    </>
  )
}

function PlaceChoice({ place, onPlace, line }: { place: MilkLocation; onPlace: (p: MilkLocation) => void; line: ReturnType<typeof placeNote> }) {
  return (
    <FieldGroup title="Milk goes in">
      <PillChoice options={PLACE_OPTIONS} value={place} onChange={onPlace} tone="teal" />
      {line ? (
        <p className={`small ${line.late ? 'text-health' : 'text-pumping'}`} role="status" data-testid="place-note">
          {line.text}
        </p>
      ) : null}
    </FieldGroup>
  )
}
