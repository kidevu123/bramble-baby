import { format } from 'date-fns'
import { CheckIcon, ChevronDownIcon } from '../../components/icons'
import { About } from '../../components/ui/About'
import type { Milestone } from '../../lib/api/companion'
import type { Child } from '../../lib/api/types'
import type { TimelineItem } from '../../lib/events'
import {
  checklistLine,
  checklistsFor,
  checkpointDay,
  checkpointProgress,
  DOMAINS,
  HEARING_BY_MONTHS,
  HEARING_TITLE,
  hearingFollowUp,
  loggedByTitle,
  NICU_HEARING_DAYS,
  screeningLine,
  seenEntry,
  titleKey,
  type Checkpoint,
  type ChecklistItem,
} from '../../lib/milestones'
import { ageHold, holdNote, judgedMonths, type AgeBasis } from '../../lib/preterm'
import { parseDate } from '../../lib/time'
import type { LogRequest } from '../log/LogSheet'
import './milestones.css'

const day = (iso: string, now: Date) => {
  const d = parseDate(iso)
  return format(d, d.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy')
}

/** A logged milestone as the log sheet takes it for editing. */
export function milestoneItem(m: Milestone): TimelineItem {
  const at = parseDate(m.date)
  at.setHours(12, 0, 0, 0)
  return { key: `milestone-${m.id}`, kind: 'milestones', at, end: null, title: 'Milestone', detail: m.title, raw: m }
}

/**
 * The guide's checklist for the child's own age (Child tab › What to expect): CDC's list. The list whose age has been reached leads
 * (before 2 months, the first one, as what is coming); a tap on an item logs it as seen, or opens the entry that
 * marked it. The next list and the earlier ones are folded under it.
 */
export function MilestoneChecklist({ child, age, now, logged, onLog }: { child: Child; age: AgeBasis; now: Date; logged: Milestone[]; onLog: (request: LogRequest) => void }) {
  const months = judgedMonths(age, now)
  const hold = ageHold(age, now)
  const { due, next, earlier } = checklistsFor(months)
  const byTitle = loggedByTitle(logged)
  const main = due ?? next
  if (!main) return null
  const progress = checkpointProgress(main, byTitle)
  const line = checklistLine(due, due ? progress : null, child.first_name, hold !== null)
  const screening = screeningLine(main)
  const hearing = hearingFollowUp(age, months, now)
  const hearingDone = byTitle.get(titleKey(HEARING_TITLE)) ?? null
  const open = (item: ChecklistItem) => {
    const entry = seenEntry(item, byTitle)
    onLog(entry ? { kind: 'milestones', editing: milestoneItem(entry) } : { kind: 'milestones', milestone: { title: item.text, category: item.domain } })
  }

  return (
    <>
      <section className="card card-pad stack" data-testid="milestone-checklist">
        <h3>{due ? `By ${main.label}` : `Coming up by ${main.label}`}</h3>
        <div className="stat-grid">
          {/* Green once the due list is complete; an unmarked item is not a missed one, so no red edge. */}
          <div className={due && !hold && progress.missing.length === 0 ? 'stat is-met' : 'stat'} data-testid="ms-seen">
            <span className="stat-name">Seen</span>
            <span className="stat-value">
              {progress.seen} of {progress.total}
            </span>
            <span className="stat-detail">on the {main.adjective} list</span>
          </div>
          {due && next ? (
            <div className="stat" data-testid="ms-next">
              <span className="stat-name">Next list</span>
              <span className="stat-value">{next.label}</span>
              <span className="stat-detail">from {checkpointDay(next, age, now)}</span>
            </div>
          ) : !due ? (
            <div className="stat" data-testid="ms-next">
              <span className="stat-name">Most babies by</span>
              <span className="stat-value">{checkpointDay(main, age, now)}</span>
              <span className="stat-detail">{main.label} old</span>
            </div>
          ) : null}
        </div>
        {hold ? (
          <p className="typical-line" data-testid="ms-line">
            {holdNote(hold)} Mark what you see; the list is here for the day it counts.
          </p>
        ) : line ? (
          <p className={line.tone === 'ask' ? 'typical-line is-low' : 'typical-line'} data-testid="ms-line">
            {line.text}
          </p>
        ) : (
          <p className="typical-line" data-testid="ms-line">
            Most babies do these by {main.label}. Mark each one as you see it.
          </p>
        )}
        {screening ? (
          <p className="ms-note" data-testid="ms-screening">
            {screening}
          </p>
        ) : null}
        {hearing ? (
          <button
            type="button"
            className={hearingDone ? 'ms-hearing is-done' : months >= HEARING_BY_MONTHS ? 'ms-hearing is-late' : 'ms-hearing'}
            data-testid="ms-hearing"
            onClick={() => onLog(hearingDone ? { kind: 'milestones', editing: milestoneItem(hearingDone) } : { kind: 'milestones', milestone: { title: HEARING_TITLE, category: 'other' } })}
          >
            <span className="ms-check" aria-hidden>
              {hearingDone ? <CheckIcon /> : null}
            </span>
            <span className="grow">
              <span className="ms-text">{hearingDone ? `Hearing follow-up done · ${day(hearingDone.date, now)}` : `Hearing test by ${HEARING_BY_MONTHS} months`}</span>
              {hearingDone ? null : (
                <span className="ms-eg">
                  A NICU stay of {NICU_HEARING_DAYS} days or more calls for a follow-up hearing test, even after a passed newborn screen. Ask the doctor to book it; tap here when it is done.
                </span>
              )}
            </span>
          </button>
        ) : null}
        <ItemGroups checkpoint={main} byTitle={byTitle} now={now} onOpen={open} />
        <About label="About these lists" testId="ms-about">
          <p>
            These are the checklists of CDC&rsquo;s &ldquo;Learn the Signs. Act Early.&rdquo; program, revised with the American Academy of Pediatrics in 2022. Each item is something at least 3 in 4 children do by that age, so one unmarked
            item is common. It is a reason to mention it to the doctor, not a diagnosis.
          </p>
          {age.due ? <p>For a baby born early the lists count from the due date until the second birthday.</p> : null}
          <p>
            <strong>Call the doctor without waiting</strong> if {child.first_name} loses a skill at any age, has no gestures such as pointing or waving by 12 months, no single words by 16 months, or no two-word phrases by 24 months. In the
            WHO&rsquo;s study 99 of 100 healthy children sat without support by 9.2 months and walked alone by 17.6 months.
          </p>
          <p>The lists are for noticing. The screening questionnaires at the 9, 18 and 30 month visits, and the autism screening at 18 and 24 months, are the tests. In the US a parent can also call the state&rsquo;s early intervention program for a free evaluation without a referral.</p>
        </About>
      </section>
      {due && next ? <Fold checkpoint={next} title={`Coming up by ${next.label}`} byTitle={byTitle} now={now} onOpen={open} testId="ms-upcoming" /> : null}
      {earlier.map((cp) => (
        <Fold key={cp.months} checkpoint={cp} title={`The ${cp.adjective} list`} byTitle={byTitle} now={now} onOpen={open} testId={`ms-earlier-${cp.months}`} />
      ))}
    </>
  )
}

/**
 * The lists beside another age in the guide (not the child's own, which `MilestoneChecklist` shows with its line to act
 * on): the list reached by that age, open, and the one coming after it, folded. Marking works the same way.
 */
export function PeriodChecklists({ months, now, logged, onLog }: { months: number; now: Date; logged: Milestone[]; onLog: (request: LogRequest) => void }) {
  const { due, next } = checklistsFor(months)
  const byTitle = loggedByTitle(logged)
  const open = (item: ChecklistItem) => {
    const entry = seenEntry(item, byTitle)
    onLog(entry ? { kind: 'milestones', editing: milestoneItem(entry) } : { kind: 'milestones', milestone: { title: item.text, category: item.domain } })
  }
  return (
    <>
      {due ? <Fold checkpoint={due} title={`By ${due.label}`} byTitle={byTitle} now={now} onOpen={open} testId="ms-period-due" open /> : null}
      {next ? <Fold checkpoint={next} title={`Coming up by ${next.label}`} byTitle={byTitle} now={now} onOpen={open} testId="ms-period-next" open={!due} /> : null}
    </>
  )
}

function ItemGroups({ checkpoint, byTitle, now, onOpen }: { checkpoint: Checkpoint; byTitle: Map<string, Milestone>; now: Date; onOpen: (item: ChecklistItem) => void }) {
  return (
    <>
      {DOMAINS.map((d) => {
        const items = checkpoint.items.filter((i) => i.domain === d.key)
        if (!items.length) return null
        return (
          <div key={d.key} className="ms-group">
            <h4 className="ms-domain">{d.label}</h4>
            <ul className="ms-list">
              {items.map((item) => {
                const entry = seenEntry(item, byTitle)
                return (
                  <li key={item.text}>
                    <button type="button" className={entry ? 'ms-row is-seen' : 'ms-row'} aria-pressed={entry !== null} onClick={() => onOpen(item)}>
                      <span className="ms-check" aria-hidden>
                        {entry ? <CheckIcon /> : null}
                      </span>
                      <span className="grow">
                        <span className="ms-text">{item.text}</span>
                        {item.eg ? <span className="ms-eg">{item.eg}</span> : null}
                      </span>
                      {entry ? <span className="ms-date">{day(entry.date, now)}</span> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </>
  )
}

/** Another age's list, closed until asked for: its name and how much of it is marked. */
function Fold({ checkpoint, title, byTitle, now, onOpen, testId, open = false }: { checkpoint: Checkpoint; title: string; byTitle: Map<string, Milestone>; now: Date; onOpen: (item: ChecklistItem) => void; testId: string; open?: boolean }) {
  const p = checkpointProgress(checkpoint, byTitle)
  return (
    <details className="card ms-fold" data-testid={testId} open={open}>
      <summary className="ms-fold-summary">
        <span className="grow strong">{title}</span>
        <span className="small muted">
          {p.seen} of {p.total} seen
        </span>
        <ChevronDownIcon className="ms-fold-chev" aria-hidden />
      </summary>
      <div className="ms-fold-body stack">
        <ItemGroups checkpoint={checkpoint} byTitle={byTitle} now={now} onOpen={onOpen} />
      </div>
    </details>
  )
}
