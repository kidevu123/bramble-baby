import { Link } from 'react-router-dom'
import { useNow } from '../../hooks/useNow'
import { useTimers } from '../../hooks/useEvents'
import type { Id } from '../../lib/api/types'
import { decodeNursing, nursingTotals } from '../../lib/nursing'
import { formatClock, parseDate } from '../../lib/time'
import { timerKind } from './useTimerActions'
import { MoonIcon, DropIcon, PumpIcon, TummyIcon, PlayIcon } from '../../components/icons'
import './timer.css'

const META = {
  sleep: { label: 'Sleeping', tone: 'sleep', Icon: MoonIcon },
  nursing: { label: 'Nursing', tone: 'feeding', Icon: DropIcon },
  pumping: { label: 'Pumping', tone: 'pumping', Icon: PumpIcon },
  tummy: { label: 'Tummy time', tone: 'tummy', Icon: TummyIcon },
  other: { label: 'Timer', tone: 'note', Icon: PlayIcon },
} as const

/** Live timers for this child, shown at the top of Home so nothing is ever lost. */
export function ActiveTimers({ child }: { child: Id }) {
  const timers = useTimers()
  const now = useNow()
  const mine = (timers.data ?? []).filter((t) => t.child === child)
  if (mine.length === 0) return null
  return (
    <div className="active-timers">
      {mine.map((t) => {
        const kind = timerKind(t.name)
        const meta = META[kind]
        const nursing = kind === 'nursing' ? decodeNursing(t.name) : null
        const secs = nursing ? nursingTotals(nursing, now).total : (now.getTime() - parseDate(t.start).getTime()) / 1000
        return (
          <Link key={t.id} to={`/timer/${t.id}`} className={`active-timer soft-${meta.tone}`}>
            <span className={`icon-circle sm tone-${meta.tone} pulse`}>
              <meta.Icon />
            </span>
            <span className="grow">
              <span className={`strong text-${meta.tone}`}>{meta.label}</span>
              <span className="xs muted" style={{ display: 'block' }}>
                {nursing?.activeSide ? `${nursing.activeSide === 'left' ? 'Left' : 'Right'} side running` : 'Tap to stop or adjust'}
              </span>
            </span>
            <span className="active-timer-clock">{formatClock(secs)}</span>
          </Link>
        )
      })}
    </div>
  )
}
