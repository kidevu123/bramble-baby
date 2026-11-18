import { differenceInCalendarDays, startOfDay, subDays } from 'date-fns'
import { useMemo, useState } from 'react'
import { CheckIcon, TummyIcon } from '../../components/icons'
import { TopBar } from '../../components/nav/TopBar'
import { About } from '../../components/ui/About'
import { Button } from '../../components/ui/Button'
import { useChildren } from '../../hooks/useChildren'
import { useChildSettings } from '../../hooks/useChildSettings'
import { useCompanionEvents, useInvalidateCompanion } from '../../hooks/useCompanionEvents'
import { rangeDays, useChildEvents } from '../../hooks/useEvents'
import { describeApiError } from '../../lib/api/client'
import { companion, type Activity } from '../../lib/api/companion'
import { withCaregiverTag } from '../../lib/caregiver'
import { isExpecting } from '../../lib/child'
import { areaLabel, areaTally, dayKey, doneOn, ideaTag, nextStage, PLAY_AREAS, PLAY_SOURCES, stageFor, todaysIdeas, tummyGuide, TUMMY_UNTIL_MONTHS, type PlayIdea, type PlaySourceId } from '../../lib/play'
import { ageBasis, ageHold, judgedMonths, normsFrom } from '../../lib/preterm'
import { formatDurationShort, formatTime, parseDate, secondsBetween } from '../../lib/time'
import { LogSheet, type LogRequest } from '../log/LogSheet'
import './play.css'

/**
 * Play: things to do with the child at their age. Three for today (a different area each, changing daily), tummy
 * time against the AAP's figure while it applies, what was done this week by area, and every idea for the age.
 * "Did it" logs an ordinary Play activity tagged with the idea, so it is on the timeline and in Reports like any
 * other; nothing is scored. The ideas and their sources live in `src/lib/play.ts`.
 */
