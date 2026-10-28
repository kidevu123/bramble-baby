import { useNavigate } from 'react-router-dom'
import { useTimers } from '../../hooks/useEvents'
import { describeApiError } from '../../lib/api/client'
import type { Child } from '../../lib/api/types'
import { useTimerActions } from '../timer/useTimerActions'
import { LaunchRow } from './LogFields'

/** "Start a live timer instead": one card at the top of manual-entry sheets. */
export function TimerLaunch({ child, name, tone, label }: { child: Child; name: string; tone: string; label: string }) {
  const { start, isStarting, error } = useTimerActions()
  const navigate = useNavigate()
  const timers = useTimers()
  // A second timer of the same kind would run beside the first unnoticed; the card opens the one running.
  const running = timers.data?.find((t) => t.child === child.id && t.name === name) ?? null
  return (
    <>
      {error ? (
        <p className="log-error" role="alert">
          Could not start the timer: {describeApiError(error)}
        </p>
      ) : null}
      <LaunchRow
        tone={tone}
        className="timer-launch"
        onClick={() => (running ? navigate(`/timer/${running.id}`) : start(child.id, name))}
        disabled={isStarting}
        title={running ? `${capitalise(name)} timer already running` : label}
        sub={running ? 'Tap to open it' : "Live on every caregiver's phone"}
      />
    </>
  )
}

const capitalise = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
