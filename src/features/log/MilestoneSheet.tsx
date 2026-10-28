import { format } from 'date-fns'
import { useState } from 'react'
import { FieldGroup, PillChoice, TextField } from '../../components/ui/Field'
import { NoteField } from './LogFields'
import { useInvalidateCompanion } from '../../hooks/useCompanionEvents'
import { companion, type Milestone, type MilestoneCategory } from '../../lib/api/companion'
import type { Child } from '../../lib/api/types'
import { useChildSettings } from '../../hooks/useChildSettings'
import { ageBasis, judgedMonths } from '../../lib/preterm'
import { SheetFooter } from './SheetFooter'
import { useSaver } from './useSaver'
import './activity.css'

const SUGGESTIONS: { max: number; items: string[] }[] = [
  { max: 2, items: ['First smile', 'Lifts head briefly', 'Follows faces', 'Coos', 'Calms when spoken to'] },
  { max: 4, items: ['Holds head steady', 'Laughs', 'Reaches for toys', 'Rolls tummy to back', 'Pushes up on arms'] },
  { max: 6, items: ['Rolls both ways', 'Sits with support', 'First solids', 'Babbles', 'Recognizes name'] },
  { max: 9, items: ['Sits without support', 'Crawls', 'Pincer grasp', 'Says "mama/dada"', 'Plays peekaboo', 'First tooth'] },
  { max: 12, items: ['Pulls to stand', 'Cruises furniture', 'First word', 'Waves bye', 'First steps', 'Drinks from cup'] },
  { max: 18, items: ['Walks alone', 'Points to ask', 'Says 5+ words', 'Stacks blocks', 'Uses spoon'] },
  { max: 24, items: ['Runs', 'Kicks a ball', 'Two-word phrases', 'Follows two-step directions', 'Pretend play'] },
  { max: 60, items: ['Rides a tricycle', 'Full sentences', 'Potty trained', 'Draws a circle', 'Knows colors'] },
]

export function MilestoneSheet({ child, editing, onClose }: { child: Child; editing: Milestone | null; onClose: () => void }) {
  const [title, setTitle] = useState(editing?.title ?? '')
  const [date, setDate] = useState(editing?.date ?? format(new Date(), 'yyyy-MM-dd'))
  const [category, setCategory] = useState<MilestoneCategory>(editing?.category ?? 'motor')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const invalidate = useInvalidateCompanion()
  const { settings } = useChildSettings(child.id)
  const { run, busy, error } = useSaver(child.id, () => {
    invalidate(child.id)
    onClose()
  })
  const months = judgedMonths(ageBasis(child, settings)) // corrected age for a baby born early
  const bucket = SUGGESTIONS.find((s) => months < s.max) ?? SUGGESTIONS[SUGGESTIONS.length - 1]
  const body = { child: child.id, title: title.trim(), date, category, notes }

  return (
    <>
      <TextField label="Milestone" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="First smile, rolled over, first word…" data-autofocus={editing ? undefined : ''} />
      <FieldGroup title={months < 1 ? 'Common in the first month' : `Common around ${Math.floor(months)} months`}>
        <div className="milestone-suggestions">
          {bucket.items.map((s) => (
            <button key={s} type="button" className="milestone-chip" onClick={() => setTitle(s)}>
              {s}
            </button>
          ))}
        </div>
      </FieldGroup>
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
