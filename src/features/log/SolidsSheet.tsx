import { useMemo, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FieldGroup, PillChoice, TextField, TimeField } from '../../components/ui/Field'
import { NoteField } from './LogFields'
import { PlusIcon, CheckIcon } from '../../components/icons'
import { useChildSettings } from '../../hooks/useChildSettings'
import { feedings as feedingsApi } from '../../lib/api/endpoints'
import type { Child, Feeding, FeedingMethod } from '../../lib/api/types'
import { AMOUNTS, FOODS, FOOD_BY_LABEL, REACTIONS, decodeSolidsNotes, encodeSolidsNotes, foodsTried, type EatenAmount, type Reaction } from '../../lib/foods'
import { parseDate, toIso } from '../../lib/time'
import { SheetFooter } from './SheetFooter'
import { useSaver } from './useSaver'
import './solids.css'

interface Props {
  child: Child
  editing: Feeding | null
  recentFeedings: Feeding[]
  onClose: () => void
}

/** Add Solids: picture grid → Next → details. */
export function SolidsSheet({ child, editing, recentFeedings, onClose }: Props) {
  const decoded = decodeSolidsNotes(editing?.notes)
  const [step, setStep] = useState<1 | 2>(editing ? 2 : 1)
  const [selected, setSelected] = useState<string[]>(decoded.foods)
  const [query, setQuery] = useState('')
  const [time, setTime] = useState<Date>(() => (editing ? parseDate(editing.start) : new Date()))
  const [reaction, setReaction] = useState<Reaction | null>(decoded.reaction)
  const [amount, setAmount] = useState<EatenAmount | null>(decoded.amount)
  const [note, setNote] = useState(decoded.note)
  const [method, setMethod] = useState<FeedingMethod>(editing?.method ?? 'parent fed')
  const { settings, update } = useChildSettings(child.id)
  const { run, busy, error } = useSaver(child.id, onClose)

  const tried = useMemo(() => foodsTried(recentFeedings.filter((f) => f.type === 'solid food').map((f) => f.notes)), [recentFeedings])
  const custom = settings.customFoods
  const q = query.trim().toLowerCase()
  const popular = FOODS.filter((f) => !q || f.label.includes(q))

  const toggle = (label: string) => setSelected((s) => (s.includes(label) ? s.filter((x) => x !== label) : [...s, label]))
  const addCustom = () => {
    const label = query.trim().toLowerCase()
    if (!label) return
    if (!custom.includes(label) && !FOOD_BY_LABEL.has(label)) update((latest) => ({ customFoods: [...(latest.customFoods ?? []).filter((f) => f !== label), label] }))
    if (!selected.includes(label)) setSelected([...selected, label])
    setQuery('')
  }

  const body = {
    child: child.id,
    start: toIso(time),
    end: toIso(time),
    type: 'solid food',
    method,
    amount: null,
    notes: encodeSolidsNotes(selected, reaction, amount, note),
  }

  if (step === 1) {
    return (
      <>
        {/* One search box: it filters the pictures, and Enter (or the + card) adds what was typed as a food. */}
        <TextField
          label="Food"
          hideLabel
          enterKeyHint="done"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a food, or tap one below"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addCustom()
            }
          }}
        />

        {selected.length ? (
          <div className="food-selected">
            {selected.map((s) => (
              <button key={s} type="button" className="food-selected-chip" onClick={() => toggle(s)} aria-label={`Remove ${s}`}>
                {FOOD_BY_LABEL.get(s)?.emoji ?? '🍽️'} {s} ×
              </button>
            ))}
          </div>
        ) : null}

        {/* Shown once there is something to add (a typed food) or a custom food to pick: an empty row otherwise. */}
        {custom.length || q ? (
        <FieldGroup title="Custom foods">
          <div className="food-grid">
            <button type="button" className="food-card food-card-custom" onClick={addCustom} aria-label="Add custom food" disabled={!q}>
              <span className="food-pic dashed">
                <PlusIcon />
              </span>
              <span className="food-name">{q ? `add ${q}` : 'custom'}</span>
            </button>
            {custom
              .filter((c) => !q || c.includes(q))
              .map((c) => (
                <FoodCard key={c} label={c} emoji="🍽️" selected={selected.includes(c)} onToggle={() => toggle(c)} />
              ))}
          </div>
        </FieldGroup>
        ) : null}

        {tried.length ? (
          <FieldGroup title="Recently tried">
            <div className="food-grid">
              {tried.slice(0, 8).map((t) => (
                <FoodCard key={t} label={t} emoji={FOOD_BY_LABEL.get(t)?.emoji ?? '🍽️'} image={FOOD_BY_LABEL.get(t)?.image} selected={selected.includes(t)} onToggle={() => toggle(t)} />
              ))}
            </div>
          </FieldGroup>
        ) : null}

        <FieldGroup title="Most popular foods">
          <div className="food-grid">
            {popular.map((f) => (
              <FoodCard key={f.id} label={f.label} emoji={f.emoji} image={f.image} allergen={f.allergen} selected={selected.includes(f.label)} onToggle={() => toggle(f.label)} />
            ))}
          </div>
        </FieldGroup>

        <div className="solids-foot sheet-save">
          <span className="solids-count">
            Selected <b>{selected.length}</b>
          </span>
          <Button size="lg" onClick={() => setStep(2)} disabled={selected.length === 0} style={{ flex: 1 }}>
            Next
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <button type="button" className="solids-back" onClick={() => setStep(1)}>
        ‹ Change foods ({selected.length})
      </button>
      <div className="food-selected">
        {selected.map((s) => (
          <span key={s} className="food-selected-chip static">
            {FOOD_BY_LABEL.get(s)?.emoji ?? '🍽️'} {s}
          </span>
        ))}
      </div>
      <TimeField label="Time:" value={time} onChange={setTime} quick={editing ? undefined : setTime} />
      <FieldGroup title="Reaction">
        <div className="reaction-row" role="radiogroup" aria-label="Reaction">
          {REACTIONS.map((r) => (
            <button key={r.value} type="button" role="radio" aria-checked={reaction === r.value} className={reaction === r.value ? 'reaction active' : 'reaction'} onClick={() => setReaction(reaction === r.value ? null : r.value)}>
              <span className="reaction-emoji">{r.emoji}</span>
              <span className="reaction-label">{r.label}</span>
            </button>
          ))}
        </div>
      </FieldGroup>
      <FieldGroup title="How much">
        <PillChoice tone="green" value={amount} onChange={setAmount} options={AMOUNTS} />
      </FieldGroup>
      <FieldGroup title="How">
        <PillChoice tone="green" value={method} onChange={setMethod} options={[{ value: 'parent fed', label: 'Spoon fed' }, { value: 'self fed', label: 'Self fed / BLW' }]} />
      </FieldGroup>
      <NoteField label="Note" value={note} onChange={setNote} placeholder="Gagged a little, loved the texture…" />
      <SheetFooter
        busy={busy}
        error={error}
        disabled={selected.length === 0}
        onSave={() => run(() => (editing ? feedingsApi.update(editing.id, body) : feedingsApi.create(body)))}
        onDelete={editing ? () => run(() => feedingsApi.remove(editing.id)) : undefined}
      />
    </>
  )
}

function FoodCard({ label, emoji, image, selected, allergen, onToggle }: { label: string; emoji: string; image?: string; selected: boolean; allergen?: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={selected ? 'food-card selected' : 'food-card'} onClick={onToggle} aria-pressed={selected}>
      <span className="food-pic">
        {image ? (
          <img className="food-photo" src={image} alt="" loading="lazy" width={72} height={72} />
        ) : (
          <span className="food-emoji" aria-hidden>
            {emoji}
          </span>
        )}
        <span className="food-plus" aria-hidden>
          {selected ? <CheckIcon /> : <PlusIcon />}
        </span>
        {allergen ? <span className="food-allergen" title="Common allergen">!</span> : null}
      </span>
      <span className="food-name">{label}</span>
    </button>
  )
}
