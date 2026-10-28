import { format } from 'date-fns'
import { useState } from 'react'
import type { QuickPrefill } from '../../lib/quick-text'
import { Segmented } from '../../components/ui/Segmented'
import { PillChoice, TextField, TimeField } from '../../components/ui/Field'
import { NoteField, ValueField } from './LogFields'
import { usePrefs } from '../../hooks/usePrefs'
import * as ep from '../../lib/api/endpoints'
import type { Child, GrowthEntry, GrowthKind, HeadCircumference, Height, Medication, Note, Temperature, Weight } from '../../lib/api/types'
import { GROWTH_LABEL } from '../../lib/events'
import { decodeGrowthNote, encodeGrowthNote, growthEntryTime } from '../../lib/growth-note'
import { parseDate, toIso } from '../../lib/time'
import { SheetFooter } from './SheetFooter'
import { useSaver } from './useSaver'
import { useUnitBoundary } from '../../hooks/useStorageUnits'
import { temperatureCheck } from './plausible'
import { joinPounds, splitPounds } from '../../lib/units'

type GrowthEditing = { kind: GrowthKind; entry: GrowthEntry } | null

export function GrowthSheet({ child, editing, initial, prefill, onClose }: { child: Child; editing: GrowthEditing; initial?: GrowthKind; prefill?: Extract<QuickPrefill, { kind: 'growth' }>; onClose: () => void }) {
  const { prefs } = usePrefs()
  const [kind, setKind] = useState<GrowthKind>(editing?.kind ?? initial ?? 'weight')
  // Baby Buddy keeps only a date for growth; the clock lives in the note's time segment (growth-note.ts).
  // An older entry without one opens with no time chosen, and stays that way unless one is picked.
  const [note] = useState(() => decodeGrowthNote(editing?.entry.notes))
  const [time, setTime] = useState<Date | null>(() => (editing ? growthEntryTime(editing.entry) : prefill?.at ?? new Date()))
  const [initialValue] = useState(() => {
    if (!editing) return prefill?.value !== undefined ? String(prefill.value) : ''
    const e = editing.entry as Weight & Height & HeadCircumference
    return String(e.weight ?? e.height ?? e.head_circumference ?? '')
  })
  const [value, setValue] = useState(initialValue)
  // A pounds phone types weight as the hospital writes it: pounds and ounces in two fields.
  const [initialParts] = useState(() => (initialValue && Number(initialValue) > 0 ? splitPounds(Number(initialValue)) : { lb: '', oz: '' }))
  const [lbText, setLbText] = useState(initialParts.lb)
  const [ozText, setOzText] = useState(initialParts.oz)
  const setPounds = (lb: string, oz: string) => {
    setLbText(lb)
    setOzText(oz)
  }
  const [notes, setNotes] = useState(note.text)
  const { run, busy, error } = useSaver(child.id, onClose)
  const units = useUnitBoundary(child.id)
  const unit = kind === 'weight' ? prefs.units.weight : prefs.units.length
  const poundsField = kind === 'weight' && unit === 'lb'
  const num = poundsField ? (joinPounds(lbText, ozText) ?? NaN) : Number(value)
  const ozTooMany = poundsField && Number(ozText) >= 16
  // Both fields as they opened: the weight was not touched, so it stays out of the PATCH.
  const untouched = poundsField ? lbText === initialParts.lb && ozText === initialParts.oz : value === initialValue
  const field = kind === 'weight' ? 'weight' : kind === 'height' ? 'height' : 'head_circumference'
  const api = kind === 'weight' ? ep.weight : kind === 'height' ? ep.height : ep.headCircumference
  const date = time ? format(time, 'yyyy-MM-dd') : editing?.entry.date ?? ''
  const noteWithTime = () => encodeGrowthNote(notes, time, note.slot)
  // Typed in this phone's unit; stored in the household's storage unit (see useStorageUnits). An edit
  // that did not touch the number leaves it out, so display rounding never rewrites the stored value.
  const body = () => {
    const base = { child: child.id, date, notes: noteWithTime() }
    return editing && kind === editing.kind && untouched ? base : units.toStorage(kind, { ...base, [field]: num })
  }

  return (
    <>
      <Segmented
        label="Measurement"
        options={[{ value: 'weight', label: 'Weight' }, { value: 'height', label: 'Height' }, { value: 'head', label: 'Head' }]}
        value={kind}
        onChange={(k) => {
          if (!editing) setKind(k)
        }}
      />
      {poundsField ? (
        <div className="value-with-hint">
          <div className="value-pair">
            <ValueField label="Weight" unit="lb" name="Pounds" type="number" inputMode="numeric" step="1" min={0} value={lbText} onChange={(e) => setPounds(e.target.value, ozText)} placeholder="0" data-autofocus={editing ? '' : undefined} />
            <ValueField label="" unit="oz" name="Ounces" type="number" inputMode="decimal" step="0.25" min={0} max={15.99} value={ozText} onChange={(e) => setPounds(lbText, e.target.value)} placeholder="0" />
          </div>
          {ozTooMany ? <p className="log-hint text-health">Ounces go up to 15.99; 16 oz is another pound.</p> : <p className="log-hint">As the hospital writes it: 5 lb 15.5 oz.</p>}
        </div>
      ) : (
        <div className="value-with-hint">
          <ValueField
            label={kind === 'weight' ? 'Weight' : kind === 'height' ? 'Height' : 'Head'}
            unit={unit}
            name={`${kind === 'weight' ? 'Weight' : kind === 'height' ? 'Height' : 'Head circumference'} in ${unit === 'in' ? 'inches' : unit}`}
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
            data-autofocus={editing ? '' : undefined}
          />
        </div>
      )}
      <TimeField label="Time:" value={time} onChange={setTime} max={new Date()} placeholder={editing ? `${format(parseDate(editing.entry.date), 'MMM d, yyyy')} · add a time` : undefined} quick={editing ? undefined : setTime} />
      {editing ? (
        <p className="xs muted">
          Editing the {GROWTH_LABEL[kind].toLowerCase()} logged on {format(parseDate(editing.entry.date), 'MMM d, yyyy')}.{' '}
          {time ? 'Fix the number or the time and save.' : 'It has no time of day yet, so it sits at noon on the timeline; pick one to place it.'}
        </p>
      ) : null}
      <NoteField value={notes} onChange={setNotes} />
      <SheetFooter
        busy={busy}
        error={error}
        disabled={!(num > 0) || ozTooMany || !date || !units.ready}
        onSave={() => run(() => (editing ? api.update(editing.entry.id, body()) : api.create(body())))}
        onDelete={editing ? () => run(() => api.remove(editing.entry.id)) : undefined}
      />
    </>
  )
}

