import { format } from 'date-fns'
import { Link } from 'react-router-dom'
import { CalendarClockIcon, HeartIcon, MoonIcon, SparkIcon } from '../../components/icons'
import type { Child, Sleep } from '../../lib/api/types'
import { useAgeBasis } from '../../hooks/useAgeBasis'
import { describeGestation, isExpecting } from '../../lib/child'
import { ageHold, holdLine, judgedMonths } from '../../lib/preterm'
import { predictNap } from '../../lib/nap-window'
import { formatAgo, formatDurationShort, formatTime } from '../../lib/time'
import './nap-band.css'

interface Props {
  child: Child
  sleeps: Sleep[]
  now: Date
  wakeWindowAdjustMinutes?: number
  /** Start of a running sleep timer for this child, if any. */
  asleepSince?: Date | null
  onSchedule: () => void
  /** The prediction opens the nap window page; off on that page itself. */
  linked?: boolean
}

/** "4:43 PM" never breaks between the time and PM at 320 px. */
const nb = (t: string) => t.replace(' ', '\u00a0')

/** The grey band under the header: nap window pill + prediction (or gestation while expecting). */
export function NapBand({ child, sleeps, now, wakeWindowAdjustMinutes = 0, asleepSince = null, onSchedule, linked = true }: Props) {
  const expecting = isExpecting(child, now)
  const basis = useAgeBasis(child)
  const hold = expecting ? null : ageHold(basis, now)

  if (hold) {
    // In the NICU or before the due date (Settings › Born early): no wake windows fit, so no prediction; the
    // band says where things stand instead, like the gestation line while expecting.
    return (
      <section className="band" data-testid="band-held">
        <div className="band-main">
          <div className="band-pillrow">
            <span className="band-pill">
              Nap window
            </span>
          </div>
          <p className="band-copy">
            Naps are predicted {hold === 'nicu' || !basis.due ? `once ${child.first_name} is home` : `from ${child.first_name}'s due date, ${format(new Date(`${basis.due}T12:00:00`), 'MMM d')}`}
          </p>
        </div>
        <div className="band-foot">
          <span className="band-heart">
            <HeartIcon />
          </span>
          <span className="band-foot-text">{holdLine(basis, now)}</span>
        </div>
        <Illustration />
      </section>
    )
  }

  if (expecting) {
    return (
      <section className="band">
        <div className="band-main">
          <div className="band-pillrow">
            <Link to="/nap" className="band-pill">
              Nap window
            </Link>
            <button type="button" className="band-pill-icon" onClick={onSchedule} aria-label="Schedule creator">
              <CalendarClockIcon />
            </button>
          </div>
          <p className="band-copy">
            Naps are predicted once {child.first_name} arrives
          </p>
        </div>
        <div className="band-foot">
          <span className="band-heart">
            <HeartIcon />
          </span>
          <span className="band-foot-text">{describeGestation(child, now)}</span>
        </div>
        <Illustration />
      </section>
    )
  }

  const p = predictNap(sleeps, judgedMonths(basis, now), now, wakeWindowAdjustMinutes, asleepSince)
  let headline = ''
  let sub = ''
  let progress = 0
  if (p.state === 'no-data') {
    headline = 'Log a sleep to unlock it'
    sub = `We'll predict ${child.first_name}'s next nap from real patterns.`
  } else if (p.state === 'stale' && p.lastWakeAt) {
    // Sleep has not been logged for half a day or more: say so instead of "Awake 274h" and a nap due at 3:50 AM.
    headline = 'Log a sleep to see the next nap'
    sub = `Last sleep logged ${formatAgo(p.lastWakeAt, now)}`
  } else if (p.state === 'asleep' && p.asleepSince) {
    headline = `Asleep ${formatDurationShort((now.getTime() - p.asleepSince.getTime()) / 1000)}`
    sub = `Since ${formatTime(p.asleepSince)}`
    progress = 1
  } else if (p.at && p.lastWakeAt) {
    const total = p.at.getTime() - p.lastWakeAt.getTime()
    progress = Math.min(1, Math.max(0, (now.getTime() - p.lastWakeAt.getTime()) / total))
    const mins = Math.round((p.at.getTime() - now.getTime()) / 60_000)
    if (p.state === 'overdue') {
      headline = `Nap was due ${nb(formatTime(p.at))}`
      sub = `Awake ${formatDurationShort((now.getTime() - p.lastWakeAt.getTime()) / 1000)} · past the window`
    } else {
      headline = `Next nap ${nb(formatTime(p.at))}` // "PM" never drops to its own line at 320
      sub = mins <= 0 ? 'Right now is ideal' : `In ${formatDurationShort(mins * 60)} · awake since ${formatTime(p.lastWakeAt)}`
    }
  }
  const r = 30
  const circ = 2 * Math.PI * r
  const prediction = (
    <>
      <span className="band-headline">{headline}</span>
      <span className="band-sub">{sub}</span>
      <span className="band-ring" aria-hidden>
        <svg viewBox="0 0 72 72">
          <circle cx="36" cy="36" r={r} className="band-ring-track" />
          <circle cx="36" cy="36" r={r} className="band-ring-fill" strokeDasharray={circ} strokeDashoffset={circ * (1 - progress)} />
        </svg>
        <span className="band-ring-icon">{p.state === 'asleep' ? <MoonIcon /> : <SparkIcon />}</span>
      </span>
    </>
  )

  // The nap window tab with the Schedule Creator beside it, the prediction under it, and the ring on the right
  // beside both (the prediction, ring included, is the way to the nap window page); the learned window under that.
  return (
    <section className={`band band-live state-${p.state}`}>
      <div className="band-main">
        <div className="band-pillrow">
          {linked ? (
            <Link to="/nap" className="band-pill">
              Nap window
            </Link>
          ) : (
            <span className="band-pill">
              Nap window
            </span>
          )}
          <button type="button" className="band-pill-icon" onClick={onSchedule} aria-label="Schedule creator">
            <CalendarClockIcon />
          </button>
        </div>
        {linked ? (
          <Link to="/nap" className="band-pred">
            {prediction}
          </Link>
        ) : (
          <div className="band-pred">{prediction}</div>
        )}
      </div>
      {p.windowStart && p.windowEnd ? (
        <div className="band-foot">
          <span className="band-heart">
            <SparkIcon />
          </span>
          <span className="band-foot-text">
            {/* Two pieces that each stay whole: the window, then where it comes from on the next line when needed. */}
            <span className="band-foot-piece">Best window {timeRange(p.windowStart, p.windowEnd)}</span>
            {' · '}
            {p.samples ? <span className="band-foot-piece">learned from {p.samples} {p.samples === 1 ? 'nap' : 'naps'}</span> : 'age-based until more sleep is logged'}
          </span>
        </div>
      ) : null}
    </section>
  )
}

