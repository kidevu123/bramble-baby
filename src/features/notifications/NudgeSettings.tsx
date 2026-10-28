import type { ReactNode } from 'react'
import { ChevronRightIcon } from '../../components/icons'
import { Segmented } from '../../components/ui/Segmented'
import { Toggle } from '../../components/ui/Toggle'
import { usePrefs } from '../../hooks/usePrefs'
import { describeApiError } from '../../lib/api/client'
import type { NudgeKind, NudgeSettings as Settings } from '../../lib/api/companion'
import type { Id } from '../../lib/api/types'
import { clockLabel, describePlan, PUMP_CADENCES, pumpCadenceValue } from '../../lib/nudges'
import { useNudges } from './useNudges'
import './notifications.css'

/**
 * Settings › Notifications: the data-driven reminders the companion computes from what was logged, each
 * with on/off and the server's own one-line plan ("Next: 5:40 PM · every 2 h 50 min lately, from 7 feeds").
 * Shared by the household: the server reads these, so every phone sees the same switches.
 *
 * The sheet shows what changes from day to day (the switch and the plan line); how each reminder decides
 * when to go out is one tap away under "How each one works", so the eight switches fit on little more
 * than a screen.
 */
export function NudgeSettings({ child, childName }: { child: Id | null; childName: string }) {
  const { prefs } = usePrefs()
  const { status, settings, update, isLoading, isError, error } = useNudges(child)
  // The push text uses the units of the phone that last touched Settings; send ours along with every change.
  const set = (patch: Partial<Settings>) => update({ ...patch, units: { volume: prefs.units.volume, weight: prefs.units.weight } })
  const plan = (kind: NudgeKind) => describePlan(status?.next[kind], settings[kind])

  if (child === null) return null
  const how: [string, string][] = [
    ['Feeding due', `From ${childName}'s own gaps between feeds, inside the typical range for the age. One push per gap; logging a feed cancels it.`],
    ['Pump due', 'To the phone of whoever logs the pumping, with the stash total. Every: Auto follows the last sessions; a fixed time overrides it.'],
    ['Milk expiring', 'Before a bag runs out and when it has. A feeding push also names the bag to open first when one runs out within the day.'],
    ['No wet diaper', 'Well past the typical interval for the age, the same numbers as the Home card. Comes through in quiet hours.'],
    ['Evening summary', 'One line each for feeds, diapers, sleep, pumping and the stash, at the time you pick.'],
    ['Weight from the Hatch', 'When a weighing lands, with the change since the last one. During quiet hours it waits for the morning.'],
    ['Pumping down', 'When each of the last three days comes in well under the daily average of the two weeks before. A day with nothing logged does not count as a drop. To the phone of whoever pumps, at most once every three days; the tap opens Reports.'],
    ['When the other person logs', 'A short push to the other phones the moment someone saves a feed, a pump, a diaper or a sleep, so nobody logs it twice or asks. Never to the phone that logged it, never in quiet hours.'],
    ['A tap on a push', 'Opens Bramble on the matching log sheet, for just now.'],
  ]
  return (
    <div className="stack nudges" data-testid="nudge-settings">
      {isError ? (
        <p className="small text-health" role="alert">
          Could not load the reminder settings: {describeApiError(error)}
        </p>
      ) : null}
      {status?.problem ? (
        <p className="small text-health" role="alert">
          {status.problem.message}
        </p>
      ) : null}

      <NudgeGroup title="Reminders">
        <NudgeRow title="Feeding due" detail={plan('feed')} on={settings.feed} onChange={(v) => set({ feed: v })} />
        <NudgeRow title="Pump due" detail={plan('pump')} on={settings.pump} onChange={(v) => set({ pump: v })}>
          {settings.pump ? (
            <div className="nudge-sub">
              <span className="xs muted">Every</span>
              <Segmented label="Pump cadence" size="sm" options={PUMP_CADENCES.map((c) => ({ value: c.value, label: c.label }))} value={pumpCadenceValue(settings.pumpEveryMinutes)} onChange={(v) => set({ pumpEveryMinutes: PUMP_CADENCES.find((c) => c.value === v)?.minutes ?? null })} />
            </div>
          ) : null}
        </NudgeRow>
        <NudgeRow title="Milk expiring" detail={settings.milk ? 'Before a bag runs out, and when it has' : 'Off'} on={settings.milk} onChange={(v) => set({ milk: v })} />
        <NudgeRow title="No wet diaper" detail={plan('diaper')} on={settings.diaper} onChange={(v) => set({ diaper: v })} />
      </NudgeGroup>

      <NudgeGroup title="Updates">
        <NudgeRow title="Evening summary" detail={plan('summary')} on={settings.summary} onChange={(v) => set({ summary: v })}>
          {settings.summary ? (
            <div className="nudge-sub">
              <label className="xs muted" htmlFor="nudge-summary-at">
                At
              </label>
              <input id="nudge-summary-at" className="text-input nudge-time" type="time" value={settings.summaryAt} onChange={(e) => e.target.value && set({ summaryAt: e.target.value })} />
            </div>
          ) : null}
        </NudgeRow>
        <NudgeRow title="Weight from the Hatch" detail={plan('weight')} on={settings.weight} onChange={(v) => set({ weight: v })} />
        <NudgeRow title="Pumping down" detail={plan('supply')} on={settings.supply} onChange={(v) => set({ supply: v })} />
        <NudgeRow title="When the other person logs" detail={plan('activity')} on={settings.activity} onChange={(v) => set({ activity: v })} />
      </NudgeGroup>

      <NudgeGroup title="Quiet hours">
        <div className="nudge-quiet">
          <input className="text-input nudge-time" type="time" value={settings.quietStart} aria-label="Quiet hours start" onChange={(e) => e.target.value && set({ quietStart: e.target.value })} />
          <span className="nudge-quiet-to" aria-hidden>
            to
          </span>
          <input className="text-input nudge-time" type="time" value={settings.quietEnd} aria-label="Quiet hours end" onChange={(e) => e.target.value && set({ quietEnd: e.target.value })} />
        </div>
        <p className="xs muted nudge-quiet-note">
          Nothing between {clockLabel(settings.quietStart)} and {clockLabel(settings.quietEnd)} but the wet-diaper check; a weight waits for the morning.
        </p>
      </NudgeGroup>

      <details className="nudge-how">
        <summary>
          How each one works <ChevronRightIcon aria-hidden />
        </summary>
        <dl className="nudge-how-list">
          {how.map(([title, text]) => (
            <div key={title}>
              <dt>{title}</dt>
              <dd className="small muted">{text}</dd>
            </div>
          ))}
        </dl>
      </details>

      <p className="xs muted" data-testid="nudge-status">
        {isLoading ? 'Checking with the server…' : status?.armed ? `Shared by every phone in the household · worked out from Baby Buddy every two minutes${status.lastRun ? `, last ${new Date(status.lastRun).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}.` : 'The server is not reading Baby Buddy yet; opening this screen once arms it.'}
      </p>
    </div>
  )
}

function NudgeGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="stack nudge-group" aria-label={title}>
      <h3 className="nudge-group-title">{title}</h3>
      <div className="card nudge-list">{children}</div>
    </section>
  )
}

function NudgeRow({ title, detail, on, onChange, children }: { title: string; detail: string; on: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div className={`nudge-row${on ? '' : ' off'}`}>
      <div className="nudge-row-main">
        <span className="grow nudge-row-text">
          <span className="nudge-row-title">{title}</span>
          <span className="xs nudge-row-detail">{detail}</span>
        </span>
        <Toggle checked={on} onChange={onChange} label={title} />
      </div>
      {children}
    </div>
  )
}
