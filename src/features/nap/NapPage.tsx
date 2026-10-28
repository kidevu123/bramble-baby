import { useMemo, useState } from 'react'
import { TopBar } from '../../components/nav/TopBar'
import { useChildren } from '../../hooks/useChildren'
import { rangeDays, useChildEvents, useRunningSleep } from '../../hooks/useEvents'
import { useNow } from '../../hooks/useNow'
import { ageBasis, judgedMonths } from '../../lib/preterm'
import { ageWakeWindow, predictNap, suggestBedtime } from '../../lib/nap-window'
import { formatDurationShort, formatTime } from '../../lib/time'
import { ScheduleCreatorSheet } from '../child/ChildSettingsSheets'
import { NapBand } from '../home/NapBand'
import { useChildSettings } from '../../hooks/useChildSettings'
import { SunIcon } from '../../components/icons'
import './nap.css'

export function NapPage() {
  const { child } = useChildren()
  const now = useNow(30_000)
  const dayKey = now.toDateString()
  const range = useMemo(() => rangeDays(14, now), [dayKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const events = useChildEvents(child?.id ?? null, range)
  const { settings } = useChildSettings(child?.id ?? null)
  const asleepSince = useRunningSleep(child?.id ?? null)
  const [schedule, setSchedule] = useState(false)
  if (!child) return null

  const months = judgedMonths(ageBasis(child, settings), now) // corrected age for a baby born early
  const prediction = predictNap(events.sleep, months, now, settings.sweetSpot.wakeWindowAdjustMinutes, asleepSince)
  const window = ageWakeWindow(months)
  const bedtime = suggestBedtime(months, now, prediction.lastWakeAt)

  return (
    <>
      <TopBar title="Nap window" right="none" back />
      <main className="page">
        <NapBand child={child} sleeps={events.sleep} now={now} wakeWindowAdjustMinutes={settings.sweetSpot.wakeWindowAdjustMinutes} asleepSince={asleepSince} onSchedule={() => setSchedule(true)} linked={false} />

        <section className="card card-pad stack">
          <div className="row">
            <span className="icon-circle sm tone-sleep">
              <SunIcon />
            </span>
            <h3>How it's calculated</h3>
          </div>
          <p className="small">
            The nap window looks at the gap between {child.first_name}'s wake-ups and next naps over the last 7 days, then blends that with the typical wake window for a{' '}
            {months < 1 ? 'newborn' : `${Math.floor(months)}-month-old`} ({formatDurationShort(window.minMinutes * 60)} – {formatDurationShort(window.maxMinutes * 60)}). More logged sleep means a sharper prediction.
          </p>
          <dl className="ss-facts">
            <div>
              <dt>Wake window in use</dt>
              <dd>{formatDurationShort(prediction.wakeWindowMinutes * 60)}</dd>
            </div>
            <div>
              <dt>Based on</dt>
              <dd>{prediction.samples ? `${prediction.samples} observed windows` : 'age only so far'}</dd>
            </div>
            <div>
              <dt>Typical naps per day</dt>
              <dd>{window.napsPerDay || 'none'}</dd>
            </div>
            <div>
              <dt>Suggested bedtime</dt>
              <dd>{formatTime(bedtime)}</dd>
            </div>
          </dl>
        </section>

        <section className="card card-pad stack">
          <h3>Signs it's time</h3>
          <ul className="ss-list">
            <li>Rubbing eyes, pulling ears, or zoning out</li>
            <li>Yawning and slower movements</li>
            <li>Fussing that a feed or diaper doesn't fix</li>
            <li>Turning away from toys or faces</li>
          </ul>
          <p className="xs muted">Every feature here is free. No trial, no paywall, no upsell.</p>
        </section>
      </main>
      <ScheduleCreatorSheet open={schedule} child={child} onClose={() => setSchedule(false)} />
    </>
  )
}
