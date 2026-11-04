import { useState } from 'react'
import { About } from '../../components/ui/About'
import { Button } from '../../components/ui/Button'
import { FieldGroup, PillChoice, TextField } from '../../components/ui/Field'
import { Sheet } from '../../components/ui/Sheet'
import { useChildren } from '../../hooks/useChildren'
import { useChildSettings } from '../../hooks/useChildSettings'
import { usePrefs } from '../../hooks/usePrefs'
import { diaperText } from '../../lib/growth-note'

/** Typical dry diapers, for a household that has not weighed its own (grams). */
const TYPICAL = [
  { value: '20', label: 'Newborn · 20 g' },
  { value: '25', label: 'Size 1 · 25 g' },
  { value: '30', label: 'Size 2 · 30 g' },
]

/**
 * Settings › Weighing: the weight of a dry diaper, so a weighing taken with one on (the pediatrician's scale, a
 * hurried morning) can be saved as the naked weight. Shared per child; the growth sheet offers "Diaper on" once it is set.
 */
export function WeighingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { child } = useChildren()
  const { settings, update } = useChildSettings(child?.id ?? null)
  if (!child) return null
  return (
    <Sheet open={open} title="Weighing" onClose={onClose}>
      <WeighingEditor
        name={child.first_name}
        grams={settings.diaperGrams ?? null}
        onSave={(diaperGrams) => {
          update({ diaperGrams })
          onClose()
        }}
      />
    </Sheet>
  )
}

function WeighingEditor({ name, grams, onSave }: { name: string; grams: number | null; onSave: (grams: number | null) => void }) {
  const { prefs } = usePrefs()
  const [text, setText] = useState(grams === null ? '' : String(grams))
  const [touched, setTouched] = useState(false)
  const n = text.trim() === '' ? null : Number(text)
  const problem = n !== null && !(n > 0 && n <= 200) ? 'A dry diaper weighs between 1 and 200 g.' : null
  const preset = TYPICAL.find((t) => t.value === text)?.value ?? ''
  return (
    <div className="stack">
      <FieldGroup title="Dry diaper weight" hint={`Weigh one of ${name}'s diapers, dry, on a kitchen scale. Then a weighing taken with a diaper on can be saved as the naked weight: the growth sheet gets a Diaper on switch and takes this off.`}>
        <TextField label="Grams" type="number" inputMode="decimal" min={1} max={200} step={1} value={text} placeholder="e.g. 25" onChange={(e) => { setTouched(true); setText(e.target.value) }} />
        <PillChoice label="Typical" value={preset} onChange={(v) => { setTouched(true); setText(v) }} options={TYPICAL} />
        {n !== null && !problem ? (
          <p className="small" data-testid="diaper-preview">
            {diaperText(n, prefs.units.weight)} comes off a weighing taken with a diaper on.
          </p>
        ) : null}
        {problem ? <p className="small text-health">{problem}</p> : null}
      </FieldGroup>
      <About label="About weighing with a diaper">
        <p>Pediatricians weigh babies naked; a diaper on the scale adds its own weight to the number. A dry diaper is about a day of growth (20–30 g), so taking it off keeps the home and office weighings comparable and the day-to-day checks honest.</p>
        <p>Only a dry diaper can be taken off. A wet one carries 30–100 g of urine that no setting can correct for: at the office, ask for a naked weight or a fresh diaper first.</p>
        <p>Weighings imported from the Hatch scale are left as the scale sent them.</p>
      </About>
      <Button size="lg" block disabled={!touched || problem !== null} onClick={() => onSave(n)}>
        Save
      </Button>
    </div>
  )
}
