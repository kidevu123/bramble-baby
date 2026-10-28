import { useState } from 'react'
import { FieldGroup, TextField } from '../../components/ui/Field'
import { Segmented } from '../../components/ui/Segmented'
import { Toggle } from '../../components/ui/Toggle'
import { usePrefs } from '../../hooks/usePrefs'
import { LABEL_SIZES, labelSize, nightWindowText, type LabelPrefs, type LabelSizeId } from '../../lib/labels'
import type { VolumeUnit } from '../../lib/units'
import type { MilkWindows } from '../../lib/api/companion'
import './milk-label.css'
import '../more/label-settings.css'

/**
 * Label size, what goes on the label, and the storage windows. Rendered by LabelSettingsSheet (Settings ›
 * Milk labels & printer, also opened in place from the milk label sheet). The why of each (the sun/moon
 * science, the CDC numbers) lives in that sheet's "About labels and printing", so this stays a short form.
 */
export function LabelSettings({ childName, unit, onWindows }: { childName?: string; unit: VolumeUnit; /** The household's copy of the storage windows (shared settings), saved beside this phone's. */ onWindows?: (w: MilkWindows) => void }) {
  const { prefs, update } = usePrefs()
  const labels = prefs.labels
  const setLabels = (patch: Partial<LabelPrefs>) => update({ labels: { ...labels, ...patch } })
  // The storage windows are the household's: saved to the shared settings too, so every phone dates bags alike.
  const setWindow = (patch: Partial<Pick<LabelPrefs, 'roomHours' | 'fridgeDays' | 'freezerMonths'>>) => {
    const next = { ...labels, ...patch }
    setLabels(patch)
    onWindows?.({ roomHours: next.roomHours, fridgeDays: next.fridgeDays, freezerMonths: next.freezerMonths })
  }
  // The option already names the size in inches; the line under it only adds what the option does not say.
  const sizeNote = labelSize(labels.size).hint.split(' · ').slice(1).join(' · ')
  return (
    <>
      <FieldGroup title="Label size">
        <select className="text-input label-size" value={labels.size} onChange={(e) => setLabels({ size: e.target.value as LabelSizeId, sizeChosen: true })} aria-label="Label size">
          {LABEL_SIZES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} · {s.hint.split(' · ')[0]}
            </option>
          ))}
        </select>
        {sizeNote ? <p className="small muted ls-note">{sizeNote}</p> : null}
      </FieldGroup>

      <FieldGroup title="On the label">
        <ul className="ls-list">
          <li className="ls-row">
            <span className="grow">Name{childName ? ` (${childName})` : ''}</span>
            <Toggle label="Show name" checked={labels.showName} onChange={(v) => setLabels({ showName: v })} />
          </li>
          <li className="ls-row">
            <span className="grow">Use-by dates</span>
            <Toggle label="Show use-by dates" checked={labels.showStorage} onChange={(v) => setLabels({ showStorage: v })} />
          </li>
          <li className="ls-row">
            <span className="grow">Notes</span>
            <Toggle label="Show notes" checked={labels.showNotes} onChange={(v) => setLabels({ showNotes: v })} />
          </li>
          <li className="ls-row">
            <span className="grow ls-row-text">
              Sun or moon
              <span className="small muted">{labels.dayNight ? `Moon on milk pumped ${nightWindowText(labels)}` : 'Off'}</span>
            </span>
            <Toggle label="Show a sun or a moon" checked={labels.dayNight} onChange={(v) => setLabels({ dayNight: v })} />
          </li>
          {labels.dayNight ? (
            <li className="ls-hours">
              <HourField label="Moon from" value={labels.nightFrom} hours={[18, 19, 20, 21, 22, 23, 0]} onChange={(h) => setLabels({ nightFrom: h })} />
              <HourField label="Sun from" value={labels.nightTo} hours={[3, 4, 5, 6, 7, 8, 9]} onChange={(h) => setLabels({ nightTo: h })} />
            </li>
          ) : null}
          <li className="ls-row">
            <span className="grow">Volume</span>
            <Segmented
              label="Volume units"
              options={[
                { value: 'both', label: 'oz + mL' },
                { value: 'one', label: unit === 'oz' ? 'oz only' : 'mL only' },
              ]}
              value={labels.bothUnits ? 'both' : 'one'}
              onChange={(v) => setLabels({ bothUnits: v === 'both' })}
            />
          </li>
        </ul>
      </FieldGroup>

      <FieldGroup title="Storage windows" hint="CDC: 4 hours room, 4 days fridge, 6 months freezer.">
        <div className="label-windows">
          <WindowField label="Room (hours)" what="Room" unit="hours" min={1} max={24} value={labels.roomHours} onCommit={(v) => setWindow({ roomHours: v })} />
          <WindowField label="Fridge (days)" what="Fridge" unit="days" min={1} max={14} value={labels.fridgeDays} onCommit={(v) => setWindow({ fridgeDays: v })} />
          <WindowField label="Freezer (months)" what="Freezer" unit="months" min={1} max={12} value={labels.freezerMonths} onCommit={(v) => setWindow({ freezerMonths: v })} />
        </div>
      </FieldGroup>
    </>
  )
}

const hourText = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`

/** An hour of the day for the sun/moon window: a short list, so a slip cannot make every bag night milk. */
function HourField({ label, value, hours, onChange }: { label: string; value: number; hours: number[]; onChange: (h: number) => void }) {
  const options = hours.includes(value) ? hours : [...hours, value]
  return (
    <label className="ls-hour">
      <span className="text-field-label">{label}</span>
      <select className="text-input" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
        {options.map((h) => (
          <option key={h} value={h}>
            {hourText(h)}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * One storage window. It may be empty while typing (backspace, then the new number); nothing is saved until
 * the field holds a whole number in range, and leaving it with anything else puts the saved value back with
 * a line saying why. These windows drive every bag's expiry and its reminders, so a slip is never stored.
 */
function WindowField({ label, what, unit, min, max, value, onCommit }: { label: string; what: string; unit: string; min: number; max: number; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  const [problem, setProblem] = useState<string | null>(null)
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    // Changed elsewhere (another sheet, a reset): follow it.
    setShown(value)
    setText(String(value))
  }
  const parsed = /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN
  const valid = Number.isInteger(parsed) && parsed >= min && parsed <= max
  const commit = () => {
    if (valid) {
      setProblem(null)
      if (parsed !== value) onCommit(parsed)
      return
    }
    setProblem(`${what} takes ${min}–${max} ${unit}; kept ${value}.`)
    setText(String(value))
  }
  return (
    <div className="label-window">
      <TextField
        label={label}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        aria-invalid={text !== '' && !valid ? true : undefined}
        onChange={(e) => {
          setText(e.target.value)
          setProblem(null)
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {problem ? (
        <span className="xs text-health" role="alert">
          {problem}
        </span>
      ) : text !== '' && !valid ? (
        <span className="xs muted">
          {min}–{max} {unit}
        </span>
      ) : null}
    </div>
  )
}
