import { BackButton } from '../../components/nav/BackButton'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { PlayIcon, StopIcon, TrashIcon } from '../../components/icons'
import { useChildren } from '../../hooks/useChildren'
import { useGoBack } from '../../hooks/useGoBack'
import { ck, useInvalidateCompanion } from '../../hooks/useCompanionEvents'
import { useNow } from '../../hooks/useNow'
import { describeApiError } from '../../lib/api/client'
import { companion, type Contraction } from '../../lib/api/companion'
import { analyzeContractions, formatContractionDuration } from '../../lib/contractions'
import { formatClock, formatTime, parseDate, toIso } from '../../lib/time'
import '../timer/timer.css'
import './contractions.css'

const INTENSITY = ['Mild', 'Moderate', 'Strong']
const INTENSITY_SHORT = ['Mild', 'Mod.', 'Strong']

export function ContractionsPage() {
  const { child } = useChildren()
  const goBack = useGoBack()
  const now = useNow()
  const invalidate = useInvalidateCompanion()
  const qc = useQueryClient()
  const since = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), [])
  const list = useQuery({
    queryKey: [...ck.contractions(child?.id ?? 0), 'page'],
    enabled: child !== null,
    queryFn: () => companion.contractions.list(child!.id, since),
    refetchInterval: 10_000,
  })
  const [error, setError] = useState<string | null>(null)
  const items = list.data ?? []
  const active = items.find((c) => !c.end) ?? null
  const stats = analyzeContractions(items, now)

  const mutate = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => {
      await fn()
      // Stay "pending" until the list is refreshed, otherwise a second tap on Start before the refetch
      // lands opens a second contraction that never gets closed.
      if (child) await qc.invalidateQueries({ queryKey: ck.contractions(child.id) })
    },
    onSuccess: () => {
      setError(null)
      if (child) invalidate(child.id)
    },
    onError: (e) => setError(describeApiError(e)),
  })

  if (!child) return null

  const start = () => mutate.mutate(() => companion.contractions.create({ child: child.id, start: toIso(new Date()), end: null, intensity: null, notes: '' }))
  const stop = () => active && mutate.mutate(() => companion.contractions.update(active.id, { end: toIso(new Date()) }))
  const setIntensity = (c: Contraction, i: number) => mutate.mutate(() => companion.contractions.update(c.id, { intensity: i }))
  const remove = (c: Contraction) => mutate.mutate(() => companion.contractions.remove(c.id))

  const elapsed = active ? (now.getTime() - parseDate(active.start).getTime()) / 1000 : 0
  const done = items.filter((c) => c.end)

  return (
    <main className="timer-page timer-contractions">
      <header className="timer-head">
        <BackButton onClick={goBack} />
        <span className="timer-kind">Contractions</span>
        <span className="timer-child">{child.first_name}</span>
      </header>

      <section className="timer-clock-wrap">
        <div className="timer-clock">{formatClock(elapsed)}</div>
        <p className="timer-sub">{active ? `Started ${formatTime(active.start)}` : stats.count ? stats.summary : 'Tap start when a contraction begins'}</p>
      </section>

      <button type="button" className="stop-btn" onClick={active ? stop : start} disabled={mutate.isPending} aria-label={active ? 'Stop contraction' : 'Start contraction'}>
        {active ? <StopIcon /> : <PlayIcon />}
        <span>{active ? 'Stop' : 'Start'}</span>
      </button>

      {stats.fiveOneOne ? (
        <div className="c-alert" role="alert">
          <strong>5-1-1 pattern reached.</strong> Contractions about 5 minutes apart, lasting about a minute, for an hour. Call your provider or head in, as they advised.
        </div>
      ) : null}

      <section className="card card-pad stack">
        <div className="c-stats">
          <div>
            <span className="xs muted">Last hour</span>
            <span className="strong">{stats.count} {stats.count === 1 ? 'contraction' : 'contractions'}</span>
          </div>
          <div>
            <span className="xs muted">Avg length</span>
            <span className="strong">{stats.count ? formatClock(stats.avgDurationSec).slice(3) : '—'}</span>
          </div>
          <div>
            <span className="xs muted">Avg apart</span>
            <span className="strong">{stats.avgIntervalSec ? `${Math.round(stats.avgIntervalSec / 60)}m` : '—'}</span>
          </div>
        </div>
        {error ? (
          <p className="log-error" role="alert">
            {error}
          </p>
        ) : null}
        <ul className="c-list">
          {done.length ? (
            // Column labels for the three intensity circles (they were three unlabelled rings).
            <li className="c-row c-head" aria-hidden>
              <span className="grow xs muted">Intensity</span>
              <span className="c-intensity">
                {INTENSITY_SHORT.map((l) => (
                  <span key={l} className="c-head-label">
                    {l}
                  </span>
                ))}
              </span>
              <span className="c-head-spacer" />
            </li>
          ) : null}
          {done.map((c, i) => {
            const prev = done[i + 1]
            const gap = prev ? Math.round((parseDate(c.start).getTime() - parseDate(prev.start).getTime()) / 60_000) : null
            return (
              <li key={c.id} className="c-row">
                <span className="grow c-main">
                  <span className="c-line">
                    <span className="c-time">{formatTime(c.start)}</span> <span className="strong">{formatContractionDuration(c)}</span>
                  </span>
                  <span className="xs muted c-gap">{gap !== null ? `${gap}m since previous` : 'first logged'}</span>
                </span>
                <span className="c-intensity" role="radiogroup" aria-label="Intensity">
                  {INTENSITY.map((label, idx) => (
                    <button key={label} type="button" role="radio" aria-checked={c.intensity === idx + 1} className={c.intensity === idx + 1 ? 'c-dot on' : 'c-dot'} onClick={() => setIntensity(c, idx + 1)} aria-label={label} />
                  ))}
                </span>
                <button type="button" className="sheet-icon-btn" aria-label="Delete" onClick={() => remove(c)}>
                  <TrashIcon />
                </button>
              </li>
            )
          })}
        </ul>
        {done.length === 0 && !active ? <p className="muted small">No contractions logged in the last 24 hours.</p> : null}
        <Button variant="ghost" onClick={goBack}>
          Done
        </Button>
      </section>
    </main>
  )
}