/** "12:17 – 12:37 PM": the first time drops its AM/PM when both share it, so the window fits one line. */
function timeRange(a: Date, b: Date): string {
  const from = formatTime(a)
  const to = formatTime(b)
  const [fromClock, fromHalf] = from.split(' ')
  const [, toHalf] = to.split(' ')
  return `${nb(fromHalf && fromHalf === toHalf ? fromClock : from)} – ${nb(to)}`
}

/** Friendly caregiver illustration (pure CSS/SVG). */
function Illustration() {
  return (
    <svg className="band-illo" viewBox="0 0 120 150" aria-hidden>
      <circle cx="60" cy="44" r="30" fill="#f47a45" />
      <circle cx="60" cy="52" r="22" fill="#f9c9a8" />
      <path d="M36 52c0-16 10-26 24-26s24 10 24 26c-6-8-14-10-24-10s-18 2-24 10Z" fill="#e8562b" />
      <circle cx="66" cy="20" r="10" fill="#e8562b" />
      <circle cx="52" cy="54" r="5" fill="none" stroke="#2a3545" strokeWidth="2" />
      <circle cx="68" cy="54" r="5" fill="none" stroke="#2a3545" strokeWidth="2" />
      <path d="M57 54h6" stroke="#2a3545" strokeWidth="2" />
      <circle cx="52" cy="54" r="1.5" fill="#2a3545" />
      <circle cx="68" cy="54" r="1.5" fill="#2a3545" />
      <path d="M54 64c3 3 9 3 12 0" stroke="#c0457a" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M20 150c0-34 16-52 40-52s40 18 40 52Z" fill="#c9d22a" />
      <path d="M60 98v52" stroke="#eef39a" strokeWidth="3" />
      <circle cx="74" cy="118" r="4" fill="#f2c21f" />
    </svg>
  )
}
