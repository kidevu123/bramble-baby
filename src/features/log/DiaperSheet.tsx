import { useState } from 'react'
import { CircleChoice, PillChoice, TimeField } from '../../components/ui/Field'
import { NoteField } from './LogFields'
import { Segmented } from '../../components/ui/Segmented'
import { isPotty } from '../../lib/events'
import { DropIcon, DryIcon, MixedIcon, PooIcon, PottyIcon } from '../../components/icons'
import { changes as changesApi } from '../../lib/api/endpoints'
import type { Child, DiaperChange, DiaperColor } from '../../lib/api/types'
import type { QuickPrefill } from '../../lib/quick-text'
import { parseDate, toIso } from '../../lib/time'
import { SheetFooter } from './SheetFooter'
import { useSaver } from './useSaver'

type What = 'pee' | 'poo' | 'mixed' | 'dry'
type Mode = 'diaper' | 'potty'
type PottyWhat = 'pee' | 'poo' | 'both' | 'accident' | 'sat-dry'
type Size = '1' | '2' | '3'

const COLORS: { value: DiaperColor; css: string; label: string }[] = [
  { value: 'yellow', css: '#f2c21f', label: 'Yellow' },
  { value: 'brown', css: '#8b5a2b', label: 'Brown' },
  { value: 'black', css: '#2b2b2b', label: 'Black' },
  { value: 'green', css: '#3f7d1e', label: 'Green' },
]

function pottyOf(d: DiaperChange | null): PottyWhat | null {
  if (!d) return null
  if (d.tags.includes('accident')) return 'accident'
  if (d.wet && d.solid) return 'both'
  if (d.wet) return 'pee'
  if (d.solid) return 'poo'
  return 'sat-dry'
}

function whatOf(d: DiaperChange | null): What | null {
  if (!d) return null
  if (d.wet && d.solid) return 'mixed'
  if (d.wet) return 'pee'
  if (d.solid) return 'poo'
  return 'dry'
}

export function DiaperSheet({ child, editing, initial, prefill, onClose }: { child: Child; editing: DiaperChange | null; initial?: Mode; prefill?: Extract<QuickPrefill, { kind: 'diaper' }>; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>(() => (editing ? (isPotty(editing) ? 'potty' : 'diaper') : initial ?? 'diaper'))
  const [time, setTime] = useState<Date>(() => (editing ? parseDate(editing.time) : prefill?.at ?? new Date()))
  const [what, setWhat] = useState<What | null>(() => (editing && !isPotty(editing) ? whatOf(editing) : prefill?.what ?? null))
  const [potty, setPotty] = useState<PottyWhat | null>(() => (editing && isPotty(editing) ? pottyOf(editing) : null))
  const [size, setSize] = useState<Size | null>(() => (editing?.amount ? (String(editing.amount) as Size) : null))
  const [color, setColor] = useState<DiaperColor>(editing?.color ?? '')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const { run, busy, error } = useSaver(child.id, onClose)
  // Baby Buddy replaces an entry's whole tag list on a PATCH: an edit keeps every tag this sheet does not own
  // (who logged it, anything added in Baby Buddy's own UI) and only sets potty/accident.
  const kept = (editing?.tags ?? []).filter((t) => t !== 'potty' && t !== 'accident')

  const body =
    mode === 'diaper'
      ? what
        ? {
            child: child.id,
            time: toIso(time),
            wet: what === 'pee' || what === 'mixed',
            solid: what === 'poo' || what === 'mixed',
            color: what === 'poo' || what === 'mixed' ? color : '',
            amount: size ? Number(size) : null,
            notes,
            tags: kept,
          }
        : null
      : potty
        ? {
            child: child.id,
            time: toIso(time),
            wet: potty === 'pee' || potty === 'both' || potty === 'accident',
            solid: potty === 'poo' || potty === 'both',
            color: potty === 'poo' || potty === 'both' ? color : '',
            amount: null,
            notes,
            tags: [...kept, ...(potty === 'accident' ? ['potty', 'accident'] : ['potty'])],
          }
        : null

  if (mode === 'potty') {
    return (
      <>
        {!editing ? <Segmented label="Diaper or potty" options={[{ value: 'diaper', label: 'Diaper' }, { value: 'potty', label: 'Potty' }]} value={mode} onChange={setMode} /> : null}
        <CircleChoice
          label="What happened"
          toneClass="tone-diaper"
          value={potty}
          onChange={setPotty}
          options={[
            { value: 'pee', label: 'Pee', icon: <DropIcon /> },
            { value: 'poo', label: 'Poo', icon: <PooIcon />, toneClass: 'tone-poo' },
            { value: 'both', label: 'Both', icon: <MixedIcon />, toneClass: 'tone-poo' },
            { value: 'accident', label: 'Accident', icon: <PottyIcon />, toneClass: 'tone-feeding' },
            { value: 'sat-dry', label: 'Sat, dry', icon: <DryIcon />, toneClass: 'tone-note' },
          ]}
        />
        <TimeField label="Time:" value={time} onChange={setTime} quick={editing ? undefined : setTime} />
        <NoteField value={notes} onChange={setNotes} placeholder="Asked to go, used the big toilet…" />
        <SheetFooter
          busy={busy}
          error={error}
          disabled={!body}
          onSave={() => body && run(() => (editing ? changesApi.update(editing.id, body) : changesApi.create(body)))}
          onDelete={editing ? () => run(() => changesApi.remove(editing.id)) : undefined}
        />
      </>
    )
  }

  return (
    <>
      {!editing ? <Segmented label="Diaper or potty" options={[{ value: 'diaper', label: 'Diaper' }, { value: 'potty', label: 'Potty' }]} value={mode} onChange={setMode} /> : null}
      <CircleChoice
        label="What was in it"
        toneClass="tone-diaper"
        value={what}
        onChange={setWhat}
        options={[
          { value: 'pee', label: 'Pee', icon: <DropIcon /> },
          { value: 'poo', label: 'Poo', icon: <PooIcon />, toneClass: 'tone-poo' },
          { value: 'mixed', label: 'Mixed', icon: <MixedIcon />, toneClass: 'tone-poo' },
          { value: 'dry', label: 'Dry', icon: <DryIcon />, toneClass: 'tone-note' },
        ]}
      />
      <TimeField label="Time:" value={time} onChange={setTime} quick={editing ? undefined : setTime} />
      {/* Optional details: each row says what it is, so no heading over them. */}
      <div className="diaper-details">
        <div className="row">
          <span className="muted small diaper-detail-label">Size</span>
          <PillChoice tone="teal" label="Size" value={size} onChange={setSize} options={[{ value: '1', label: 'Little' }, { value: '2', label: 'Medium' }, { value: '3', label: 'Large' }]} />
        </div>
        {what === 'poo' || what === 'mixed' ? (
          <div className="row">
            <span className="muted small diaper-detail-label">Color</span>
            <div className="swatches" role="radiogroup" aria-label="Color">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={color === c.value}
                  aria-label={c.label}
                  className="swatch"
                  style={{ background: c.css }}
                  onClick={() => setColor(color === c.value ? '' : c.value)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <NoteField value={notes} onChange={setNotes} />
      <SheetFooter
        busy={busy}
        error={error}
        disabled={!body}
        onSave={() => body && run(() => (editing ? changesApi.update(editing.id, body) : changesApi.create(body)))}
        onDelete={editing ? () => run(() => changesApi.remove(editing.id)) : undefined}
      />
    </>
  )
}
