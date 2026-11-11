import { format } from 'date-fns'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons'
import { TopBar } from '../../components/nav/TopBar'
import { About } from '../../components/ui/About'
import { useChildren } from '../../hooks/useChildren'
import { useChildSettings } from '../../hooks/useChildSettings'
import { useLoggedMilestones } from '../../hooks/useCompanionEvents'
import { isExpecting } from '../../lib/child'
import { entrySources, GUIDE, guideIndexFor, notYetFor, periodMonths, periodText, type GuideLine } from '../../lib/guide'
import { ageBasis, ageHold } from '../../lib/preterm'
import { parseDate } from '../../lib/time'
import { LogSheet, type LogRequest } from '../log/LogSheet'
import { MilestoneChecklist, PeriodChecklists } from '../reports/MilestoneChecklist'
import '../reports/summary.css'
import './guide.css'

/**
 * What to expect: the child's age week by week for the first three months, then month by month and by CDC's
 * checklist ages. It opens on the period the child is in; the strip and the arrows browse the others. Each period
 * says what to look for and how to see it (something to try, from the same pages), what is normal even though it
 * worries parents, what is too early to expect, what feeding and sleep look like, what helps, the check-up due and when to call,
 * and carries CDC's checklist for that age, where what has been seen is marked. Reached from the Child tab.
 */
export function GuidePage() {
  const { child } = useChildren()
  const now = useMemo(() => new Date(), [])
  const { settings } = useChildSettings(child?.id ?? null)
  const logged = useLoggedMilestones(child?.id ?? null)
  const [picked, setPicked] = useState<number | null>(null)
  const [request, setRequest] = useState<LogRequest | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const basis = child ? ageBasis(child, settings) : null
  const current = basis ? guideIndexFor(basis, now) : 0
  const index = picked ?? current
  // The chosen period sits in the middle of the strip, the current one included when the page opens.
  useEffect(() => {
    const chip = strip.current?.querySelector<HTMLElement>('[aria-current="true"], [aria-pressed="true"]')
    const row = strip.current
    if (chip && row) row.scrollLeft = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2
  }, [index, child?.id])
  if (!child || !basis) return null
  if (isExpecting(child, now)) {
    return (
      <>
        <TopBar title="What to expect" right="none" back />
        <main className="page">
          <p className="card card-pad">The guide starts the day {child.first_name} is born.</p>
        </main>
      </>
    )
  }
  const entry = GUIDE[index]
  const notYet = notYetFor(entry)
  const isNow = index === current
  const hold = ageHold(basis, now)
  const go = (i: number) => {
    setPicked(i)
    window.scrollTo(0, 0)
  }

  return (
    <>
      <TopBar title="What to expect" right="none" back />
      <main className="page guide-page">
        <div className="guide-strip" ref={strip} role="group" aria-label="Age">
          {GUIDE.map((e, i) => (
            <button key={e.id} type="button" className={`guide-chip${i === index ? ' active' : ''}${i === current ? ' is-now' : ''}`} aria-pressed={i === index} aria-current={i === index ? 'true' : undefined} aria-label={i === current ? `${e.title}, now` : e.title} onClick={() => go(i)}>
              {e.short}
            </button>
          ))}
        </div>

        <section className="card card-pad guide-head" data-testid="guide-head">
          <p className="guide-when">
            {isNow ? <span className="guide-now">Now</span> : null}
            <span>{periodText(entry, basis, now)}</span>
          </p>
          <h1 className="guide-title">{entry.title}</h1>
          <p className="guide-headline">{entry.headline}</p>
          {basis.due ? (
            <p className="small muted" data-testid="guide-corrected">
              Counted from the due date, {format(parseDate(basis.due), 'MMM d, yyyy')}, as doctors do for a baby born early.
            </p>
          ) : null}
          {hold === 'nicu' ? <p className="small muted">In the NICU the unit sets the plan. This describes babies at home.</p> : null}
        </section>

        <Lines title="What to look for" lines={entry.notice} testId="guide-notice" />
        {entry.normal ? <Lines title="Normal, even if it worries you" lines={entry.normal} tone="normal" testId="guide-normal" /> : null}
        {notYet.length ? <Lines title="Not yet" lead="Too early to expect, so no need to watch for it:" lines={notYet} tone="later" testId="guide-not-yet" /> : null}
        {entry.care ? <Lines title="Feeding and sleep" lines={entry.care} testId="guide-care" /> : null}
        <Lines title="What helps" lines={entry.helps} testId="guide-helps" />
        {entry.visit ? <Lines title="Check-ups" lines={entry.visit} testId="guide-visit" /> : null}
        {entry.you ? <Lines title="For you" lines={entry.you} testId="guide-you" /> : null}
        {entry.call ? <Lines title="Call the doctor" lines={entry.call} tone="call" testId="guide-call" /> : null}

        <section className="card card-pad guide-about-card">
          <About label="Where this comes from" testId="guide-about">
            <p>
              Babies do not grow on a weekly timetable. Each line gives the range doctors describe, placed in the week or month where that range begins or centres. Early or late by a few weeks is usual; what {child.first_name} has been seen to do is
              marked on the checklist below.
            </p>
            <p>This period draws on:</p>
            <ul className="guide-sources">
              {entrySources(entry).map((s) => (
                <li key={s.id}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
            <p>It is general information, not advice about {child.first_name}. Your pediatrician knows your child.</p>
          </About>
        </section>

        <h2 className="guide-section-title">The checklist for this age</h2>
        {isNow ? <MilestoneChecklist child={child} age={basis} now={now} logged={logged} onLog={setRequest} /> : <PeriodChecklists months={periodMonths(entry)} now={now} logged={logged} onLog={setRequest} />}

        <nav className="guide-pager" aria-label="Other ages">
          {index > 0 ? (
            <button type="button" className="guide-step" onClick={() => go(index - 1)}>
              <ChevronLeftIcon aria-hidden />
              <span>{GUIDE[index - 1].title}</span>
            </button>
          ) : (
            <span />
          )}
          {index < GUIDE.length - 1 ? (
            <button type="button" className="guide-step guide-step-next" onClick={() => go(index + 1)}>
              <span>{GUIDE[index + 1].title}</span>
              <ChevronRightIcon aria-hidden />
            </button>
          ) : (
            <span />
          )}
        </nav>
        {!isNow ? (
          <button type="button" className="link-btn guide-back-now" onClick={() => go(current)}>
            Back to {GUIDE[current].title}
          </button>
        ) : null}
      </main>
      <LogSheet request={request} child={child} onClose={() => setRequest(null)} />
    </>
  )
}

function Lines({ title, lead, lines, tone, testId }: { title: string; /** A sentence under the title that the lines complete. */ lead?: string; lines: GuideLine[]; tone?: 'call' | 'normal' | 'later'; testId: string }) {
  return (
    <section className={tone ? `card card-pad guide-lines is-${tone}` : 'card card-pad guide-lines'} data-testid={testId}>
      <h2>{title}</h2>
      {lead ? <p className="guide-lead">{lead}</p> : null}
      <ul>
        {lines.map((line) => (
          <li key={line.text}>
            {line.text}
            {line.how ? <span className="guide-how">{line.how}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
