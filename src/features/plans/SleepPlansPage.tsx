import { useMemo, useState } from 'react'
import { TopBar } from '../../components/nav/TopBar'
import { Button } from '../../components/ui/Button'
import { useChildren } from '../../hooks/useChildren'
import { useChildSettings } from '../../hooks/useChildSettings'
import { rangeDays, useChildEvents } from '../../hooks/useEvents'
import { ageBasis, judgedMonths } from '../../lib/preterm'
import { isExpecting } from '../../lib/child'
import { generatePlan, QUESTIONNAIRE, type Answers } from '../../lib/sleepplan'
import { Questionnaire } from './Questionnaire'
import './plans.css'

export function SleepPlansPage() {
  const { child } = useChildren()
  const { settings, update } = useChildSettings(child?.id ?? null)
  const now = useMemo(() => new Date(), [])
  const range = useMemo(() => rangeDays(14, now), [now])
  const events = useChildEvents(child?.id ?? null, range)
  const stored = settings.sleepPlanAnswers as Answers | undefined
  const [editing, setEditing] = useState(false)
  if (!child) return null

  const months = judgedMonths(ageBasis(child, settings), now) // corrected age for a baby born early
  const expecting = isExpecting(child, now)
  const plan = stored && !editing ? generatePlan({ ageMonths: months, answers: stored, events, now, childName: child.first_name }) : null

  const save = (answers: Answers) => {
    update({ sleepPlanAnswers: answers })
    setEditing(false)
    // "Build my plan" sits at the foot of a long questionnaire; the plan it builds starts at the top.
    window.scrollTo(0, 0)
  }

  return (
    <>
      <TopBar title="Sleep Plans" />
      <main className="page">
        {expecting ? (
          <section className="plan-hero card">
            <h2>Sleep starts before day one</h2>
            <p>Once {child.first_name} arrives, answer a short questionnaire and Bramble builds a personalized plan from real sleep data. For now, explore safe-sleep prep in Insights.</p>
          </section>
        ) : !plan ? (
          <>
            <section className="plan-hero card">
              <h2>Get better sleep now</h2>
              <p>Answer a two-minute questionnaire: Bramble adds {child.first_name}'s logged sleep and builds an age-appropriate plan, free.</p>
            </section>
            <Questionnaire questions={QUESTIONNAIRE} initial={stored ?? {}} onSubmit={save} onCancel={stored ? () => setEditing(false) : undefined} />
          </>
        ) : (
          <>
            <section className="plan-hero card">
              <p className="plan-stage">{plan.ageStage}</p>
              <h2>{plan.title}</h2>
              <p>{plan.summary}</p>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Update questionnaire
              </Button>
            </section>

            <section className="card card-pad stack">
              <h3>Suggested day</h3>
              <ul className="plan-schedule">
                {plan.schedule.map((s, i) => (
                  <li key={i} className={`plan-slot kind-${s.kind}`}>
                    <span className="plan-slot-time">
                      {s.start}
                      {s.end ? ` – ${s.end}` : ''}
                    </span>
                    <span className="grow">
                      <span className="strong">{s.label}</span>
                      {s.note ? <span className="xs muted" style={{ display: 'block' }}>{s.note}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card card-pad stack">
              <h3>Your plan</h3>
              <ol className="plan-steps">
                {plan.steps.map((st, i) => (
                  <li key={i}>
                    <span className="strong">{st.title}</span>
                    <p className="small">{st.detail}</p>
                  </li>
                ))}
              </ol>
            </section>

            <section className="card card-pad stack">
              <h3>{plan.method.name}</h3>
              <p className="small">{plan.method.description}</p>
              <p className="section-title">Night wakings</p>
              <ol className="plan-steps compact">
                {plan.method.nightWakingProtocol.map((p, i) => (
                  <li key={i} className="small">
                    {p}
                  </li>
                ))}
              </ol>
            </section>

            <section className="card card-pad stack">
              <h3>Naps</h3>
              <ul className="plan-bullets">
                {plan.naps.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              <h3>Sleep space</h3>
              <ul className="plan-bullets">
                {plan.environment.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              <h3>What to expect</h3>
              <p className="small">{plan.expectations}</p>
            </section>

            <section className="card card-pad stack plan-safety">
              <h3>Safe sleep</h3>
              <ul className="plan-bullets">
                {plan.safety.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              <p className="xs muted">General guidance, not medical advice. Talk to your pediatrician about anything specific to {child.first_name}.</p>
            </section>
          </>
        )}
      </main>
    </>
  )
}
