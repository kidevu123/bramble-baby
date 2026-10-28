import { useMemo, useState } from 'react'
import { SciencePanel } from './SciencePanel'
import { TopBar } from '../../components/nav/TopBar'
import { useChildren } from '../../hooks/useChildren'
import { rangeDays, useChildEvents } from '../../hooks/useEvents'
import { useChildSettings } from '../../hooks/useChildSettings'
import { ageBasis, ageHold, judgedMonths } from '../../lib/preterm'
import { isExpecting } from '../../lib/child'
import { generateInsights, miniplansFor, type Insight, type Miniplan } from '../../lib/insights'
import { ChevronDownIcon, ChevronRightIcon } from '../../components/icons'
import './insights.css'

type Tab = 'tips' | 'science' | 'miniplans'

export function InsightsPage() {
  const { child } = useChildren()
  const [tab, setTab] = useState<Tab>('tips')
  const now = useMemo(() => new Date(), [])
  const range = useMemo(() => rangeDays(14, now), [now])
  const events = useChildEvents(child?.id ?? null, range)
  const { settings } = useChildSettings(child?.id ?? null)
  if (!child) return null
  // Settings › Born early: corrected age, and no comparisons of what was logged while held.
  const basis = ageBasis(child, settings)
  const months = judgedMonths(basis, now)
  const expecting = isExpecting(child, now)
  const insights = generateInsights({ ageMonths: expecting ? -1 : months, events, now, expecting, childName: child.first_name, held: ageHold(basis, now) !== null })
  const plans = miniplansFor(expecting ? 0 : months)

  return (
    <>
      <TopBar title="Insights" right="none" back />
      <main className="page">
        <nav className="cat-tabs" aria-label="Insights section">
          <button type="button" className={tab === 'tips' ? 'cat-tab active' : 'cat-tab'} aria-pressed={tab === 'tips'} onClick={() => setTab('tips')}>
            Tips
          </button>
          <button type="button" className={tab === 'science' ? 'cat-tab active' : 'cat-tab'} aria-pressed={tab === 'science'} onClick={() => setTab('science')}>
            The science
          </button>
          <button type="button" className={tab === 'miniplans' ? 'cat-tab active' : 'cat-tab'} aria-pressed={tab === 'miniplans'} onClick={() => setTab('miniplans')}>
            Miniplans
          </button>
        </nav>
        {tab === 'science' ? <SciencePanel child={child} /> : null}
        {tab === 'tips' ? (
          <div className="stack">
            {insights.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
            <p className="xs muted" style={{ textAlign: 'center' }}>
              Generated from {child.first_name}'s own logs and age. Free, updated every time you open this tab.
            </p>
          </div>
        ) : null}
        {tab === 'miniplans' ? (
          <div className="stack">
            {plans.map((p) => (
              <MiniplanCard key={p.id} plan={p} />
            ))}
          </div>
        ) : null}
      </main>
    </>
  )
}

function InsightCard({ insight }: { insight: Insight }) {
  const [open, setOpen] = useState(false)
  return (
    <article className={`insight card cat-${insight.category}`}>
      <div className="insight-head">
        <span className={`insight-badge badge-${insight.badge}`}>{insight.badge}</span>
        <span className={`insight-cat text-${catTone(insight.category)}`}>{insight.category}</span>
      </div>
      <h3>{insight.title}</h3>
      <p className="small">{insight.body}</p>
      {insight.steps?.length ? (
        <>
          <button type="button" className="insight-more" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide steps' : 'Read more'} {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </button>
          {open ? (
            <ol className="insight-steps">
              {insight.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          ) : null}
        </>
      ) : null}
    </article>
  )
}

function MiniplanCard({ plan }: { plan: Miniplan }) {
  const [open, setOpen] = useState(false)
  return (
    <article className="miniplan card">
      <button type="button" className="miniplan-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="grow">
          <span className="strong">{plan.title}</span>
          <span className="small muted" style={{ display: 'block' }}>
            {plan.summary}
          </span>
        </span>
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
      </button>
      {open ? (
        <ol className="miniplan-steps">
          {plan.steps.map((s, i) => (
            <li key={i}>
              <span className="strong">{s.title}</span>
              <p className="small">{s.detail}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  )
}

function catTone(c: Insight['category']): string {
  return c === 'sleep' ? 'sleep' : c === 'feeding' ? 'feeding' : c === 'diaper' ? 'diaper' : c === 'health' ? 'medicine' : c === 'activity' ? 'activity' : c === 'expecting' ? 'contractions' : 'milestones'
}
