import { format } from 'date-fns'
import { useState } from 'react'
import { FieldGroup, PillChoice, TextField } from '../../components/ui/Field'
import { NoteField } from './LogFields'
import { useInvalidateCompanion, useLoggedMilestones } from '../../hooks/useCompanionEvents'
import { companion, type Milestone, type MilestoneCategory } from '../../lib/api/companion'
import type { Child } from '../../lib/api/types'
import { useChildSettings } from '../../hooks/useChildSettings'
import { itemForTitle, milestoneSuggestions, type Suggestion } from '../../lib/milestones'
import { ageBasis, judgedMonths } from '../../lib/preterm'
import { SheetFooter } from './SheetFooter'
import { useSaver } from './useSaver'
import './activity.css'

export function MilestoneSheet({ child, editing, initial, onClose }: { child: Child; editing: Milestone | null; /** A checklist item being marked as seen. */ initial?: { title: string; category: MilestoneCategory }; onClose: () => void }) {
  const [title, setTitle] = useState(editing?.title ?? initial?.title ?? '')
  const [date, setDate] = useState(editing?.date ?? format(new Date(), 'yyyy-MM-dd'))
  const [category, setCategory] = useState<MilestoneCategory>(editing?.category ?? initial?.category ?? 'motor')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const invalidate = useInvalidateCompanion()
  const { settings } = useChildSettings(child.id)
  const { run, busy, error } = useSaver(child.id, () => {
    invalidate(child.id)
    onClose()
  })
  // The chips are CDC's checklist for this age (corrected for a baby born early), less what is already marked.
  const months = judgedMonths(ageBasis(child, settings))
  const logged = useLoggedMilestones(child.id)
  const suggestions = milestoneSuggestions(months, logged)
  const listed = itemForTitle(title)
  const body = { child: child.id, title: title.trim(), date, category, notes }
  const pick = (s: Suggestion) => {
    setTitle(s.text)
    setCategory(s.category)
  }

  return (
    <>
      <TextField label="Milestone" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="First smile, rolled over, first word…" data-autofocus={editing || initial ? undefined : ''} />
      {listed ? (
        <p className="small muted" data-testid="milestone-listed">
          On CDC&rsquo;s {listed.checkpoint.adjective} list: most children do this by {listed.checkpoint.label}.
        </p>
      ) : null}
      {/* The chips step aside once one is chosen (the line above says which list it is on), so Date and Save stay in reach. */}
      {!editing && !initial && !listed && suggestions.items.length ? (
        <FieldGroup title={suggestions.label}>
          <Chips items={suggestions.items} onPick={pick} />
        </FieldGroup>
      ) : null}
      {/* Firsts on no CDC list, kept apart from it and offered only from the age they start to happen. */}
      {!editing && !initial && !listed && suggestions.firsts.length ? (
        <FieldGroup title="Other firsts">
          <Chips items={suggestions.firsts} onPick={pick} testId="milestone-firsts" />
        </FieldGroup>
      ) : null}
      <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} max={format(new Date(), 'yyyy-MM-dd')} />
      <FieldGroup title="Category">
        <PillChoice
          tone="teal"
          value={category}
          onChange={setCategory}
          options={[
            { value: 'motor', label: 'Movement' },
            { value: 'social', label: 'Social' },
            { value: 'language', label: 'Language' },
            { value: 'cognitive', label: 'Thinking' },
            { value: 'feeding', label: 'Feeding' },
            { value: 'other', label: 'Other' },
          ]}
        />
      </FieldGroup>
      <NoteField value={notes} onChange={setNotes} placeholder="Where, who saw it, how it felt…" />
      <SheetFooter
        busy={busy}
        error={error}
        disabled={!title.trim() || !date}
        onSave={() => run(() => (editing ? companion.milestones.update(editing.id, body) : companion.milestones.create(body)))}
        onDelete={editing ? () => run(() => companion.milestones.remove(editing.id)) : undefined}
      />
    </>
  )
}

function Chips({ items, onPick, testId = 'milestone-chips' }: { items: Suggestion[]; onPick: (s: Suggestion) => void; testId?: string }) {
  return (
    <div className="milestone-suggestions" data-testid={testId}>
      {items.map((s) => (
        <button key={s.text} type="button" className="milestone-chip" onClick={() => onPick(s)}>
          {s.text}
        </button>
      ))}
    </div>
  )
}