export function PlayPage() {
  const { child } = useChildren()
  const { settings } = useChildSettings(child?.id ?? null)
  const now = useMemo(() => new Date(), [])
  const since = useMemo(() => startOfDay(subDays(now, 6)).toISOString(), [now])
  const logged = useCompanionEvents(child?.id ?? null, since)
  const todayRange = useMemo(() => rangeDays(1, now), [now])
  const events = useChildEvents(child?.id ?? null, todayRange)
  const invalidate = useInvalidateCompanion()
  const [turn, setTurn] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [request, setRequest] = useState<LogRequest | null>(null)
  if (!child) return null

  if (isExpecting(child, now)) {
    return (
      <>
        <TopBar title="Play" />
        <main className="page">
          <p className="card card-pad">Play ideas start the day {child.first_name} is born.</p>
        </main>
      </>
    )
  }

  const basis = ageBasis(child, settings)
  const hold = ageHold(basis, now)
  const months = judgedMonths(basis, now) // corrected age for a baby born early
  const ageDays = differenceInCalendarDays(now, parseDate(normsFrom(basis, now)))
  const stage = stageFor(months)
  const coming = nextStage(stage)
  const today = dayKey(now)
  const picks = todaysIdeas(stage, today, child.id, 3, turn)
  const plays = logged.activities.filter((a) => a.type === 'play')
  const done = doneOn(plays, today)
  const tally = areaTally(plays, now)
  const tummySeconds = events.tummy.reduce((sum, t) => sum + Math.max(0, secondsBetween(t.start, t.end)), 0)

  const act = async (key: string, fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(key)
    setError(null)
    try {
      await fn()
      invalidate(child.id)
    } catch (err) {
      setError(describeApiError(err))
    } finally {
      setBusy(null)
    }
  }
  const did = (idea: PlayIdea) =>
    act(idea.id, () => companion.activities.create(withCaregiverTag({ child: child.id, type: 'play', start: new Date().toISOString(), end: null, notes: idea.title, tags: [ideaTag(idea.id)] }) as Omit<Activity, 'id'>))
  const undo = (idea: PlayIdea, entry: Activity) => act(idea.id, () => companion.activities.remove(entry.id))

  const card = (idea: PlayIdea, compact = false) => {
    const entry = done.get(idea.id)
    return (
      <article key={idea.id} className={compact ? 'play-idea compact' : 'card card-pad play-idea'} data-area={idea.area} data-testid={compact ? 'play-row' : 'play-today'}>
        {compact ? null : (
          <p className="play-area">
            <span className="play-dot" aria-hidden /> {areaLabel(idea.area)}
          </p>
        )}
        <h3 className="play-title">{idea.title}</h3>
        <p className="play-text">{idea.text}</p>
        {idea.why ? <p className="small muted play-why">{idea.why}</p> : null}
        <div className="play-foot">
          {entry ? (
            <>
              <span className="play-done" data-testid="play-done">
                <CheckIcon className="play-check" aria-hidden /> Done {formatTime(entry.start)}
              </span>
              <button type="button" className="link-btn" disabled={busy !== null} onClick={() => undo(idea, entry)}>
                Undo
              </button>
            </>
          ) : (
            <Button variant={compact ? 'outline' : 'primary'} onClick={() => did(idea)} loading={busy === idea.id} disabled={busy !== null && busy !== idea.id} aria-label={`Did it: ${idea.title}`}>
              Did it
            </Button>
          )}
        </div>
      </article>
    )
  }

  const sources = [...new Set(stage.ideas.flatMap((i) => i.src))] as PlaySourceId[]

  return (
    <>
      <TopBar title="Play" />
      <main className="page play-page">
        {hold ? (
          <section className="card card-pad stack" data-testid="play-hold">
            <h2>Play with {child.first_name}</h2>
            <p>
              {hold === 'nicu'
                ? `While ${child.first_name} is in the NICU, the team there is the guide to what is right for each day: ask the nurses what you can do together. The ideas by age start once the stay is marked as over in Settings.`
                : `The ideas by age count from ${child.first_name}'s due date, so they start then. Until that day, ask the pediatrician what is right for a baby born early.`}
            </p>
          </section>
        ) : (
          <>
            <section className="play-hero">
              <p className="xs muted play-kicker" data-testid="play-stage">
                {stage.label} · {stage.from_list}
              </p>
              <h2>Today with {child.first_name}</h2>
              <p className="small muted">Three things to try, a different kind each. Do them in any order, or not at all: nothing here is scored.</p>
            </section>

            {error ? (
              <p className="log-error" role="alert">
                {error}
              </p>
            ) : null}

            {picks.map((idea) => card(idea))}

            {stage.ideas.length > 3 ? (
              <button type="button" className="link-btn play-others" data-testid="play-others" onClick={() => setTurn(turn + 1)}>
                Three others
              </button>
            ) : null}

            {months < TUMMY_UNTIL_MONTHS ? (
              <button type="button" className="card card-pad play-tummy" data-testid="play-tummy" onClick={() => setRequest({ kind: 'tummy' })}>
                <span className="icon-circle tone-tummy" aria-hidden>
                  <TummyIcon />
                </span>
                <span className="grow">
                  <span className="strong play-tummy-line">Tummy time today · {tummySeconds >= 60 ? formatDurationShort(tummySeconds) : 'none logged'}</span>
                  <span className="small muted play-tummy-guide">{tummyGuide(ageDays)} Awake and watched. Tap to log some.</span>
                </span>
              </button>
            ) : null}

            <section className="card card-pad stack" data-testid="play-week">
              <h3>The last 7 days</h3>
              <div className="play-tally">
                {PLAY_AREAS.map((a) => (
                  <div key={a.id} className="play-tally-cell" data-area={a.id}>
                    <span className="play-tally-n">
                      <span className="play-dot" aria-hidden /> {tally[a.id]}
                    </span>
                    <span className="xs muted">{a.label}</span>
                  </div>
                ))}
              </div>
              <p className="xs muted">{tally.total === 0 ? 'Tap Did it on an idea and it counts here, and shows on the timeline as Play.' : 'Ideas marked as done, by kind. A count, not a target.'}</p>
            </section>

            <section className="stack" data-testid="play-all">
              <h3 className="play-all-title">
                All {stage.ideas.length} ideas for {stage.label.toLowerCase()}
              </h3>
              {PLAY_AREAS.map((a) => {
                const ideas = stage.ideas.filter((i) => i.area === a.id)
                if (ideas.length === 0) return null
                return (
                  <details key={a.id} className="card play-group" data-area={a.id}>
                    <summary className="play-group-head">
                      <span className="play-dot" aria-hidden />
                      <span className="grow">
                        <span className="strong">{a.label}</span>
                        <span className="xs muted play-group-about">{a.about}</span>
                      </span>
                      <span className="small muted">{ideas.length}</span>
                    </summary>
                    <div className="play-group-body">{ideas.map((i) => card(i, true))}</div>
                  </details>
                )
              })}
            </section>

            {coming ? (
              <details className="card play-group" data-testid="play-next">
                <summary className="play-group-head">
                  <span className="grow">
                    <span className="strong">Coming next: {coming.label.toLowerCase()}</span>
                    <span className="xs muted play-group-about">
                      {coming.ideas.length} ideas, from {coming.from === 24 ? '2 years' : coming.from >= 36 ? `${coming.from / 12} years` : `${coming.from} months`}
                    </span>
                  </span>
                </summary>
                <ul className="play-next-list">
                  {coming.ideas.map((i) => (
                    <li key={i.id}>{i.title}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}

        <About label="About these ideas" testId="play-about">
          <p>
            From 2 months, each idea is one of CDC's own "What you can do" tips for the age, in CDC's words with only "he" and "she" made neutral. Before 2 months CDC has no list, so the ideas are written from the NHS's pages for babies from
            birth and the AAP's page on tummy time. The tips CDC gives about feeding, sleep, safety and behaviour are not play and are left to What to expect on the Child tab.
          </p>
          <p>
            These are things to enjoy together, not a programme to finish. Bramble counts what you marked and judges nothing; whether {child.first_name} is developing as expected is what the milestone checklist and the pediatrician are for.
          </p>
          <p>For a baby born early, the age is counted from the due date. CDC's lists say screen time is not recommended under 2, other than video calls with loved ones: babies learn by talking, playing and interacting with others.</p>
          <ul className="play-sources">
            {sources.map((id) => (
              <li key={id}>
                <a href={PLAY_SOURCES[id].url} target="_blank" rel="noreferrer">
                  {PLAY_SOURCES[id].label}
                </a>
              </li>
            ))}
          </ul>
          <p className="xs muted">
            CDC's material is in the public domain and free at cdc.gov; its use here does not mean CDC or the U.S. government endorses Bramble. Contains public sector information licensed under the Open Government Licence v3.0. Not medical advice.
          </p>
        </About>
      </main>
      <LogSheet request={request} child={child} onClose={() => setRequest(null)} />
    </>
  )
}