/** Baby Buddy only accepts these dosage units; anything else is rejected on save. */
const DOSE_UNITS = [
  { value: 'ml', label: 'mL' },
  { value: 'mg', label: 'mg' },
  { value: 'drops', label: 'drops' },
  { value: 'tablets', label: 'tablets' },
]

type HealthEditing = { kind: 'temperature'; entry: Temperature } | { kind: 'medication'; entry: Medication } | null

export function HealthSheet({ child, editing, initial, prefill, onClose }: { child: Child; editing: HealthEditing; initial?: 'temperature' | 'medication'; prefill?: Extract<QuickPrefill, { kind: 'temperature' }>; onClose: () => void }) {
  const { prefs } = usePrefs()
  const [kind, setKind] = useState<'temperature' | 'medication'>(editing?.kind ?? initial ?? 'temperature')
  const [time, setTime] = useState<Date>(() => (editing ? parseDate(editing.entry.time) : prefill?.at ?? new Date()))
  const [initialTemp] = useState(() => (editing?.kind === 'temperature' ? String(editing.entry.temperature) : prefill?.value !== undefined ? String(prefill.value) : ''))
  const [temp, setTemp] = useState(initialTemp)
  const [name, setName] = useState(() => (editing?.kind === 'medication' ? editing.entry.name : ''))
  const [dose, setDose] = useState(() => (editing?.kind === 'medication' ? String(editing.entry.dosage) : ''))
  const [doseUnit, setDoseUnit] = useState(() => (editing?.kind === 'medication' ? editing.entry.dosage_unit : 'ml'))
  const [notes, setNotes] = useState(editing?.entry.notes ?? '')
  const { run, busy, error } = useSaver(child.id, onClose)
  const units = useUnitBoundary(child.id)

  const tempBody = () => (editing?.kind === 'temperature' && temp === initialTemp ? { child: child.id, time: toIso(time), notes } : units.toStorage('temperature', { child: child.id, time: toIso(time), temperature: Number(temp), notes }))
  const medBody = { child: child.id, time: toIso(time), name: name.trim(), dosage: Number(dose), dosage_unit: doseUnit, notes }
  const valid = kind === 'temperature' ? Number(temp) > 0 : name.trim().length > 0 && Number(dose) > 0
  const implausible = kind === 'temperature' ? temperatureCheck(Number(temp), prefs.units.temp) : null

  return (
    <>
      <Segmented
        label="Health entry"
        options={[{ value: 'temperature', label: 'Temperature' }, { value: 'medication', label: 'Medication' }]}
        value={kind}
        onChange={(k) => {
          if (!editing) setKind(k)
        }}
      />
      {kind === 'temperature' ? (
        <ValueField label="Temperature" unit={`°${prefs.units.temp.toUpperCase()}`} name="Temperature" type="number" inputMode="decimal" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)} placeholder={prefs.units.temp === 'f' ? '98.6' : '37.0'} />
      ) : (
        <>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Infant acetaminophen" />
          <div className="dose-row">
            <ValueField label="Dose" name="Dose" type="number" inputMode="decimal" step="0.1" min={0} value={dose} onChange={(e) => setDose(e.target.value)} placeholder="0" />
            <PillChoice
              tone="purple"
              label="Dose unit"
              value={doseUnit}
              onChange={setDoseUnit}
              options={[...DOSE_UNITS, ...(DOSE_UNITS.some((u) => u.value === doseUnit) ? [] : [{ value: doseUnit, label: doseUnit }])]}
            />
          </div>
        </>
      )}
      <TimeField label="Time:" value={time} onChange={setTime} quick={editing ? undefined : setTime} />
      <NoteField value={notes} onChange={setNotes} />
      <SheetFooter
        busy={busy}
        error={error}
        disabled={!valid || (kind === 'temperature' && !units.ready)}
        note={
          implausible ? (
            <p className="plausible-note" role="status">
              {implausible}
            </p>
          ) : null
        }
        onSave={() =>
          run(() => {
            if (kind === 'temperature') return editing ? ep.temperature.update(editing.entry.id, tempBody()) : ep.temperature.create(tempBody())
            return editing ? ep.medication.update(editing.entry.id, medBody) : ep.medication.create(medBody)
          })
        }
        onDelete={editing ? () => run(() => (editing.kind === 'temperature' ? ep.temperature.remove(editing.entry.id) : ep.medication.remove(editing.entry.id))) : undefined}
      />
    </>
  )
}

export function NoteSheet({ child, editing, prefill, onClose }: { child: Child; editing: Note | null; prefill?: Extract<QuickPrefill, { kind: 'note' }>; onClose: () => void }) {
  const [time, setTime] = useState<Date>(() => (editing ? parseDate(editing.time) : prefill?.at ?? new Date()))
  const [note, setNote] = useState(editing?.note ?? prefill?.text ?? '')
  const { run, busy, error } = useSaver(child.id, onClose)
  const body = { child: child.id, time: toIso(time), note: note.trim() }
  return (
    <>
      <label className="text-field">
        <span className="text-field-label">Note</span>
        <textarea className="text-input text-area" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="First smile, new tooth, anything worth remembering…" data-autofocus={editing ? undefined : ''} />
      </label>
      <TimeField label="Time:" value={time} onChange={setTime} quick={editing ? undefined : setTime} />
      <SheetFooter
        busy={busy}
        error={error}
        disabled={!note.trim()}
        onSave={() => run(() => (editing ? ep.notes.update(editing.id, body) : ep.notes.create(body)))}
        onDelete={editing ? () => run(() => ep.notes.remove(editing.id)) : undefined}
      />
    </>
  )
}
